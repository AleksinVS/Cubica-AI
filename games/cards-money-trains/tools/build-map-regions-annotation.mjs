#!/usr/bin/env node
/**
 * Build the single map annotation the road-building planner needs: the real
 * transport network together with the real region partition of the map.
 *
 * WHY THIS FILE EXISTS (for a newcomer to this game):
 * The raster image behind the Cards, Money, Trains board is only a picture —
 * it does not itself carry any transport network or region boundaries. Two
 * independent, human-reviewed extractions already exist on disk:
 *   - `initial-network.review.json` — 25 stations/waypoints and 10 roads
 *     traced from the network image (see games/cards-money-trains/tools/
 *     convert-map-annotation.mjs for how this feeds the manifest once
 *     confirmed).
 *   - `vector-map.region-partition.draft.json` — a much bigger, separately
 *     produced partition of the same map into 917 small playable "regions"
 *     (each region belongs to exactly one of the ten in-game countries).
 * The road-building planner (see `roadPlanning` / `createRoadPlanningContract`
 * in scripts/map-annotation/map-annotation.mjs) prices a new road by how many
 * *regions* it must cross, not just its length, so it needs both the network
 * and the regions in one annotation. Until this tool existed, the manifest
 * instead carried a technical placeholder network model of 20 vertical
 * strips — a stand-in shape invented only so the planner had *something* to
 * route through, unrelated to the real map. This script produces the real
 * replacement by mechanically merging the two review artifacts above into one
 * file that the shared intake pipeline
 * (scripts/map-annotation/map-annotation.mjs, `validateMapAnnotation`) accepts.
 *
 * The transform is pure and deterministic: the same two input files always
 * produce the same output bytes, so the result can be committed and diffed
 * like any other reviewed artifact. This tool does not touch
 * game.manifest.json or authoring/ — wiring the produced annotation into the
 * manifest is a separate, later step.
 *
 * WHY THE OUTPUT STATUS IS "author-confirmed":
 * A map annotation's `status` is the boundary between an unpublished review
 * draft and real game content (see `createTransportManifestFragment` in
 * scripts/map-annotation/map-annotation.mjs): the shared pipeline only ever
 * builds a manifest fragment from "mock" or "author-confirmed" annotations,
 * never from "review-draft" or "template", and a publishable status is not
 * allowed to carry any open `reviewIssues`. Both open questions this tool
 * used to record — network/PNG overlay alignment and region/country semantic
 * assignment — have since been separately confirmed by a human (the PM); the
 * `warning` field below records who confirmed what, on which evidence, and
 * when, so a reader does not have to dig up the original conversation to
 * trust this file. Emitting "author-confirmed" here is therefore not an
 * automatic escalation — it mechanically records a decision a human already
 * made outside this script.
 *
 * Usage:
 *   node games/cards-money-trains/tools/build-map-regions-annotation.mjs
 *   node games/cards-money-trains/tools/build-map-regions-annotation.mjs --check
 *
 * Exit code: 0 on success; 1 with a message on stderr if a source is
 * malformed, the merged annotation fails the shared schema/geometry checks,
 * or (with --check) the file on disk does not match what the sources would
 * currently produce.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateMapAnnotation } from "../../../scripts/map-annotation/map-annotation.mjs";

const moduleFile = fileURLToPath(import.meta.url);
const toolsDirectory = path.dirname(moduleFile);
const annotationsDirectory = path.resolve(toolsDirectory, "..", "annotations");

const NETWORK_PATH = path.join(annotationsDirectory, "initial-network.review.json");
const PARTITION_PATH = path.join(annotationsDirectory, "vector-map.region-partition.draft.json");
const OUTPUT_PATH = path.join(annotationsDirectory, "initial-network-with-regions.review.json");

// Fixed expectations from the task, checked explicitly so a future edit of
// either source file that changes these counts fails loudly here instead of
// silently drifting the merged output.
const EXPECTED_NODE_COUNT = 25;
const EXPECTED_EDGE_COUNT = 10;
const EXPECTED_REGION_COUNT = 917;
const EXPECTED_EMPTY_SPACE_COUNT = 3;

const fail = (message) => { throw new Error(message); };

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));

/**
 * Turn one partition-draft exterior ring into the schema's required closed
 * polygon: an array of {x, y} points whose last point repeats the first.
 *
 * The task brief describes the draft's rings as open (last point different
 * from the first), but the ring actually stored on disk today already
 * repeats its first point as its last. Appending the first point again
 * unconditionally would create a duplicate, zero-length final side and fail
 * the shared self-intersection check. Comparing first-to-last instead of
 * assuming one fixed convention keeps this tool correct either way, including
 * if a future regeneration of the draft switches to a genuinely open ring.
 */
const closePolygon = (exteriorRing) => {
  const points = exteriorRing.map(([x, y]) => ({ x, y }));
  const first = points[0];
  const last = points[points.length - 1];
  const alreadyClosed = first.x === last.x && first.y === last.y;
  return alreadyClosed ? points : [...points, { x: first.x, y: first.y }];
};

/**
 * Convert every partition-draft region into the schema's region shape.
 *
 * Only `id`, `countryId` and a closed `polygon` survive from the draft; the
 * schema's region definition is closed (`additionalProperties: false`), so
 * draft-only bookkeeping fields such as `geometryFingerprint`, `areaPx2`,
 * `bounds`, `stationIds` and `waypointIds` are intentionally dropped here —
 * they belong to the partition tool's own review, not to the runtime
 * contract. `countryName` is not carried over as a field (the schema has no
 * place for it); instead it is folded into the human-readable `label` so a
 * reviewer can still see which country a region belongs to at a glance.
 */
const buildRegions = (partitionRegions) => {
  // Sorting by id — the draft already happens to store regions in this order,
  // but sorting explicitly means the output does not depend on that
  // incidental order, only on the stable region id, which keeps the tool
  // deterministic even if the partition draft is regenerated in a different
  // internal order.
  const sortedById = [...partitionRegions].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  // Per-country sequence numbers for the label, assigned in the same
  // deterministic id order so a rerun always numbers each country's regions
  // identically.
  const countryOrdinal = new Map();

  return sortedById.map((region) => {
    if (Array.isArray(region.interiorRings) && region.interiorRings.length > 0) {
      fail(
        `region "${region.id}" has a non-empty interiorRings; this tool only ` +
        "expects simple polygons without holes"
      );
    }
    const ordinal = (countryOrdinal.get(region.countryId) ?? 0) + 1;
    countryOrdinal.set(region.countryId, ordinal);
    return {
      id: region.id,
      label: `${region.countryName} · ${ordinal}`,
      countryId: region.countryId,
      polygon: closePolygon(region.exteriorRing)
    };
  });
};

/** Assemble the merged annotation object from the two validated sources. */
const buildAnnotation = (network, partition) => {
  if (network.nodes.length !== EXPECTED_NODE_COUNT) {
    fail(`expected ${EXPECTED_NODE_COUNT} nodes in the network source, found ${network.nodes.length}`);
  }
  if (network.edges.length !== EXPECTED_EDGE_COUNT) {
    fail(`expected ${EXPECTED_EDGE_COUNT} edges in the network source, found ${network.edges.length}`);
  }
  if (!Array.isArray(partition.regions) || partition.regions.length !== EXPECTED_REGION_COUNT) {
    fail(`expected ${EXPECTED_REGION_COUNT} regions in the partition draft, found ${partition.regions?.length ?? "none"}`);
  }
  if (!Array.isArray(partition.emptySpaces) || partition.emptySpaces.length !== EXPECTED_EMPTY_SPACE_COUNT) {
    fail(
      `expected exactly ${EXPECTED_EMPTY_SPACE_COUNT} emptySpaces entries to exclude, ` +
      `found ${partition.emptySpaces?.length ?? "none"}`
    );
  }

  const regions = buildRegions(partition.regions);

  return {
    $schema: network.$schema,
    schemaVersion: network.schemaVersion,
    // Both open questions that used to keep this file at "review-draft" have
    // since been closed by a human (see the long-form record in `warning`
    // below). A publishable status must not carry unresolved reviewIssues
    // (enforced by the shared schema for "mock"/"author-confirmed"), and
    // createTransportManifestFragment() only ever accepts those two statuses
    // — never "review-draft" or "template" — so this is also the status that
    // makes the manifest-fragment step possible at all.
    status: "author-confirmed",
    warning:
      "ПРОИЗВОДНЫЙ ФАЙЛ — ПОДТВЕРЖДЁННОЕ СОДЕРЖИМОЕ (author-confirmed), " +
      "СОБРАННОЕ АВТОМАТИЧЕСКИ; НЕ РЕДАКТИРОВАТЬ ВРУЧНУЮ. Собран инструментом " +
      "games/cards-money-trains/tools/build-map-regions-annotation.mjs из двух " +
      "источников: initial-network.review.json (25 узлов, 10 дорог) и " +
      "vector-map.region-partition.draft.json (917 областей; 3 пустых пространства " +
      "исключены как непроходимые «моря» — не игровые области). " +
      "ОСНОВАНИЕ ПОДТВЕРЖДЕНИЯ, зафиксированное здесь, чтобы не поднимать " +
      "переписку: " +
      "(1) Сеть — 2026-07-25 контрольное измерение инструментом " +
      "render-initial-network-check.mjs показало, что сеть, перерисованная " +
      "целиком по данным аннотации, совпадает с авторским изображением " +
      "«Начальная транспортная сеть.png» на 95,5% покрытия и 96,6% точности при " +
      "допуске 4 px; PM лично проверил результат в работающем предпросмотре игры. " +
      "Этим измерением закрыт прежний открытый вопрос confirm-overlay-alignment. " +
      "(2) Области — 2026-07-26 PM просмотрел обзорное изображение разбиения " +
      "(vector-map.region-partition.overview.png/.svg) и подтвердил его дословно: " +
      "«Разбиение выглядит правильным. Разреши оставшиеся конфликты " +
      "самостоятельно — если ошибешься, то выявим это на стадии тестирования " +
      "игры», отдельно поручив схлопнуть щели по границам стран — это уже сделано " +
      "внутри черновика его собственным sliverRule (39 схлопнутых участков, все " +
      "у границ стран; см. README.md, раздел «Полное разбиение на области»). " +
      "Это подтверждение сделано ПОЗЖЕ даты черновика " +
      "vector-map.region-partition.draft.json: его собственные поля " +
      "policy.semanticAssignmentsConfirmed=false и " +
      "policy.runtimeIntegrationAllowed=false фиксируют состояние на момент " +
      "составления черновика, а не более позднее решение PM, и это расхождение " +
      "не противоречие, а естественный результат подтверждения, пришедшего " +
      "после черновика. 2026-07-26 PM утвердил этап подключения областей к " +
      "манифесту. Чтобы обновить этот файл — измените исходники и перезапустите " +
      "инструмент, а не этот файл напрямую.",
    // Publishable statuses ("mock"/"author-confirmed") must carry zero
    // reviewIssues by schema — both prior open questions are resolved and
    // recorded in `warning` above instead.
    reviewIssues: [],
    // The network's nodes are calibrated against this exact PNG; the
    // partition draft's own provenance records the same design-pixel
    // coordinate system (width/height), so both fit one shared space without
    // rescaling.
    sourceImage: network.sourceImage,
    coordinateSystem: network.coordinateSystem,
    nodes: network.nodes,
    edges: network.edges,
    regions
  };
};

const serialize = (annotation) => `${JSON.stringify(annotation, null, 2)}\n`;

const main = async () => {
  const checkOnly = process.argv.includes("--check");

  const [network, partition] = await Promise.all([
    readJson(NETWORK_PATH),
    readJson(PARTITION_PATH)
  ]);

  const annotation = buildAnnotation(network, partition);
  // Run the same shared validator every other game annotation goes through:
  // JSON Schema shape, unique ids, in-bounds points, closed simple polygons,
  // non-overlapping-adjacent-only geometry is NOT checked here (that check
  // lives in createTransportManifestFragment, gated behind manifest
  // publication), but schema conformance and per-region geometry are.
  await validateMapAnnotation(annotation, OUTPUT_PATH);
  const content = serialize(annotation);

  if (checkOnly) {
    let existing;
    try {
      existing = await readFile(OUTPUT_PATH, "utf8");
    } catch {
      fail(`${OUTPUT_PATH} does not exist; run without --check to build it`);
    }
    if (existing !== content) {
      fail(`${OUTPUT_PATH} is stale relative to its sources; rerun without --check to rebuild it`);
    }
    process.stdout.write(
      `build-map-regions-annotation: OK, up to date (${annotation.nodes.length} nodes, ` +
      `${annotation.edges.length} edges, ${annotation.regions.length} regions)\n`
    );
    return;
  }

  await writeFile(OUTPUT_PATH, content, "utf8");
  process.stdout.write(
    `build-map-regions-annotation: wrote ${OUTPUT_PATH} (${annotation.nodes.length} nodes, ` +
    `${annotation.edges.length} edges, ${annotation.regions.length} regions)\n`
  );
};

main().catch((error) => {
  process.stderr.write(
    `build-map-regions-annotation: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
