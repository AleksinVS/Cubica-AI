#!/usr/bin/env node
/**
 * Measure the author's drawing of the transport network from the reference
 * image and compare it with the constants the player renders with.
 *
 * Why this exists. The delivery map is the clean author board without a
 * railway, so the player draws the whole network itself. Its appearance must
 * repeat the author's own drawing, and "repeat" has to mean something
 * checkable. This tool re-derives every dimension from
 * `draft/trains/Начальная транспортная сеть.png` — the author's image of the
 * initial network — and writes the result next to the drawing constants used
 * by `plugins/cards-money-trains-player/src/author-network-style.ts`.
 *
 * How each value is obtained (all in canonical design pixels, the 5079×3627
 * plane shared by the manifest, the annotations and the renderer):
 *
 * - road 6 ↔ 9¾ runs exactly horizontally between two station centres, so a
 *   vertical cut across it separates the two rails cleanly. Rail centres are
 *   the darkest rows on each side of the road; rail width is measured at half
 *   depth of colour, which is the standard way to size a soft-edged stroke
 *   and does not depend on the anti-aliased fringe;
 * - sleepers are the columns where the dark band spans the whole track. Their
 *   step, thickness and length come from those columns;
 * - the ink is the average colour of the darkest fifth of the rail pixels;
 * - the station gear is measured radially around station 6: tooth tips, tooth
 *   roots, the light inner disc and the number of teeth;
 * - the half-stop disc is measured the same way around the 9¾ mark.
 *
 * The tool is a measurement, not a decision: with `--check` it fails when the
 * renderer's constants drift away from the author's drawing, and prints the
 * measured value next to the expected one.
 */

import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AjvImport from "ajv";
import sharp from "sharp";

// Ajv is published both as a CommonJS default export and as a named one; the
// neighbouring game tools use the same coercion.
const Ajv = AjvImport.default ?? AjvImport;

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(TOOL_ROOT, "..");
const REPO_ROOT = path.resolve(GAME_ROOT, "..", "..");
const REFERENCE_PATH = path.join(
  REPO_ROOT,
  "draft",
  "trains",
  "Начальная транспортная сеть.png"
);
const RECORD_PATH = path.join(
  GAME_ROOT,
  "annotations",
  "initial-network.track-style.json"
);
const SCHEMA_PATH = path.join(
  GAME_ROOT,
  "annotations",
  "initial-network.track-style.schema.json"
);
const STYLE_MODULE_PATH = path.join(
  GAME_ROOT,
  "plugins",
  "cards-money-trains-player",
  "src",
  "author-network-style.ts"
);

// Measured landmarks on the reference image. Road 6 ↔ 9¾ is the only author
// road that is exactly horizontal, which makes it the natural measuring bench.
const HORIZONTAL_ROAD = { fromX: 2408, toX: 2959, y: 814 };
const STATION_CENTRE = { x: 2408, y: 814 };
const WAYPOINT_CENTRE = { x: 2959, y: 814 };

// Tolerances for --check. They are wider than the measurement noise (which is
// a few tenths of a pixel) and much narrower than a visible difference.
const LENGTH_TOLERANCE_PX = 0.6;
const COLOUR_TOLERANCE = 6;

const args = process.argv.slice(2);
const check = args.includes("--check");
const unknown = args.filter((argument) => argument !== "--check");
if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);

const referenceBytes = readFileSync(REFERENCE_PATH);
const image = await sharp(referenceBytes).removeAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = image.info;
if (width !== 5079 || height !== 3627) {
  throw new Error(`Unexpected reference dimensions: ${width}x${height}.`);
}

/** Colour of one pixel; coordinates are truncated to the containing pixel. */
const pixel = (x, y) => {
  const index = ((y | 0) * width + (x | 0)) * channels;
  return [image.data[index], image.data[index + 1], image.data[index + 2]];
};

/** Perceived brightness, the usual luminance weights for sRGB. */
const luminance = (x, y) => {
  const [red, green, blue] = pixel(x, y);
  return 0.299 * red + 0.587 * green + 0.114 * blue;
};

const track = measureTrack();
const station = measureStationMark();
const record = {
  $schema: "./initial-network.track-style.schema.json",
  schemaVersion: "1.0",
  status: "measurement",
  publishable: false,
  warning:
    "Измерение авторского рисунка сети, а не игровое содержимое. Файл описывает, "
    + "как выглядит дорога и значок станции на авторском изображении, и служит "
    + "обоснованием постоянных величин в отрисовке игрока.",
  source: {
    path: "draft/trains/Начальная транспортная сеть.png",
    root: "repo",
    width,
    height,
    sha256: createHash("sha256").update(referenceBytes).digest("hex")
  },
  coordinateSystem: {
    origin: "top-left",
    units: "design-pixel",
    width,
    height
  },
  method: {
    horizontalRoad:
      "Дорога 6 ↔ 9¾ горизонтальна на эталоне, поэтому вертикальный разрез "
      + "поперёк неё разделяет рельсы без пересчёта углов.",
    strokeWidth:
      "Ширина штриха измерена на половине глубины цвета: это стандартный способ "
      + "измерить мягкий край и не зависит от сглаживающей каймы.",
    ink:
      "Цвет — среднее по самой тёмной пятой части точек рельса.",
    stationMark:
      "Значок станции измерен по радиусам вокруг центра станции 6, полустанок — "
      + "вокруг отметки 9¾."
  },
  track,
  station
};

// The shape of the record is owned by its JSON Schema, so it is checked by a
// standard validator instead of hand-written type checks (see the platform
// rule against replacing declarative contracts with imperative code).
const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
if (!validate(record)) {
  throw new Error(
    "Запись измерения не соответствует своей схеме:\n"
    + validate.errors
      .map((error) => `  - ${error.instancePath || "/"} ${error.message}`)
      .join("\n")
  );
}

const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
const constants = readRendererConstants();
const drift = compareWithRenderer(record, constants);

if (check) {
  const stored = readFileSync(RECORD_PATH);
  if (!stored.equals(recordBytes)) {
    throw new Error(
      `${path.relative(REPO_ROOT, RECORD_PATH)} is stale: re-run `
      + "games/cards-money-trains/tools/measure-author-network-style.mjs"
    );
  }
  if (drift.length > 0) {
    throw new Error(
      "Отрисовка игрока разошлась с авторским рисунком:\n"
      + drift.map((item) => `  - ${item}`).join("\n")
    );
  }
  console.log(
    "measure-author-network-style: OK (запись актуальна, отрисовка совпадает "
    + "с измерением)"
  );
  process.exit(0);
}

writeAtomically(RECORD_PATH, recordBytes);
console.log(
  "measure-author-network-style: OK "
  + `(рельсы ${track.railGaugePx} px между осями, шпалы через ${track.sleeperSpacingPx} px)`
);
if (drift.length > 0) {
  console.log("Расхождения с отрисовкой игрока:");
  for (const item of drift) console.log(`  - ${item}`);
}

/**
 * Measure the rails and sleepers on the horizontal author road.
 *
 * Columns are classified first: a column that is dark over the full height of
 * the track carries a sleeper, a column with two separate dark bands shows
 * only the rails. The two populations are then measured separately.
 */
function measureTrack() {
  const top = HORIZONTAL_ROAD.y - 40;
  const bottom = HORIZONTAL_ROAD.y + 40;
  const darkRowCount = [];
  for (let x = HORIZONTAL_ROAD.fromX; x <= HORIZONTAL_ROAD.toX; x += 1) {
    let count = 0;
    for (let y = top; y <= bottom; y += 1) if (luminance(x, y) < 130) count += 1;
    darkRowCount.push({ x, count });
  }
  // A sleeper column is dark over most of the track height; a plain column is
  // dark only where the two rails pass. The two groups differ by a factor of
  // three, so any split inside that gap gives the same answer.
  const sleeperColumns = darkRowCount.filter((item) => item.count >= 24);
  const railColumns = darkRowCount.filter(
    (item) => item.count >= 6 && item.count <= 14
  );

  const sleeperRuns = groupConsecutive(sleeperColumns.map((item) => item.x));
  // Runs at the very ends touch the station marks; drop the outer ones.
  const innerRuns = sleeperRuns.filter(
    (run) => run.from > HORIZONTAL_ROAD.fromX + 70
      && run.to < HORIZONTAL_ROAD.toX - 70
  );
  const sleeperCentres = innerRuns.map((run) => (run.from + run.to) / 2);
  const steps = sleeperCentres.slice(1)
    .map((centre, index) => centre - sleeperCentres[index]);

  const railProfiles = railColumns.slice(0, 300).map((item) => {
    const bands = railBandsInColumn(item.x, top, bottom);
    return bands === null ? null : { x: item.x, ...bands };
  });
  const usable = railProfiles.filter((profile) => profile !== null);
  const gauges = usable.map((profile) => profile.lower.centre - profile.upper.centre);
  const widths = usable.flatMap((profile) => [profile.upper.width, profile.lower.width]);

  const sleeperLengths = innerRuns.map((run) => {
    const middle = Math.round((run.from + run.to) / 2);
    const band = darkBand(middle, top, bottom);
    return band === null ? null : band.width;
  }).filter((value) => value !== null);

  return {
    railGaugePx: round(median(gauges)),
    railOffsetPx: round(median(gauges) / 2),
    railWidthPx: round(median(widths)),
    sleeperSpacingPx: round(median(steps)),
    sleeperWidthPx: round(median(innerRuns.map((run) => run.to - run.from + 1))),
    sleeperLengthPx: round(median(sleeperLengths)),
    sleeperHalfLengthPx: round(median(sleeperLengths) / 2),
    inkHex: railInk(usable),
    sampledSleepers: innerRuns.length,
    sampledRailColumns: usable.length
  };
}

/**
 * Locate the two rails inside one column: the darkest row above the track
 * centre and the darkest row below it, each sized at half depth of colour.
 */
function railBandsInColumn(x, top, bottom) {
  const centre = HORIZONTAL_ROAD.y;
  const upper = darkBand(x, top, centre - 1);
  const lower = darkBand(x, centre, bottom);
  if (upper === null || lower === null) return null;
  return { upper, lower };
}

/**
 * Size one dark band by half depth of colour: the background level and the
 * darkest level are read from the data, and the band is the run of rows that
 * are darker than their midpoint. Sub-pixel edges are interpolated linearly.
 */
function darkBand(x, fromY, toY) {
  const rows = [];
  for (let y = fromY; y <= toY; y += 1) rows.push({ y, value: luminance(x, y) });
  const darkest = rows.reduce((best, row) => row.value < best.value ? row : best);
  const background = median(rows.map((row) => row.value));
  if (background - darkest.value < 40) return null;
  const half = (background + darkest.value) / 2;
  const edge = (direction) => {
    let previous = darkest;
    for (
      let y = darkest.y + direction;
      y >= fromY && y <= toY;
      y += direction
    ) {
      const value = luminance(x, y);
      if (value > half) {
        const span = value - previous.value;
        const fraction = span === 0 ? 0 : (half - previous.value) / span;
        return previous.y + direction * fraction;
      }
      previous = { y, value };
    }
    return previous.y;
  };
  const upperEdge = edge(-1);
  const lowerEdge = edge(1);
  return {
    centre: (upperEdge + lowerEdge) / 2,
    width: lowerEdge - upperEdge
  };
}

/**
 * Average colour of the darkest fifth of the rail pixels.
 *
 * Sampling follows the rail centres found per column, so the reading never
 * drifts onto the background or onto a country border that happens to cross
 * the road.
 */
function railInk(profiles) {
  const samples = [];
  for (const profile of profiles) {
    for (const band of [profile.upper, profile.lower]) {
      // The stroke reaches full ink only in its core, so the darkest pixel
      // within one pixel of the measured centre is taken, not the centre pixel
      // itself, which may fall on the rounding boundary between two rows.
      let best = null;
      for (let offset = -1; offset <= 1; offset += 1) {
        const y = Math.round(band.centre) + offset;
        const value = luminance(profile.x, y);
        if (best === null || value < best.value) {
          best = { value, colour: pixel(profile.x, y) };
        }
      }
      if (best !== null) samples.push(best);
    }
  }
  samples.sort((left, right) => left.value - right.value);
  const darkest = samples.slice(0, Math.max(1, Math.round(samples.length * 0.2)));
  const channelsAverage = [0, 1, 2].map((channel) => Math.round(
    darkest.reduce((sum, sample) => sum + sample.colour[channel], 0) / darkest.length
  ));
  return toHex(channelsAverage);
}

/**
 * Measure the station gear and the half-stop disc.
 *
 * A pixel belongs to the mark when its green channel clearly dominates the
 * other two: the printed board is warm brown and beige everywhere else, so
 * this separates the mark from the map without a hand-picked threshold on
 * brightness.
 */
function measureStationMark() {
  const isGreen = (colour) => colour[1] > colour[0] + 8
    && colour[1] > colour[2] + 18
    && colour[1] > 60
    && colour[1] < 170;

  const outer = [];
  const inner = [];
  for (let angle = 0; angle < 360; angle += 1) {
    const radians = (angle * Math.PI) / 180;
    let first = null;
    let last = null;
    for (let radius = 0; radius <= 79; radius += 0.25) {
      const colour = pixel(
        STATION_CENTRE.x + Math.cos(radians) * radius,
        STATION_CENTRE.y + Math.sin(radians) * radius
      );
      if (!isGreen(colour)) continue;
      if (first === null) first = radius;
      last = radius;
    }
    if (last !== null) {
      outer.push(last);
      inner.push(first);
    }
  }
  const sortedOuter = [...outer].sort((left, right) => left - right);
  // Tooth tips are the outer decile of the radii, tooth roots the inner one.
  const tipRadius = quantile(sortedOuter, 0.9);
  const rootRadius = quantile(sortedOuter, 0.1);

  const rhythm = measureToothRhythm(STATION_CENTRE, rootRadius, tipRadius, isGreen);

  const ringColours = [];
  for (let angle = 0; angle < 360; angle += 1) {
    const radians = (angle * Math.PI) / 180;
    for (let radius = 37; radius <= 45; radius += 1) {
      const colour = pixel(
        STATION_CENTRE.x + Math.cos(radians) * radius,
        STATION_CENTRE.y + Math.sin(radians) * radius
      );
      if (isGreen(colour)) ringColours.push(colour);
    }
  }
  const discColours = [];
  for (let angle = 0; angle < 360; angle += 0.5) {
    const radians = (angle * Math.PI) / 180;
    // Radii 22…29 are inside the disc and outside the printed number.
    for (let radius = 22; radius <= 29; radius += 0.5) {
      discColours.push(pixel(
        STATION_CENTRE.x + Math.cos(radians) * radius,
        STATION_CENTRE.y + Math.sin(radians) * radius
      ));
    }
  }

  const waypointRadii = [];
  for (let angle = 0; angle < 360; angle += 1) {
    const radians = (angle * Math.PI) / 180;
    let last = null;
    for (let radius = 0; radius <= 59; radius += 0.25) {
      const colour = pixel(
        WAYPOINT_CENTRE.x + Math.cos(radians) * radius,
        WAYPOINT_CENTRE.y + Math.sin(radians) * radius
      );
      if (isGreen(colour)) last = radius;
    }
    if (last !== null) waypointRadii.push(last);
  }

  return {
    teeth: rhythm.teeth,
    toothUpwardOffsetDeg: round(rhythm.upwardOffsetDeg),
    tipRadiusPx: round(tipRadius),
    rootRadiusPx: round(rootRadius),
    discRadiusPx: round(median(inner)),
    waypointRadiusPx: round(median(waypointRadii)),
    greenHex: toHex(medianColour(ringColours)),
    discHex: toHex(medianColour(discColours)),
    labelInkHex: toHex(labelInk()),
    labelCapHeightPx: labelCapHeight()
  };
}

/**
 * Measure the angular rhythm of the gear teeth: how many there are and where
 * they stand.
 *
 * Simply counting green stretches on one circle is unreliable: near the tooth
 * roots the gaps close up, near the tips a rounded tooth drops out, and a
 * single speck of the paper texture adds a spurious tooth. Instead the green
 * mask is averaged over a band of radii between roots and tips and treated as
 * a periodic signal; the number of teeth is the angular frequency with the
 * strongest response. On the author board that frequency stands out by an
 * order of magnitude over every other one, and it is the same for every
 * station mark.
 *
 * The phase of that same frequency says where the teeth stand. It is reported
 * as the angle between the nearest tooth centre and straight up, because the
 * drawn mark covers the grey icon printed on the map: if the teeth stood at a
 * different angle, the printed one would show through the gaps.
 */
function measureToothRhythm(centre, rootRadius, tipRadius, isGreen) {
  const samples = 1440;
  const signal = [];
  for (let index = 0; index < samples; index += 1) {
    const radians = (index * 2 * Math.PI) / samples;
    let green = 0;
    let taken = 0;
    for (let share = 0.2; share <= 0.8; share += 0.05) {
      const radius = rootRadius + (tipRadius - rootRadius) * share;
      green += isGreen(pixel(
        centre.x + Math.cos(radians) * radius,
        centre.y + Math.sin(radians) * radius
      )) ? 1 : 0;
      taken += 1;
    }
    signal.push(green / taken);
  }
  const mean = signal.reduce((sum, value) => sum + value, 0) / samples;
  let best = { frequency: 0, magnitude: -1, phase: 0 };
  for (let frequency = 6; frequency <= 20; frequency += 1) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < samples; index += 1) {
      const radians = (index * 2 * Math.PI) / samples;
      real += (signal[index] - mean) * Math.cos(frequency * radians);
      imaginary += (signal[index] - mean) * Math.sin(frequency * radians);
    }
    const magnitude = Math.hypot(real, imaginary) / samples;
    if (magnitude > best.magnitude) {
      best = { frequency, magnitude, phase: Math.atan2(imaginary, real) };
    }
  }
  // The signal peaks where a tooth stands, at angle phase / teeth. Straight up
  // is -90°, and tooth centres repeat every full step, so the offset is the
  // remainder folded into half a step on either side.
  const step = 360 / best.frequency;
  const firstToothDeg = (best.phase * 180) / Math.PI / best.frequency;
  let upwardOffsetDeg = (firstToothDeg + 90) % step;
  if (upwardOffsetDeg > step / 2) upwardOffsetDeg -= step;
  if (upwardOffsetDeg < -step / 2) upwardOffsetDeg += step;
  return { teeth: best.frequency, upwardOffsetDeg };
}

/** Ink of the printed number: the darkest eighth of the pixels on the disc. */
function labelInk() {
  const samples = [];
  for (let y = STATION_CENTRE.y - 22; y <= STATION_CENTRE.y + 22; y += 1) {
    for (let x = STATION_CENTRE.x - 22; x <= STATION_CENTRE.x + 22; x += 1) {
      if (Math.hypot(x - STATION_CENTRE.x, y - STATION_CENTRE.y) > 22) continue;
      samples.push({ value: luminance(x, y), colour: pixel(x, y) });
    }
  }
  samples.sort((left, right) => left.value - right.value);
  const darkest = samples.slice(0, Math.max(1, Math.round(samples.length * 0.12)));
  return [0, 1, 2].map((channel) => Math.round(
    darkest.reduce((sum, sample) => sum + sample.colour[channel], 0) / darkest.length
  ));
}

/**
 * Height of the printed digit, used to size the drawn label.
 *
 * Only pixels well inside the light disc are examined, so the darker ring
 * around it never enters the measurement. A row counts as part of the digit
 * when it holds at least two clearly dark pixels, which ignores the single
 * dark specks of the paper texture.
 */
function labelCapHeight() {
  const insideDisc = 20;
  let top = null;
  let bottom = null;
  for (let y = STATION_CENTRE.y - insideDisc; y <= STATION_CENTRE.y + insideDisc; y += 1) {
    let dark = 0;
    for (let x = STATION_CENTRE.x - insideDisc; x <= STATION_CENTRE.x + insideDisc; x += 1) {
      if (Math.hypot(x - STATION_CENTRE.x, y - STATION_CENTRE.y) > insideDisc) continue;
      const [red, green, blue] = pixel(x, y);
      if (red + green + blue < 430) dark += 1;
    }
    if (dark < 2) continue;
    if (top === null) top = y;
    bottom = y;
  }
  return top === null ? 0 : bottom - top + 1;
}

/** Read the constants the player actually draws with. */
function readRendererConstants() {
  const source = readFileSync(STYLE_MODULE_PATH, "utf8");
  const number = (name) => {
    const match = new RegExp(`${name}:\\s*([0-9.]+)`, "u").exec(source);
    if (!match) throw new Error(`author-network-style.ts has no "${name}".`);
    return Number(match[1]);
  };
  const colour = (name) => {
    const match = new RegExp(`${name}\\s*=\\s*0x([0-9a-f]{6})`, "u").exec(source);
    if (!match) throw new Error(`author-network-style.ts has no "${name}".`);
    return `#${match[1]}`;
  };
  return {
    railOffset: number("railOffset"),
    railWidth: number("railWidth"),
    sleeperWidth: number("sleeperWidth"),
    sleeperHalfLength: number("sleeperHalfLength"),
    sleeperSpacing: number("sleeperSpacing"),
    teeth: number("teeth"),
    rootRadius: number("rootRadius"),
    tipRadius: number("tipRadius"),
    discRadius: number("discRadius"),
    waypointRadius: number("waypointRadius"),
    trackInk: colour("AUTHOR_TRACK_INK"),
    stationGreen: colour("AUTHOR_STATION_GREEN"),
    stationDisc: colour("AUTHOR_STATION_DISC"),
    labelInk: colour("AUTHOR_STATION_LABEL_INK")
  };
}

/** List every renderer constant that no longer matches the measurement. */
function compareWithRenderer(measured, actual) {
  const drift = [];
  const compareLength = (label, expected, value) => {
    if (Math.abs(expected - value) > LENGTH_TOLERANCE_PX) {
      drift.push(`${label}: измерено ${expected}, в отрисовке ${value}`);
    }
  };
  const compareColour = (label, expected, value) => {
    const parse = (hex) => [1, 3, 5].map((index) =>
      Number.parseInt(hex.slice(index, index + 2), 16));
    const distance = Math.max(...parse(expected)
      .map((channel, index) => Math.abs(channel - parse(value)[index])));
    if (distance > COLOUR_TOLERANCE) {
      drift.push(`${label}: измерено ${expected}, в отрисовке ${value}`);
    }
  };
  compareLength("отступ рельса", measured.track.railOffsetPx, actual.railOffset);
  compareLength("ширина рельса", measured.track.railWidthPx, actual.railWidth);
  compareLength("ширина шпалы", measured.track.sleeperWidthPx, actual.sleeperWidth);
  compareLength(
    "половина длины шпалы",
    measured.track.sleeperHalfLengthPx,
    actual.sleeperHalfLength
  );
  compareLength("шаг шпал", measured.track.sleeperSpacingPx, actual.sleeperSpacing);
  compareLength("радиус вершин зубьев", measured.station.tipRadiusPx, actual.tipRadius);
  compareLength(
    "радиус основания зубьев",
    measured.station.rootRadiusPx,
    actual.rootRadius
  );
  compareLength("радиус светлого круга", measured.station.discRadiusPx, actual.discRadius);
  compareLength(
    "радиус полустанка",
    measured.station.waypointRadiusPx,
    actual.waypointRadius
  );
  if (measured.station.teeth !== actual.teeth) {
    drift.push(
      `число зубьев: измерено ${measured.station.teeth}, в отрисовке ${actual.teeth}`
    );
  }
  // The renderer places a tooth centre exactly upwards; the measurement must
  // agree, otherwise the drawn mark lets the printed grey icon show through.
  if (Math.abs(measured.station.toothUpwardOffsetDeg) > 2) {
    drift.push(
      "положение зубьев: измеренный сдвиг от вертикали "
      + `${measured.station.toothUpwardOffsetDeg}°, отрисовка ставит зуб строго вверх`
    );
  }
  compareColour("цвет дороги", measured.track.inkHex, actual.trackInk);
  compareColour("зелёный станции", measured.station.greenHex, actual.stationGreen);
  compareColour("светлый круг", measured.station.discHex, actual.stationDisc);
  compareColour("цвет номера", measured.station.labelInkHex, actual.labelInk);
  return drift;
}

function groupConsecutive(values) {
  const runs = [];
  let start = null;
  let previous = null;
  for (const value of values) {
    if (start === null) start = value;
    else if (previous !== null && value !== previous + 1) {
      runs.push({ from: start, to: previous });
      start = value;
    }
    previous = value;
  }
  if (start !== null && previous !== null) runs.push({ from: start, to: previous });
  return runs;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function quantile(sorted, share) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

function medianColour(colours) {
  return [0, 1, 2].map((channel) =>
    Math.round(median(colours.map((colour) => colour[channel]))));
}

function toHex(colour) {
  return `#${colour.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function writeAtomically(filePath, bytes) {
  let mode = 0o644;
  try {
    mode = statSync(filePath).mode;
  } catch {
    // First run: the record does not exist yet and default permissions apply.
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, bytes, { flag: "wx", mode });
  renameSync(temporaryPath, filePath);
}
