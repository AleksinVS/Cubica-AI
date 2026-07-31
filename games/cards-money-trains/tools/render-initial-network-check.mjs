#!/usr/bin/env node
/**
 * Redraw the initial transport network the way the player draws it and
 * compare the result with the author's own image.
 *
 * Why this exists. The delivery map no longer contains a railway: the player
 * paints the whole network from runtime-owned data. That makes the picture
 * honest — a closed road disappears instead of being covered up — but it also
 * means the game's appearance is now a program, and a program can drift away
 * from the author's drawing without anyone noticing.
 *
 * This tool closes that gap. It takes the network exactly as the normative
 * manifest states it (positions of the stations, the ten open roads), draws it
 * with the very same shapes the player uses — the shared module
 * `plugins/cards-money-trains-player/src/author-network-style.ts` — puts the
 * drawing on the clean author board, and compares it with
 * `draft/trains/Начальная транспортная сеть.png`, the author's image of the
 * same network.
 *
 * How the comparison works. The author's railway is obtained without any
 * guessing: it is exactly where the reference image differs from the clean
 * board, since the two images are the same board with and without the railway.
 * The drawn railway is where this tool put ink. Two numbers follow:
 *
 * - coverage: the share of the author's railway that the drawing reaches —
 *   what a player would perceive as "a road of the author is missing";
 * - accuracy: the share of the drawing that lands on the author's railway —
 *   what a player would perceive as "the game drew something the author did
 *   not".
 *
 * Both numbers allow a tolerance of a few pixels, because the author drew the
 * tracks by hand and they do not run exactly through the centres of the
 * station icons: on the reference the centre line of a track sits up to about
 * six pixels away from the straight line between two station centres. The game
 * connects station centres by definition, so that difference belongs to the
 * author's drawing rather than to the renderer, and on a board 5079 pixels
 * wide it is invisible.
 *
 * The station marks themselves are excluded here and are verified by the
 * companion tool `measure-author-network-style.mjs`, which measures their
 * radii, tooth count and colours on the reference directly. In this comparison
 * they would only add noise: a grey printed icon repainted green differs from
 * the clean board by about as much as the export noise between the two source
 * files, while a dark rail over the light map differs three times more.
 *
 * Outputs (temporary artifacts, never committed):
 * `.tmp/cmt-initial-network/` — the redrawn board, the author's reference and
 * a difference image for visual review.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  AUTHOR_STATION_DISC,
  AUTHOR_STATION_GREEN,
  AUTHOR_STATION_LABEL_INK,
  AUTHOR_STATION_LABEL_SIZE,
  AUTHOR_STATION_STYLE,
  AUTHOR_TRACK_INK,
  AUTHOR_TRACK_STYLE,
  printedNodeLabel,
  railwayTrackShapes,
  stationGearOutline
} from "../plugins/cards-money-trains-player/src/author-network-style.ts";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(TOOL_ROOT, "..");
const REPO_ROOT = path.resolve(GAME_ROOT, "..", "..");
const CLEAN_BOARD_PATH = path.join(REPO_ROOT, "draft", "trains", "Игровая Карта.png");
const REFERENCE_PATH = path.join(
  REPO_ROOT,
  "draft",
  "trains",
  "Начальная транспортная сеть.png"
);
const MANIFEST_PATH = path.join(GAME_ROOT, "game.manifest.json");
const OUTPUT_ROOT = path.join(REPO_ROOT, ".tmp", "cmt-initial-network");

// A pixel belongs to the author's railway when the two boards differ by more
// than this, summed over the three colour channels.
//
// The value is measured, not chosen. A histogram of the differences between
// the two boards, taken away from the station marks, is split in two: a
// decaying tail below 140 — the two exports of the same board are not
// bit-identical, so country outlines, printed text and paper texture differ by
// a few levels — and a broad hump from 300 upwards, which is the dark railway
// over the light map. Between 140 and 300 the histogram is nearly empty, and
// the threshold sits in the middle of that empty band.
const INK_THRESHOLD = 220;
// Two drawings of the same line never coincide pixel by pixel. A pixel counts
// as matched when its counterpart lies within this distance, which covers both
// the anti-aliased edge of a stroke and the few pixels by which the author's
// hand-drawn track misses the centres of the station icons.
const TOLERANCE_PX = 4;
// Accepted agreement with the author's drawing. Both numbers are far above
// what a missing road, a wrong width or a displaced track could produce.
const MIN_COVERAGE = 0.9;
const MIN_ACCURACY = 0.9;

const args = process.argv.slice(2);
const check = args.includes("--check");
const unknown = args.filter((argument) => argument !== "--check");
if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const network = readNetwork(manifest);
const overlaySvg = buildOverlaySvg(network);

const cleanBoard = await sharp(CLEAN_BOARD_PATH).removeAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = cleanBoard.info;
const reference = await sharp(REFERENCE_PATH).removeAlpha().raw()
  .toBuffer({ resolveWithObject: true });
if (reference.info.width !== width || reference.info.height !== height) {
  throw new Error("The clean board and the reference image have different sizes.");
}

const overlay = await sharp(Buffer.from(overlaySvg)).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
if (overlay.info.width !== width || overlay.info.height !== height) {
  throw new Error(
    `The drawn overlay is ${overlay.info.width}x${overlay.info.height}, `
    + `the board is ${width}x${height}.`
  );
}

const excluded = stationMask(network, width, height);
const comparison = compare({
  cleanBoard: cleanBoard.data,
  reference: reference.data,
  overlay: overlay.data,
  overlayChannels: overlay.info.channels,
  channels,
  width,
  height,
  excluded
});

mkdirSync(OUTPUT_ROOT, { recursive: true });
const redrawn = await sharp(CLEAN_BOARD_PATH)
  .composite([{ input: Buffer.from(overlaySvg) }])
  .png()
  .toBuffer();
writeFileSync(path.join(OUTPUT_ROOT, "redrawn.png"), redrawn);
writeFileSync(
  path.join(OUTPUT_ROOT, "side-by-side.png"),
  await sideBySide(redrawn, network, width, height)
);
writeFileSync(
  path.join(OUTPUT_ROOT, "difference.png"),
  await sharp(comparison.differenceImage, {
    raw: { width, height, channels: 3 }
  }).png().toBuffer()
);
writeFileSync(
  path.join(OUTPUT_ROOT, "comparison.json"),
  `${JSON.stringify({
    roads: network.edges.length,
    stations: network.nodes.filter((node) => node.kind === "terminal").length,
    waypoints: network.nodes.filter((node) => node.kind === "waypoint").length,
    authorInkPixels: comparison.authorPixels,
    drawnInkPixels: comparison.drawnPixels,
    coverage: round(comparison.coverage),
    accuracy: round(comparison.accuracy)
  }, null, 2)}\n`
);

const summary =
  `render-initial-network-check: ${network.edges.length} дорог, `
  + `${network.nodes.filter((node) => node.connected).length} связанных точек; `
  + `совпадение с авторским рисунком ${percent(comparison.coverage)} покрытия, `
  + `${percent(comparison.accuracy)} точности`;

if (check) {
  const failures = [];
  if (comparison.coverage < MIN_COVERAGE) {
    failures.push(
      `покрытие ${percent(comparison.coverage)} ниже порога ${percent(MIN_COVERAGE)}`
    );
  }
  if (comparison.accuracy < MIN_ACCURACY) {
    failures.push(
      `точность ${percent(comparison.accuracy)} ниже порога ${percent(MIN_ACCURACY)}`
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Нарисованная сеть разошлась с эталоном: ${failures.join("; ")}. `
      + `Разностное изображение: ${path.relative(REPO_ROOT, OUTPUT_ROOT)}/difference.png`
    );
  }
  console.log(`${summary} — OK`);
  process.exit(0);
}

console.log(summary);
console.log(`Изображения: ${path.relative(REPO_ROOT, OUTPUT_ROOT)}/`);

/**
 * Read the open network from the normative manifest.
 *
 * The manifest, not the review annotation, is the source: it is what the
 * runtime serves and therefore what the player will actually draw.
 */
function readNetwork(source) {
  const objects = source?.state?.public?.objects;
  const nodeRecords = objects?.networkNodes ?? {};
  const edgeRecords = objects?.networkEdges ?? {};
  const nodes = Object.entries(nodeRecords).map(([id, record]) => ({
    id,
    kind: record.objectType === "transport.waypoint" ? "waypoint" : "terminal",
    label: printedNodeLabel(id, record.attributes?.label ?? ""),
    // The π mark is typed as a terminal but printed as a half-stop disc; the
    // player draws it the same way, so the check must too.
    printedAsDisc: record.objectType === "transport.waypoint" || id === "terminal-3-14",
    open: record.facets?.availability === "open",
    position: record.attributes?.position,
    connected: false
  })).filter((node) => node.position);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const edges = Object.entries(edgeRecords)
    .filter(([, record]) => record.facets?.state === "open")
    .map(([id, record]) => {
      const geometry = record.attributes?.geometry ?? {};
      const polyline = Array.isArray(geometry.polyline) && geometry.polyline.length > 1
        ? geometry.polyline
        : [geometry.from, geometry.to].filter(Boolean);
      return {
        id,
        fromNodeId: record.attributes?.fromNodeId,
        toNodeId: record.attributes?.toNodeId,
        polyline
      };
    })
    .filter((edge) => edge.polyline.length > 1);

  for (const edge of edges) {
    const from = nodesById.get(edge.fromNodeId);
    const to = nodesById.get(edge.toNodeId);
    if (from) from.connected = true;
    if (to) to.connected = true;
  }
  return { nodes, edges };
}

/** Draw the network into an SVG using the shapes the player renders with. */
function buildOverlaySvg(networkToDraw) {
  const ink = hex(AUTHOR_TRACK_INK);
  const green = hex(AUTHOR_STATION_GREEN);
  const disc = hex(AUTHOR_STATION_DISC);
  const labelInk = hex(AUTHOR_STATION_LABEL_INK);
  const parts = [];

  for (const edge of networkToDraw.edges) {
    const shapes = railwayTrackShapes(edge.polyline);
    for (const sleeper of shapes.sleepers) {
      parts.push(
        `<line x1="${fixed(sleeper.from.x)}" y1="${fixed(sleeper.from.y)}"`
        + ` x2="${fixed(sleeper.to.x)}" y2="${fixed(sleeper.to.y)}"`
        + ` stroke="${ink}" stroke-width="${AUTHOR_TRACK_STYLE.sleeperWidth}"`
        + ' stroke-linecap="butt"/>'
      );
    }
    for (const rail of shapes.rails) {
      const points = rail.map((point) => `${fixed(point.x)},${fixed(point.y)}`).join(" ");
      parts.push(
        `<polyline points="${points}" fill="none" stroke="${ink}"`
        + ` stroke-width="${AUTHOR_TRACK_STYLE.railWidth}" stroke-linecap="butt"/>`
      );
    }
  }

  for (const node of networkToDraw.nodes) {
    if (!node.connected || !node.open) continue;
    if (node.printedAsDisc) {
      parts.push(
        `<circle cx="${fixed(node.position.x)}" cy="${fixed(node.position.y)}"`
        + ` r="${AUTHOR_STATION_STYLE.waypointRadius}" fill="${green}"/>`
      );
      parts.push(nodeLabelSvg(node, labelInk, AUTHOR_STATION_LABEL_SIZE * 0.6));
      continue;
    }
    const outline = stationGearOutline(node.position)
      .map((point) => `${fixed(point.x)},${fixed(point.y)}`).join(" ");
    parts.push(`<polygon points="${outline}" fill="${green}"/>`);
    parts.push(
      `<circle cx="${fixed(node.position.x)}" cy="${fixed(node.position.y)}"`
      + ` r="${AUTHOR_STATION_STYLE.discRadius}" fill="${disc}"/>`
    );
    parts.push(nodeLabelSvg(node, labelInk, AUTHOR_STATION_LABEL_SIZE));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="5079" height="3627"`
    + ` viewBox="0 0 5079 3627">${parts.join("")}</svg>`;
}

/**
 * Put the author's image and the redrawn board one above the other, cropped
 * to the part of the map the network occupies, so that a person can judge the
 * likeness without hunting for it on a board 5079 pixels wide.
 */
async function sideBySide(redrawnBytes, networkToDraw, boardWidth, boardHeight) {
  const margin = 160;
  const xs = networkToDraw.nodes.filter((node) => node.connected)
    .map((node) => node.position.x);
  const ys = networkToDraw.nodes.filter((node) => node.connected)
    .map((node) => node.position.y);
  const left = Math.max(0, Math.round(Math.min(...xs) - margin));
  const top = Math.max(0, Math.round(Math.min(...ys) - margin));
  const region = {
    left,
    top,
    width: Math.min(boardWidth - left, Math.round(Math.max(...xs) - left + margin)),
    height: Math.min(boardHeight - top, Math.round(Math.max(...ys) - top + margin))
  };
  const panelWidth = 1600;
  const crop = async (input) => sharp(input).extract(region)
    .resize({ width: panelWidth }).png().toBuffer();
  const authorPanel = await crop(REFERENCE_PATH);
  const gamePanel = await crop(redrawnBytes);
  const panelHeight = (await sharp(authorPanel).metadata()).height;
  const gap = 24;
  return sharp({
    create: {
      width: panelWidth,
      height: panelHeight * 2 + gap,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  }).composite([
    { input: authorPanel, left: 0, top: 0 },
    { input: gamePanel, left: 0, top: panelHeight + gap }
  ]).png().toBuffer();
}

/**
 * The printed mark of a station, for the visual artifact only.
 *
 * The text lies inside the area excluded from the comparison, so whichever
 * typeface the rasteriser happens to have can never influence the reported
 * numbers. The player renders the same text through Phaser.
 */
function nodeLabelSvg(node, ink, size) {
  const text = node.label
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
  return `<text x="${fixed(node.position.x)}" y="${fixed(node.position.y)}"`
    + ' font-family="Georgia, DejaVu Serif, serif" font-weight="bold"'
    + ` font-size="${fixed(size)}" fill="${ink}"`
    + ` text-anchor="middle" dominant-baseline="central">${text}</text>`;
}

/**
 * Mark the area of every station mark, which this comparison leaves out.
 *
 * The circle is a little wider than the gear itself, so that the rounded ends
 * of the tracks hidden under the mark do not leak into the comparison.
 */
function stationMask(networkToDraw, maskWidth, maskHeight) {
  const mask = new Uint8Array(maskWidth * maskHeight);
  for (const node of networkToDraw.nodes) {
    if (!node.open) continue;
    const radius = (node.printedAsDisc
      ? AUTHOR_STATION_STYLE.waypointRadius
      : AUTHOR_STATION_STYLE.tipRadius) + 6;
    const from = Math.floor(-radius);
    const to = Math.ceil(radius);
    for (let offsetY = from; offsetY <= to; offsetY += 1) {
      const y = Math.round(node.position.y) + offsetY;
      if (y < 0 || y >= maskHeight) continue;
      for (let offsetX = from; offsetX <= to; offsetX += 1) {
        const x = Math.round(node.position.x) + offsetX;
        if (x < 0 || x >= maskWidth) continue;
        if (Math.hypot(x - node.position.x, y - node.position.y) > radius) continue;
        mask[y * maskWidth + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Compare the drawn railway with the author's one and build a difference
 * image: green where the two agree within the tolerance, red where the author
 * drew and the game did not reach, blue where the game drew and the author
 * did not.
 */
function compare(input) {
  const { width: imageWidth, height: imageHeight } = input;
  const author = new Uint8Array(imageWidth * imageHeight);
  const drawn = new Uint8Array(imageWidth * imageHeight);
  let authorPixels = 0;
  let drawnPixels = 0;
  for (let pixel = 0; pixel < imageWidth * imageHeight; pixel += 1) {
    if (input.excluded[pixel] === 1) continue;
    const base = pixel * input.channels;
    const changed = Math.abs(input.reference[base] - input.cleanBoard[base])
      + Math.abs(input.reference[base + 1] - input.cleanBoard[base + 1])
      + Math.abs(input.reference[base + 2] - input.cleanBoard[base + 2]);
    if (changed > INK_THRESHOLD) {
      author[pixel] = 1;
      authorPixels += 1;
    }
    if (input.overlay[pixel * input.overlayChannels + 3] > 128) {
      drawn[pixel] = 1;
      drawnPixels += 1;
    }
  }

  /** Is there a marked pixel of `mask` within the tolerance of (x, y)? */
  const nearby = (mask, x, y) => {
    for (let offsetY = -TOLERANCE_PX; offsetY <= TOLERANCE_PX; offsetY += 1) {
      const row = y + offsetY;
      if (row < 0 || row >= imageHeight) continue;
      for (let offsetX = -TOLERANCE_PX; offsetX <= TOLERANCE_PX; offsetX += 1) {
        const column = x + offsetX;
        if (column < 0 || column >= imageWidth) continue;
        if (mask[row * imageWidth + column] === 1) return true;
      }
    }
    return false;
  };

  const differenceImage = Buffer.alloc(imageWidth * imageHeight * 3, 255);
  let coveredAuthor = 0;
  let matchedDrawn = 0;
  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const pixel = y * imageWidth + x;
      const isAuthor = author[pixel] === 1;
      const isDrawn = drawn[pixel] === 1;
      if (!isAuthor && !isDrawn) continue;
      const authorMatched = isAuthor && nearby(drawn, x, y);
      const drawnMatched = isDrawn && nearby(author, x, y);
      if (authorMatched) coveredAuthor += 1;
      if (drawnMatched) matchedDrawn += 1;
      const out = pixel * 3;
      if ((isAuthor && authorMatched) || (isDrawn && drawnMatched)) {
        differenceImage[out] = 40;
        differenceImage[out + 1] = 140;
        differenceImage[out + 2] = 60;
      } else if (isAuthor) {
        differenceImage[out] = 200;
        differenceImage[out + 1] = 60;
        differenceImage[out + 2] = 50;
      } else {
        differenceImage[out] = 50;
        differenceImage[out + 1] = 90;
        differenceImage[out + 2] = 200;
      }
    }
  }

  return {
    authorPixels,
    drawnPixels,
    coverage: authorPixels === 0 ? 0 : coveredAuthor / authorPixels,
    accuracy: drawnPixels === 0 ? 0 : matchedDrawn / drawnPixels,
    differenceImage
  };
}

function hex(value) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function fixed(value) {
  return Math.round(value * 100) / 100;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
