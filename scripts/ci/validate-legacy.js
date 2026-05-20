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

const repoRoot = path.resolve(__dirname, "..", "..");
const debtLogPath = path.join(repoRoot, "docs", "legacy", "debt-log.csv");
const stubsRegisterPath = path.join(repoRoot, "docs", "legacy", "stubs-register.md");
const markerAllowlistPath = path.join(repoRoot, "docs", "legacy", "stub-marker-allowlist.json");
const selfTest = process.argv.includes("--self-test-unregistered-stub");

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

const scanRoots = ["apps", "services", "SDK", "packages", "docs"];
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
  const debtRows = readDebtRows();
  const stubEntries = parseStubRegister();
  const allowlist = loadAllowlist();

  validateDescJson();
  validateDebtAndRegister(debtRows, stubEntries);
  validateStubMarkers(debtRows, allowlist);

  console.log(`validate-legacy: OK (${debtRows.length} debt rows, ${stubEntries.length} stub register rows)`);
}

main();
