#!/usr/bin/env node
/**
 * Antarctica legacy-vs-manifest parity report generator.
 *
 * "Parity report" means a generated comparison artifact that lists matching
 * and mismatching facts between the legacy prototype and the canonical
 * manifest. The legacy file is processed by script-only extraction; agents
 * should not manually read `GameFull.html` as prose during migration.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_LEGACY_PATH = path.join(REPO_ROOT, "draft/Antarctica/GameFull.html");
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, "games/antarctica/game.manifest.json");
const DEFAULT_OUT_PATH = path.join(
  REPO_ROOT,
  ".tmp/agent-workflow/antarctica-full-scenario-parity-2026-04-11/parity-report.json"
);
const DEFAULT_MARKDOWN_OUT_PATH = path.join(
  REPO_ROOT,
  ".tmp/agent-workflow/antarctica-full-scenario-parity-2026-04-11/parity-report.md"
);

const METRIC_KEYS = ["pro", "rep", "lid", "man", "stat", "cont", "constr", "time"];
const STUB_FUNCTION_NAMES = ["goTo", "swap", "unlock", "f34", "f25_30", "unlock39"];
const INTENTIONAL_MANIFEST_EXTRAS = new Map([
  ["cards:23", ["3902"]],
  ["info:35", ["i19_1"]]
]);

function parseArgs(argv) {
  const options = {
    legacy: DEFAULT_LEGACY_PATH,
    manifest: DEFAULT_MANIFEST_PATH,
    out: DEFAULT_OUT_PATH,
    markdownOut: DEFAULT_MARKDOWN_OUT_PATH,
    strict: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === "--legacy" && value) {
      options.legacy = path.resolve(value);
      index += 1;
      continue;
    }
    if (key === "--manifest" && value) {
      options.manifest = path.resolve(value);
      index += 1;
      continue;
    }
    if (key === "--out" && value) {
      options.out = path.resolve(value);
      index += 1;
      continue;
    }
    if (key === "--markdown-out" && value) {
      options.markdownOut = path.resolve(value);
      index += 1;
      continue;
    }
    if (key === "--strict") {
      options.strict = true;
      continue;
    }
    if (key === "--no-markdown") {
      options.markdownOut = null;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${key}`);
  }

  return options;
}

function readTextViaStream(filePath) {
  return new Promise((resolve, reject) => {
    let text = "";
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });

    stream.on("data", (chunk) => {
      text += chunk;
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(text));
  });
}

function createStubFunction(name) {
  const stub = function cubicaActionStub() {
    throw new Error(`Function stub "${name}" must not execute during extraction`);
  };
  Object.defineProperty(stub, "__symbolicName", {
    value: name,
    enumerable: false,
    writable: false
  });
  return stub;
}

function buildSandbox(extra = {}) {
  const sandbox = { ...extra };
  for (const name of STUB_FUNCTION_NAMES) {
    sandbox[name] = createStubFunction(name);
  }
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function findMatchingBrace(source, openBraceIndex, label) {
  if (source[openBraceIndex] !== "{") {
    throw new Error(`${label}: expected "{" at index ${openBraceIndex}`);
  }

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingleQuote) {
      if (ch === "\\") i += 1;
      else if (ch === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (ch === "\\") i += 1;
      else if (ch === "\"") inDoubleQuote = false;
      continue;
    }
    if (inTemplateQuote) {
      if (ch === "\\") i += 1;
      else if (ch === "`") inTemplateQuote = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      continue;
    }
    if (ch === "\"") {
      inDoubleQuote = true;
      continue;
    }
    if (ch === "`") {
      inTemplateQuote = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  throw new Error(`${label}: unmatched braces`);
}

function extractObjectLiteralByAssignment(source, markerRegex, label) {
  const markerMatch = markerRegex.exec(source);
  if (!markerMatch || markerMatch.index === undefined) {
    throw new Error(`Could not find ${label} assignment`);
  }

  const markerEnd = markerMatch.index + markerMatch[0].length;
  let openBraceIndex = markerEnd;
  while (openBraceIndex < source.length && /\s/.test(source[openBraceIndex])) {
    openBraceIndex += 1;
  }

  if (source[openBraceIndex] !== "{") {
    openBraceIndex = source.indexOf("{", markerEnd);
  }
  if (openBraceIndex < 0) {
    throw new Error(`${label}: opening "{" not found`);
  }

  const closeBraceIndex = findMatchingBrace(source, openBraceIndex, label);
  return source.slice(openBraceIndex, closeBraceIndex + 1);
}

function evaluateObjectLiteral(literalSource, sandbox, label) {
  try {
    return vm.runInContext(`(${literalSource})`, sandbox, { timeout: 2000 });
  } catch (error) {
    throw new Error(`Failed to evaluate ${label}: ${error.message}`);
  }
}

function extractLegacyObjects(html) {
  const cardsLiteral = extractObjectLiteralByAssignment(html, /var\s+cardsObj\s*=\s*/m, "cardsObj");
  const cardsObj = evaluateObjectLiteral(cardsLiteral, buildSandbox(), "cardsObj literal");

  const gameLiteral = extractObjectLiteralByAssignment(html, /\bgame\s*=\s*/m, "game");
  const gameObj = evaluateObjectLiteral(gameLiteral, buildSandbox({ cardsObj }), "game literal");

  return { cardsObj, gameObj };
}

function getBlockType(cardsObj, ids) {
  const firstCard = cardsObj[String(ids[0])];
  return firstCard && typeof firstCard.type === "string" ? firstCard.type : "unknown";
}

function collectLegacyMainLine(cardsObj, gameObj) {
  if (!Array.isArray(gameObj.timeline) || !Array.isArray(gameObj.timeline[0])) {
    throw new Error("game.timeline[0] is missing or invalid");
  }

  return gameObj.timeline[0]
    .map((rawStep, stepIndex) => {
      if (!Array.isArray(rawStep) || rawStep.length === 0) return null;
      const ids = rawStep.map((id) => String(id));
      const blockType = getBlockType(cardsObj, ids);
      const firstCard = cardsObj[ids[0]] ?? {};
      const block = {
        lineIndex: 0,
        stepIndex,
        blockType,
        ids
      };
      if (blockType === "info") {
        block.title = typeof firstCard.title === "string" ? firstCard.title : "";
      }
      return block;
    })
    .filter(Boolean);
}

function collectLegacyInitialMetrics(gameObj) {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, gameObj[key]]));
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function sortIds(ids) {
  return [...ids].map(String).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function compareIdSets(legacyIds, manifestIds) {
  const legacy = legacyIds.map(String);
  const manifest = manifestIds.map(String);
  const legacySet = new Set(legacy);
  const manifestSet = new Set(manifest);
  const missingInManifest = legacy.filter((id) => !manifestSet.has(id));
  const extraInManifest = manifest.filter((id) => !legacySet.has(id));

  return {
    status: missingInManifest.length === 0 && extraInManifest.length === 0 ? "match" : "mismatch",
    missingInManifest,
    extraInManifest
  };
}

function compareStepIds(kind, stepIndex, legacyIds, manifestIds) {
  const comparison = compareIdSets(legacyIds, manifestIds);
  const allowedExtras = INTENTIONAL_MANIFEST_EXTRAS.get(`${kind}:${stepIndex}`) ?? [];

  if (
    comparison.status === "mismatch" &&
    comparison.missingInManifest.length === 0 &&
    comparison.extraInManifest.length > 0 &&
    comparison.extraInManifest.every((id) => allowedExtras.includes(id))
  ) {
    return {
      ...comparison,
      status: "intentional-extension",
      note: "Manifest includes a documented bounded alternate variant for this legacy step."
    };
  }

  return comparison;
}

function indexByStep(items) {
  const index = new Map();
  for (const item of items) {
    if (typeof item.stepIndex !== "number") continue;
    const key = String(item.stepIndex);
    const bucket = index.get(key) ?? [];
    bucket.push(item);
    index.set(key, bucket);
  }
  return index;
}

function readActionProvenanceStep(action) {
  const provenance = action?.deterministic?.provenance;
  if (!Array.isArray(provenance)) return null;
  const first = provenance.find((entry) => typeof entry?.stepIndex === "number");
  return first ? first.stepIndex : null;
}

function buildManifestProjection(manifest) {
  const antarctica = manifest.content?.antarctica ?? {};
  const boards = toArray(antarctica.boards);
  const infos = toArray(antarctica.infos);
  const cards = toArray(antarctica.cards);
  const teamSelections = toArray(antarctica.teamSelections);
  const actions = manifest.actions ?? {};

  return {
    initialMetrics: manifest.state?.public?.metrics ?? {},
    boards,
    infos,
    cards,
    teamSelections,
    actions,
    indexes: {
      boardsByStep: indexByStep(boards),
      infosByStep: indexByStep(infos),
      teamSelectionsByStep: indexByStep(teamSelections)
    }
  };
}

function compareTimelineBlocks(legacyBlocks, manifestProjection) {
  return legacyBlocks.map((legacyBlock) => {
    if (legacyBlock.blockType === "cards") {
      const boards = manifestProjection.indexes.boardsByStep.get(String(legacyBlock.stepIndex)) ?? [];
      const manifestIds = boards.flatMap((board) => board.cardIds ?? []);
      return {
        kind: "cards",
        stepIndex: legacyBlock.stepIndex,
        legacyIds: legacyBlock.ids,
        manifestBoardIds: boards.map((board) => board.id),
        manifestIds,
        ...compareStepIds("cards", legacyBlock.stepIndex, legacyBlock.ids, manifestIds)
      };
    }

    if (legacyBlock.blockType === "info") {
      const infos = manifestProjection.indexes.infosByStep.get(String(legacyBlock.stepIndex)) ?? [];
      const manifestIds = infos.map((info) => info.id);
      return {
        kind: "info",
        stepIndex: legacyBlock.stepIndex,
        legacyIds: legacyBlock.ids,
        manifestIds,
        manifestInfoTitles: infos.map((info) => info.title),
        ...compareStepIds("info", legacyBlock.stepIndex, legacyBlock.ids, manifestIds)
      };
    }

    if (legacyBlock.blockType === "team") {
      const selections = manifestProjection.indexes.teamSelectionsByStep.get(String(legacyBlock.stepIndex)) ?? [];
      const manifestIds = selections.flatMap((selection) => (selection.members ?? []).map((member) => member.memberId));
      return {
        kind: "team",
        stepIndex: legacyBlock.stepIndex,
        legacyIds: legacyBlock.ids,
        manifestSelectionIds: selections.map((selection) => selection.id),
        manifestIds,
        ...compareIdSets(legacyBlock.ids, manifestIds)
      };
    }

    return {
      kind: legacyBlock.blockType,
      stepIndex: legacyBlock.stepIndex,
      legacyIds: legacyBlock.ids,
      status: "unclassified"
    };
  });
}

function compareInitialMetrics(legacyMetrics, manifestMetrics) {
  return METRIC_KEYS.map((metricId) => ({
    metricId,
    legacy: legacyMetrics[metricId],
    manifest: manifestMetrics[metricId],
    status: legacyMetrics[metricId] === manifestMetrics[metricId] ? "match" : "mismatch"
  }));
}

function inspectManifestActions(manifestProjection) {
  const actionIds = Object.keys(manifestProjection.actions);
  const missingDeterministic = actionIds.filter((id) => !manifestProjection.actions[id].deterministic);
  const missingSelectActions = [];
  const missingAdvanceActions = [];
  const boardStepProvenanceMismatches = [];

  for (const card of manifestProjection.cards) {
    if (card.selectActionId && !manifestProjection.actions[card.selectActionId]) {
      missingSelectActions.push({ cardId: card.cardId, actionId: card.selectActionId });
    }
    if (card.advanceActionId && !manifestProjection.actions[card.advanceActionId]) {
      missingAdvanceActions.push({ cardId: card.cardId, actionId: card.advanceActionId });
    }
  }

  for (const board of manifestProjection.boards) {
    for (const cardId of board.cardIds ?? []) {
      const card = manifestProjection.cards.find((entry) => String(entry.cardId) === String(cardId));
      const action = card?.selectActionId ? manifestProjection.actions[card.selectActionId] : null;
      const provenanceStepIndex = readActionProvenanceStep(action);
      if (typeof provenanceStepIndex === "number" && provenanceStepIndex !== board.stepIndex) {
        boardStepProvenanceMismatches.push({
          boardId: board.id,
          boardStepIndex: board.stepIndex,
          cardId: String(cardId),
          selectActionId: card?.selectActionId ?? null,
          provenanceStepIndex
        });
      }
    }
  }

  return {
    actionCount: actionIds.length,
    missingDeterministic,
    missingSelectActions,
    missingAdvanceActions,
    boardStepProvenanceMismatches
  };
}

function buildSummary(report) {
  const timelineMismatches = report.comparisons.timeline.filter((entry) => entry.status === "mismatch");
  const metricMismatches = report.comparisons.initialMetrics.filter((entry) => entry.status === "mismatch");
  const actionIssues =
    report.comparisons.actions.missingSelectActions.length +
    report.comparisons.actions.missingAdvanceActions.length +
    report.comparisons.actions.boardStepProvenanceMismatches.length;

  return {
    legacyBlockCount: report.legacy.mainLineBlocks.length,
    manifestBoardCount: report.manifest.boards.length,
    manifestInfoCount: report.manifest.infos.length,
    manifestCardCount: report.manifest.cards.length,
    actionCount: report.comparisons.actions.actionCount,
    timelineMismatchCount: timelineMismatches.length,
    metricMismatchCount: metricMismatches.length,
    actionIssueCount: actionIssues,
    finalTailStatus: report.findings.finalTail
  };
}

function findFinalTail(comparisons, actionComparison) {
  const step34 = comparisons.timeline.find((entry) => entry.kind === "cards" && entry.stepIndex === 34);
  const step36 = comparisons.timeline.find((entry) => entry.kind === "cards" && entry.stepIndex === 36);
  const provenanceMismatchIds = new Set(
    actionComparison.boardStepProvenanceMismatches.map((entry) => String(entry.cardId))
  );

  return {
    status:
      step34?.status === "mismatch" || step36?.status === "mismatch" || provenanceMismatchIds.has("69") || provenanceMismatchIds.has("70")
        ? "mismatch"
        : "match",
    step34,
    step36,
    boardStepProvenanceMismatches: actionComparison.boardStepProvenanceMismatches.filter((entry) =>
      ["67", "68", "69", "70"].includes(String(entry.cardId))
    ),
    note:
      "Legacy targeted extraction separates cards 67,68 at step 34 and 69,70 at step 36. Manifest projection should not group 69,70 into step 34 unless documented as an intentional projection."
  };
}

function toCompactManifest(manifestProjection) {
  return {
    initialMetrics: manifestProjection.initialMetrics,
    boards: manifestProjection.boards.map((board) => ({
      id: board.id,
      stepIndex: board.stepIndex,
      screenId: board.screenId,
      cardIds: board.cardIds ?? []
    })),
    infos: manifestProjection.infos.map((info) => ({
      id: info.id,
      stepIndex: info.stepIndex,
      screenId: info.screenId,
      advanceActionId: info.advanceActionId
    })),
    teamSelections: manifestProjection.teamSelections.map((selection) => ({
      id: selection.id,
      stepIndex: selection.stepIndex,
      memberIds: (selection.members ?? []).map((member) => member.memberId)
    })),
    cards: manifestProjection.cards.map((card) => ({
      cardId: card.cardId,
      selectActionId: card.selectActionId,
      advanceActionId: card.advanceActionId
    }))
  };
}

function renderMarkdown(report) {
  const mismatchLines = report.comparisons.timeline
    .filter((entry) => entry.status === "mismatch")
    .map(
      (entry) =>
        `- step ${entry.stepIndex} ${entry.kind}: legacy [${entry.legacyIds.join(", ")}], manifest [${entry.manifestIds.join(", ")}]`
    );
  const provenanceLines = report.comparisons.actions.boardStepProvenanceMismatches.map(
    (entry) =>
      `- card ${entry.cardId}: board ${entry.boardId} step ${entry.boardStepIndex}, action provenance step ${entry.provenanceStepIndex}`
  );

  return [
    "# Antarctica Manifest Parity Report",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Legacy blocks: ${report.summary.legacyBlockCount}`,
    `- Manifest boards: ${report.summary.manifestBoardCount}`,
    `- Manifest infos: ${report.summary.manifestInfoCount}`,
    `- Manifest cards: ${report.summary.manifestCardCount}`,
    `- Timeline mismatches: ${report.summary.timelineMismatchCount}`,
    `- Metric mismatches: ${report.summary.metricMismatchCount}`,
    `- Action issues: ${report.summary.actionIssueCount}`,
    `- Final tail status: ${report.summary.finalTailStatus.status}`,
    "",
    "## Timeline Mismatches",
    "",
    ...(mismatchLines.length ? mismatchLines : ["- None"]),
    "",
    "## Board Step Provenance Mismatches",
    "",
    ...(provenanceLines.length ? provenanceLines : ["- None"]),
    "",
    "## Final Tail Finding",
    "",
    report.findings.finalTail.note,
    ""
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv);
  const [legacyHtml, manifestRaw] = await Promise.all([
    readTextViaStream(options.legacy),
    fs.promises.readFile(options.manifest, "utf8")
  ]);
  const { cardsObj, gameObj } = extractLegacyObjects(legacyHtml);
  const manifest = JSON.parse(manifestRaw);
  const manifestProjection = buildManifestProjection(manifest);
  const legacyMainLineBlocks = collectLegacyMainLine(cardsObj, gameObj);
  const legacyInitialMetrics = collectLegacyInitialMetrics(gameObj);

  const timelineComparisons = compareTimelineBlocks(legacyMainLineBlocks, manifestProjection);
  const actionComparison = inspectManifestActions(manifestProjection);
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      legacy: path.relative(REPO_ROOT, options.legacy),
      manifest: path.relative(REPO_ROOT, options.manifest)
    },
    legacy: {
      initialMetrics: legacyInitialMetrics,
      mainLineBlocks: legacyMainLineBlocks
    },
    manifest: toCompactManifest(manifestProjection),
    comparisons: {
      initialMetrics: compareInitialMetrics(legacyInitialMetrics, manifestProjection.initialMetrics),
      timeline: timelineComparisons,
      actions: actionComparison
    },
    findings: {}
  };

  report.findings.finalTail = findFinalTail(report.comparisons, actionComparison);
  report.summary = buildSummary(report);

  await fs.promises.mkdir(path.dirname(options.out), { recursive: true });
  await fs.promises.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.markdownOut) {
    await fs.promises.mkdir(path.dirname(options.markdownOut), { recursive: true });
    await fs.promises.writeFile(options.markdownOut, renderMarkdown(report), "utf8");
  }

  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);

  if (options.strict && (report.summary.timelineMismatchCount > 0 || report.summary.metricMismatchCount > 0 || report.summary.actionIssueCount > 0)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
