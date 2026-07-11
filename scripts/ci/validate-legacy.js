#!/usr/bin/env node
/**
 * Validates legacy and stub governance for CI.
 *
 * The script keeps the debt log, stub register, stub marker allowlist, and
 * `.desc.json` metadata aligned. A stub is a temporary implementation or
 * placeholder that must have a removal plan before it can enter the codebase.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const debtLogPath = path.join(repoRoot, "docs", "legacy", "debt-log.csv");
const stubsRegisterPath = path.join(repoRoot, "docs", "legacy", "stubs-register.md");
const markerAllowlistPath = path.join(repoRoot, "docs", "legacy", "stub-marker-allowlist.json");
const selfTest = process.argv.includes("--self-test-unregistered-stub");
const taskGovernanceSelfTestOnly = process.argv.includes("--self-test-task-governance");
const taskStatusSections = new Map([
  ["planned", "Next"],
  ["awaiting_approval", "Next"],
  ["approved", "Next"],
  ["in_progress", "Now"],
  ["review", "Now"],
  ["blocked", "Blocked"]
]);
const activeTaskStatuses = new Set(taskStatusSections.keys());
const taskQueueSections = new Set(taskStatusSections.values());

const requiredDebtColumns = [
  "id",
  "source",
  "component",
  "stub_reference",
  "description",
  "phase_remove",
  "risk_level",
  "priority",
  "owner",
  "issue_link",
  "last_reviewed_at",
  "status"
];

const scanRoots = ["apps", "services", "packages", "docs"];
const excludedPathParts = new Set([".git", ".next", ".tmp", "node_modules", "package-lock.json", "PROJECT_STRUCTURE.yaml"]);
const excludedPrefixes = [
  "docs/reviews/",
  "docs/tasks/archive/",
  "docs/archive/",
  "docs/architecture/",
  "docs/legacy/",
  "docs/processes/",
  "docs/tasks/",
  "docs/tasks/active/TSK-20260520-project-review-remediation.md",
  "docs/tasks/artifacts/TSK-20260520-project-review-remediation/"
];
const scannedExtensions = new Set([".cjs", ".css", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx", ".yml", ".yaml"]);

const markerRules = [
  { label: "TODO", pattern: /\bTODO\b/i },
  { label: "FIXME", pattern: /\bFIXME\b/i },
  { label: "stub", pattern: /\bstubs?\b/i },
  { label: "not implemented", pattern: /\bnot implemented\b/i },
  { label: "mock", pattern: /\bmocks?\b(?!up)/i },
  { label: "заглушка", pattern: /заглушк/i },
  { label: "временно", pattern: /временно(?!й)|временные\s+(решения|ограничения)|временная\s+заглуш/iu }
];

function fail(message) {
  console.error(`validate-legacy: ${message}`);
  process.exit(1);
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`missing required file: ${relative(filePath)}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }
  }

  if (inQuotes) {
    fail("docs/legacy/debt-log.csv has an unterminated quoted field");
  }

  return rows;
}

function readDebtRows() {
  const rawRows = parseCsv(readText(debtLogPath));
  if (rawRows.length < 2) {
    fail("docs/legacy/debt-log.csv is empty or has no data rows");
  }

  const header = rawRows[0].map((value) => value.trim());
  for (const column of requiredDebtColumns) {
    if (!header.includes(column)) {
      fail(`docs/legacy/debt-log.csv misses required column '${column}'`);
    }
  }

  return rawRows.slice(1).map((values, rowIndex) => {
    if (values.length !== header.length) {
      fail(`docs/legacy/debt-log.csv row ${rowIndex + 2} has ${values.length} fields, expected ${header.length}`);
    }
    const row = {};
    header.forEach((column, index) => {
      row[column] = values[index].trim();
    });
    return row;
  });
}

function parseStubRegister() {
  const lines = readText(stubsRegisterPath).split(/\r?\n/);
  const entries = [];
  let section = null;

  for (const line of lines) {
    if (/^##\s+Текущие заглушки/.test(line)) {
      section = "current";
      continue;
    }
    if (/^##\s+Архив заглушек/.test(line)) {
      section = "archive";
      continue;
    }
    if (!section || !/^\|\s*LEGACY-\d+\s*\|/.test(line)) {
      continue;
    }

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    entries.push({ id: cells[0], status: cells[6], section, line });
  }

  if (entries.length === 0) {
    fail("docs/legacy/stubs-register.md has no LEGACY-* rows");
  }

  return entries;
}

function loadAllowlist() {
  const parsed = JSON.parse(readText(markerAllowlistPath));
  if (!Array.isArray(parsed.entries)) {
    fail("docs/legacy/stub-marker-allowlist.json must contain an entries array");
  }

  return parsed.entries.map((entry, index) => {
    for (const key of ["path", "markers", "owner", "reason", "expires_at"]) {
      if (!entry[key] || (Array.isArray(entry[key]) && entry[key].length === 0)) {
        fail(`allowlist entry ${index + 1} misses '${key}'`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires_at)) {
      fail(`allowlist entry ${index + 1} has invalid expires_at '${entry.expires_at}'`);
    }
    return entry;
  });
}

function globToRegExp(glob) {
  const escaped = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${escaped}$`);
}

function pathExistsFromReference(reference) {
  return fs.existsSync(path.join(repoRoot, reference.replace(/\\/g, "/").replace(/\/$/, "")));
}

function pathIsCoveredByReference(filePath, reference) {
  const cleanReference = reference.replace(/\\/g, "/").replace(/\/$/, "");
  if (!cleanReference || cleanReference.includes(" ")) {
    return false;
  }
  const absoluteReference = path.join(repoRoot, cleanReference);
  if (!fs.existsSync(absoluteReference)) {
    return false;
  }

  const stats = fs.statSync(absoluteReference);
  const relativePath = filePath.replace(/\\/g, "/");
  return stats.isDirectory()
    ? relativePath === cleanReference || relativePath.startsWith(`${cleanReference}/`)
    : relativePath === cleanReference;
}

function walkFiles(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }

  const files = [];
  const stack = [rootDirectory];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = relative(absolutePath);
      if (excludedPathParts.has(entry.name) || excludedPrefixes.some((prefix) => relativePath.startsWith(prefix))) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.name === ".desc.json" || scannedExtensions.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }
  return files;
}

function isMarkerAllowed(filePath, marker, allowlist) {
  return allowlist.some((entry) => {
    const pathMatches = globToRegExp(entry.path).test(filePath);
    const markerMatches = entry.markers.some((allowedMarker) => allowedMarker.toLowerCase() === marker.toLowerCase());
    return pathMatches && markerMatches;
  });
}

function validateDescJson() {
  for (const descPath of walkFiles(repoRoot).filter((filePath) => path.basename(filePath) === ".desc.json")) {
    try {
      JSON.parse(fs.readFileSync(descPath, "utf8"));
    } catch (error) {
      fail(`invalid JSON in ${relative(descPath)}: ${error.message}`);
    }
  }
}

/** Return the canonical status field from either current or legacy TSK headers. */
function readTaskStatus(text) {
  const section = text.match(/^## Status\s*\n+([^\n]+)/m) || text.match(/^## Статус\s*\n+([^\n]+)/m);
  const legacy = text.match(/^- \*\*(?:Статус|Состояние)\*\*:\s*(.+)$/mi);
  return (section?.[1] || legacy?.[1] || "").trim();
}

/** Return task files directly inside a lifecycle directory in a stable order. */
function listTaskFiles(directory) {
  return fs.readdirSync(directory).filter((entry) => /^TSK-.*\.md$/.test(entry)).sort();
}

/**
 * Collect task governance errors without terminating the process.
 *
 * Keeping this validator pure lets the same rules run against small virtual
 * repositories below. Those negative checks prove that CI actually rejects
 * every drift condition rather than merely succeeding on today's repository.
 */
function collectTaskGovernanceFailures({ activeTasks, archiveTasks, activeDesc, archiveDesc, board, pathExists }) {
  const failures = [];
  const activeNames = Object.keys(activeTasks).sort();
  const activeNameSet = new Set(activeNames);
  const archiveNames = [...archiveTasks].sort();
  const archiveNameSet = new Set(archiveNames);

  for (const name of activeNames) {
    const status = activeTasks[name];
    if (!activeTaskStatuses.has(status)) {
      failures.push(`docs/tasks/active/${name} has non-canonical active status '${status || "<missing>"}'`);
    }
  }

  const descSources = [
    { lifecycle: "active", names: activeNames, nameSet: activeNameSet, entries: activeDesc },
    { lifecycle: "archive", names: archiveNames, nameSet: archiveNameSet, entries: archiveDesc }
  ];
  for (const { lifecycle, names, nameSet, entries } of descSources) {
    const descPath = `docs/tasks/${lifecycle}/.desc.json`;
    const isObject = entries !== null && typeof entries === "object" && !Array.isArray(entries);
    if (!isObject) {
      failures.push(`${descPath} must contain a JSON object`);
      continue;
    }

    for (const name of names) {
      if (typeof entries[name] !== "string" || entries[name].trim() === "") {
        failures.push(`${descPath} misses a non-empty description for '${name}'`);
      }
    }
    for (const key of Object.keys(entries).filter((entry) => /^TSK-.*\.md$/.test(entry)).sort()) {
      if (!nameSet.has(key)) {
        failures.push(`${descPath} contains stale task key '${key}'`);
      }
    }
  }

  // All task links on the board must resolve, including references outside the
  // three execution queues (for example, links in the general near-term plan).
  const allTaskLinks = /\((docs\/tasks\/(?:active|archive)\/TSK-[^)]+\.md)\)/g;
  for (const match of board.matchAll(allTaskLinks)) {
    if (!pathExists(match[1])) {
      failures.push(`NEXT_STEPS.md references missing task '${match[1]}'`);
    }
  }

  const queueCounts = new Map(activeNames.map((name) => [name, 0]));
  const observedSections = new Set();
  let currentSection = null;

  for (const line of board.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentSection = heading[1];
      if (taskQueueSections.has(currentSection)) {
        observedSections.add(currentSection);
      }
      continue;
    }
    if (!taskQueueSections.has(currentSection)) {
      continue;
    }

    const queueLink = /\[([^\]]+)\]\((docs\/tasks\/(active|archive)\/(TSK-[^)\/]+\.md))\)/g;
    for (const match of line.matchAll(queueLink)) {
      const [fullLink, label, reference, lifecycle, name] = match;
      const expectedLabel = name.replace(/\.md$/, "");
      if (label !== expectedLabel) {
        failures.push(`NEXT_STEPS.md link label '${label}' does not match task '${expectedLabel}' in ${currentSection}`);
      }

      if (lifecycle === "archive") {
        failures.push(`NEXT_STEPS.md queue ${currentSection} contains archive task '${name}'`);
        continue;
      }

      if (!activeNameSet.has(name)) {
        failures.push(`NEXT_STEPS.md queue ${currentSection} references non-active task '${reference}'`);
        continue;
      }

      queueCounts.set(name, queueCounts.get(name) + 1);
      const suffix = line.slice(match.index + fullLink.length);
      const statusAnnotation = suffix.match(/^\s*—\s*`([^`]+)`/);
      if (!statusAnnotation) {
        failures.push(`NEXT_STEPS.md task '${name}' in ${currentSection} misses the \`status\` annotation`);
      } else if (statusAnnotation[1] !== activeTasks[name]) {
        failures.push(
          `NEXT_STEPS.md task '${name}' declares status '${statusAnnotation[1]}', ` +
          `but its task file declares '${activeTasks[name] || "<missing>"}'`
        );
      }

      const expectedSection = taskStatusSections.get(activeTasks[name]);
      if (expectedSection && currentSection !== expectedSection) {
        failures.push(
          `NEXT_STEPS.md task '${name}' with status '${activeTasks[name]}' must be in ${expectedSection}, not ${currentSection}`
        );
      }
    }
  }

  for (const section of [...taskQueueSections].sort()) {
    if (!observedSections.has(section)) {
      failures.push(`NEXT_STEPS.md misses required queue section '${section}'`);
    }
  }
  for (const [name, count] of queueCounts) {
    if (count !== 1) {
      failures.push(`active task '${name}' must appear exactly once in Now/Next/Blocked; found ${count}`);
    }
  }

  return failures;
}

/** Build the smallest valid virtual task repository used by governance self-tests. */
function createTaskGovernanceFixture() {
  const runningLine =
    "- [TSK-RUNNING](docs/tasks/active/TSK-RUNNING.md) — `in_progress`: running task.";
  const plannedLine =
    "- [TSK-PLANNED](docs/tasks/active/TSK-PLANNED.md) — `planned`: planned task.";
  const blockedLine =
    "- [TSK-BLOCKED](docs/tasks/active/TSK-BLOCKED.md) — `blocked`: blocked task.";
  const existingPaths = new Set([
    "docs/tasks/active/TSK-RUNNING.md",
    "docs/tasks/active/TSK-PLANNED.md",
    "docs/tasks/active/TSK-BLOCKED.md",
    "docs/tasks/archive/TSK-ARCHIVED.md"
  ]);

  return {
    activeTasks: {
      "TSK-RUNNING.md": "in_progress",
      "TSK-PLANNED.md": "planned",
      "TSK-BLOCKED.md": "blocked"
    },
    archiveTasks: ["TSK-ARCHIVED.md"],
    activeDesc: {
      "TSK-RUNNING.md": "Running task.",
      "TSK-PLANNED.md": "Planned task.",
      "TSK-BLOCKED.md": "Blocked task."
    },
    archiveDesc: { "TSK-ARCHIVED.md": "Archived task." },
    board: `# Next Steps\n\n## Now\n\n${runningLine}\n\n## Next\n\n${plannedLine}\n\n## Blocked\n\n${blockedLine}\n`,
    pathExists: (reference) => existingPaths.has(reference),
    lines: { runningLine, plannedLine, blockedLine }
  };
}

/** Prove with deterministic negative fixtures that every governance rule rejects drift. */
function runTaskGovernanceSelfTests() {
  const validFixture = createTaskGovernanceFixture();
  const baselineFailures = collectTaskGovernanceFailures(validFixture);
  if (baselineFailures.length > 0) {
    fail(`task governance self-test baseline is invalid:\n- ${baselineFailures.join("\n- ")}`);
  }

  const negativeCases = [
    {
      name: "non-canonical active status",
      expected: "non-canonical active status",
      mutate: (fixture) => { fixture.activeTasks["TSK-PLANNED.md"] = "done"; }
    },
    {
      name: "missing active description",
      expected: "misses a non-empty description for 'TSK-PLANNED.md'",
      mutate: (fixture) => { delete fixture.activeDesc["TSK-PLANNED.md"]; }
    },
    {
      name: "stale active description",
      expected: "contains stale task key 'TSK-STALE.md'",
      mutate: (fixture) => { fixture.activeDesc["TSK-STALE.md"] = "Stale."; }
    },
    {
      name: "missing archive description",
      expected: "misses a non-empty description for 'TSK-ARCHIVED.md'",
      mutate: (fixture) => { delete fixture.archiveDesc["TSK-ARCHIVED.md"]; }
    },
    {
      name: "stale archive description",
      expected: "contains stale task key 'TSK-STALE.md'",
      mutate: (fixture) => { fixture.archiveDesc["TSK-STALE.md"] = "Stale."; }
    },
    {
      name: "missing queue entry",
      expected: "must appear exactly once in Now/Next/Blocked; found 0",
      mutate: (fixture) => { fixture.board = fixture.board.replace(`${fixture.lines.plannedLine}\n`, ""); }
    },
    {
      name: "duplicate queue entry",
      expected: "must appear exactly once in Now/Next/Blocked; found 2",
      mutate: (fixture) => {
        fixture.board = fixture.board.replace(fixture.lines.plannedLine, `${fixture.lines.plannedLine}\n${fixture.lines.plannedLine}`);
      }
    },
    {
      name: "archive entry in execution queue",
      expected: "contains archive task 'TSK-ARCHIVED.md'",
      mutate: (fixture) => {
        const archiveLine =
          "- [TSK-ARCHIVED](docs/tasks/archive/TSK-ARCHIVED.md) — `done`: archived task.";
        fixture.board = fixture.board.replace("## Blocked\n", `## Blocked\n\n${archiveLine}\n`);
      }
    },
    {
      name: "task label mismatch",
      expected: "link label 'WRONG-LABEL' does not match task 'TSK-PLANNED'",
      mutate: (fixture) => { fixture.board = fixture.board.replace("[TSK-PLANNED]", "[WRONG-LABEL]"); }
    },
    {
      name: "task status mismatch",
      expected: "declares status 'review'",
      mutate: (fixture) => { fixture.board = fixture.board.replace("— `planned`: planned task.", "— `review`: planned task."); }
    },
    {
      name: "task in wrong queue",
      expected: "must be in Next, not Now",
      mutate: (fixture) => {
        fixture.board = fixture.board
          .replace(`## Now\n\n${fixture.lines.runningLine}`, `## Now\n\n${fixture.lines.runningLine}\n${fixture.lines.plannedLine}`)
          .replace(`## Next\n\n${fixture.lines.plannedLine}\n`, "## Next\n\n");
      }
    },
    {
      name: "missing task link target",
      expected: "references missing task 'docs/tasks/active/TSK-MISSING.md'",
      mutate: (fixture) => {
        const missingLine =
          "- [TSK-MISSING](docs/tasks/active/TSK-MISSING.md) — `planned`: missing task.";
        fixture.board = fixture.board.replace("## Next\n", `## Next\n\n${missingLine}\n`);
      }
    }
  ];

  for (const testCase of negativeCases) {
    const fixture = createTaskGovernanceFixture();
    testCase.mutate(fixture);
    const failures = collectTaskGovernanceFailures(fixture);
    if (!failures.some((message) => message.includes(testCase.expected))) {
      fail(
        `task governance self-test '${testCase.name}' did not produce '${testCase.expected}'; ` +
        `received: ${failures.join(" | ") || "<no failures>"}`
      );
    }
  }
}

/** Keep task files, descriptions, the execution board and structure snapshot aligned. */
function validateTaskGovernance() {
  const activeDirectory = path.join(repoRoot, "docs", "tasks", "active");
  const archiveDirectory = path.join(repoRoot, "docs", "tasks", "archive");
  const activeNames = listTaskFiles(activeDirectory);
  const archiveNames = listTaskFiles(archiveDirectory);
  const activeTasks = Object.fromEntries(
    activeNames.map((name) => [name, readTaskStatus(readText(path.join(activeDirectory, name)))])
  );
  const failures = collectTaskGovernanceFailures({
    activeTasks,
    archiveTasks: archiveNames,
    activeDesc: JSON.parse(readText(path.join(activeDirectory, ".desc.json"))),
    archiveDesc: JSON.parse(readText(path.join(archiveDirectory, ".desc.json"))),
    board: readText(path.join(repoRoot, "NEXT_STEPS.md")),
    pathExists: (reference) => fs.existsSync(path.join(repoRoot, reference))
  });
  if (failures.length > 0) {
    fail(`task governance errors:\n- ${failures.join("\n- ")}`);
  }

  try {
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "dev", "generate-structure.js"), "--check"], {
      cwd: repoRoot,
      stdio: "pipe"
    });
  } catch (error) {
    fail(`PROJECT_STRUCTURE.yaml drift detected: ${String(error.stderr || error.message).trim()}`);
  }
}

function validateDebtAndRegister(debtRows, stubEntries) {
  const idCounts = new Map();
  const debtById = new Map();
  for (const row of debtRows) {
    if (!/^LEGACY-\d{4}$/.test(row.id)) {
      fail(`invalid legacy id '${row.id}' in debt-log.csv`);
    }
    if (!["active", "in-progress", "removed"].includes(row.status)) {
      fail(`invalid status '${row.status}' for ${row.id}`);
    }
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
    debtById.set(row.id, row);
  }

  const duplicateIds = [...idCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  if (duplicateIds.length > 0) {
    fail(`duplicate ids in debt-log.csv: ${duplicateIds.join(", ")}`);
  }

  const currentStubIds = new Set();
  const allStubIds = new Set();
  for (const entry of stubEntries) {
    allStubIds.add(entry.id);
    if (!debtById.has(entry.id)) {
      fail(`stubs-register.md references '${entry.id}', but debt-log.csv does not contain it`);
    }
    if (entry.section === "current") {
      currentStubIds.add(entry.id);
      if (entry.status === "removed") {
        fail(`${entry.id} is in current stubs table but has removed status`);
      }
    }
    if (entry.section === "archive" && entry.status !== "removed") {
      fail(`${entry.id} is in archive stubs table but status is '${entry.status}'`);
    }
  }

  for (const row of debtRows) {
    if (row.status === "active" && !currentStubIds.has(row.id)) {
      fail(`active debt row '${row.id}' is missing from current stubs table`);
    }
    if (row.status === "removed" && !allStubIds.has(row.id)) {
      fail(`removed debt row '${row.id}' is missing from stubs archive`);
    }
    if (row.status === "active") {
      if (!row.stub_reference) {
        fail(`${row.id} has empty stub_reference`);
      }
      if (!pathExistsFromReference(row.stub_reference)) {
        fail(`${row.id} stub_reference '${row.stub_reference}' does not exist`);
      }
    }
  }
}

function validateStubMarkers(debtRows, allowlist) {
  const activeReferences = debtRows.filter((row) => row.status === "active").map((row) => row.stub_reference);
  const failures = [];

  for (const root of scanRoots) {
    for (const absolutePath of walkFiles(path.join(repoRoot, root))) {
      const filePath = relative(absolutePath);
      const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);

      lines.forEach((line, index) => {
        if (/LEGACY-\d{4}/.test(line)) {
          return;
        }
        for (const rule of markerRules) {
          if (!rule.pattern.test(line)) {
            continue;
          }
          if (rule.label === "mock" && (filePath.includes(".test.") || /mockup/i.test(line))) {
            continue;
          }
          if (activeReferences.some((reference) => pathIsCoveredByReference(filePath, reference))) {
            continue;
          }
          if (isMarkerAllowed(filePath, rule.label, allowlist)) {
            continue;
          }
          failures.push(`${filePath}:${index + 1} contains unregistered '${rule.label}' marker`);
        }
      });
    }
  }

  if (selfTest) {
    failures.push("self-test: virtual unregistered 'stub' marker");
  }

  if (failures.length > 0) {
    fail(`unregistered stub markers found:\n- ${failures.slice(0, 50).join("\n- ")}`);
  }
}

function main() {
  runTaskGovernanceSelfTests();
  if (taskGovernanceSelfTestOnly) {
    console.log("validate-legacy: task governance self-tests OK");
    return;
  }

  const debtRows = readDebtRows();
  const stubEntries = parseStubRegister();
  const allowlist = loadAllowlist();

  validateDescJson();
  validateTaskGovernance();
  validateDebtAndRegister(debtRows, stubEntries);
  validateStubMarkers(debtRows, allowlist);

  console.log(`validate-legacy: OK (${debtRows.length} debt rows, ${stubEntries.length} stub register rows)`);
}

main();
