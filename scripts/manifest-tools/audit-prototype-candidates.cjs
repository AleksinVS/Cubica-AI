#!/usr/bin/env node
/**
 * Read-only ADR-050 prototype candidate audit.
 *
 * The script scans authoring manifests, finds repeated JSON structures that
 * may become game-level prototypes, optionally asks an external LLM runner for
 * semantic duplicates, and builds a promotion backlog for existing local
 * prototypes. It never writes authoring manifests or generated runtime files.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const { discoverJobs, relativePath } = require("./authoring-compiler.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const defaultReportDir = path.join(repoRoot, ".tmp", "prototype-audit");
const defaultVariantKeys = new Set([
  "_label",
  "_prompt",
  "_semantics",
  "actionId",
  "asset",
  "body",
  "caption",
  "description",
  "id",
  "key",
  "label",
  "left",
  "name",
  "order",
  "slug",
  "src",
  "target",
  "targetId",
  "text",
  "title",
  "top",
  "x",
  "y"
]);
const stableLiteralKeys = new Set([
  "_type",
  "channel",
  "component",
  "effect",
  "handler",
  "kind",
  "layout",
  "method",
  "mode",
  "scope",
  "type",
  "variant"
]);

function parseArgs(argv) {
  const options = {
    mode: "deterministic",
    scope: "all",
    format: "markdown",
    output: null,
    statusOutput: null,
    changedBase: null,
    file: null,
    gameId: null,
    includeLlm: false,
    allowLlmSkip: true,
    minRepeatCount: 2,
    minObjectFieldCount: 2
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      options.mode = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--scope") {
      options.scope = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--format") {
      options.format = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--output") {
      options.output = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--status-output") {
      options.statusOutput = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--changed") {
      options.changedBase = readNext(argv, index, arg);
      options.scope = "changed";
      index += 1;
    } else if (arg === "--file") {
      options.file = normalizeRepoRelative(readNext(argv, index, arg));
      options.scope = "file";
      index += 1;
    } else if (arg === "--game") {
      options.gameId = readNext(argv, index, arg);
      index += 1;
    } else if (arg === "--include-llm") {
      options.includeLlm = true;
    } else if (arg === "--require-llm") {
      options.includeLlm = true;
      options.allowLlmSkip = false;
    } else if (arg === "--min-repeat") {
      options.minRepeatCount = Number(readNext(argv, index, arg));
      index += 1;
    } else if (arg === "--min-fields") {
      options.minObjectFieldCount = Number(readNext(argv, index, arg));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["deterministic", "semantic-llm", "weekly", "promotion-backlog"].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
  }
  if (!["markdown", "json"].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }
  if (!Number.isFinite(options.minRepeatCount) || options.minRepeatCount < 2) {
    throw new Error("--min-repeat must be a number >= 2");
  }
  if (!Number.isFinite(options.minObjectFieldCount) || options.minObjectFieldCount < 1) {
    throw new Error("--min-fields must be a number >= 1");
  }

  return options;
}

function readNext(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: node scripts/manifest-tools/audit-prototype-candidates.cjs [options]

Options:
  --mode deterministic|semantic-llm|weekly|promotion-backlog
  --scope all|changed|file
  --changed <base-ref>       Scan changed authoring files against a git ref
  --file <path>              Scan one authoring file
  --game <gameId>            Limit scan to one game
  --include-llm              Run configured LLM semantic pass
  --require-llm              Fail if LLM runner is not configured or fails
  --format markdown|json
  --output <path>            Write report
  --status-output <path>     Write weekly status JSON
  --min-repeat <number>      Default: 2
  --min-fields <number>      Default: 2
`);
}

function normalizeRepoRelative(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return path.relative(repoRoot, absolute).replace(/\\/g, "/");
}

function main() {
  const options = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const jobs = selectJobs(options);
  const deterministic = runDeterministicAudit(jobs, options);
  const prototypes = collectLocalPrototypes(jobs);
  const llm = runSemanticAudit({ deterministic, prototypes, options });
  const promotionBacklog = buildPromotionBacklog({ prototypes, deterministic, semanticCandidates: llm.candidates });
  const completedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    generatedAt: completedAt,
    startedAt,
    mode: options.mode,
    scope: options.scope,
    changedBase: options.changedBase,
    gameId: options.gameId,
    files: jobs.map((job) => job.relativeSourceFile),
    summary: {
      filesScanned: jobs.length,
      deterministicCandidates: deterministic.candidates.length,
      semanticCandidates: llm.candidates.length,
      promotionCandidates: promotionBacklog.length,
      localPrototypes: prototypes.length
    },
    deterministicCandidates: deterministic.candidates,
    semanticCandidates: llm.candidates,
    promotionBacklog,
    localPrototypes: prototypes,
    diagnostics: [...deterministic.diagnostics, ...llm.diagnostics],
    llmStatus: llm.status,
    commit: readCommitMetadata(),
    outputPath: options.output ? normalizeRepoRelative(options.output) : undefined
  };

  const outputText = options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdownReport(report);
  if (options.output) {
    writeText(path.resolve(repoRoot, options.output), outputText);
  } else {
    process.stdout.write(outputText);
  }

  if (options.statusOutput) {
    writeJson(path.resolve(repoRoot, options.statusOutput), buildStatusRecord(report, completedAt));
  }
}

function selectJobs(options) {
  const allJobs = discoverJobs({ gameId: options.gameId || undefined }).map((job) => ({
    ...job,
    relativeSourceFile: relativePath(job.sourceFile)
  }));
  const byFile = new Map(allJobs.map((job) => [job.relativeSourceFile, job]));

  if (options.scope === "file") {
    const job = byFile.get(options.file);
    if (!job) {
      throw new Error(`Authoring file is not part of compiler jobs: ${options.file}`);
    }
    return [job];
  }

  if (options.scope === "changed") {
    const changed = changedAuthoringFiles(options.changedBase);
    return changed.map((filePath) => byFile.get(filePath)).filter(Boolean);
  }

  return allJobs;
}

function changedAuthoringFiles(baseRef) {
  if (!baseRef) {
    return [];
  }

  try {
    const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`, "--", "games"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".authoring.json") && line.includes("/authoring/"));
  } catch (error) {
    return [];
  }
}

function runDeterministicAudit(jobs, options) {
  const candidates = [];
  const diagnostics = [];

  for (const job of jobs) {
    let authoring;
    try {
      authoring = readJson(job.sourceFile);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        source: "deterministic",
        filePath: job.relativeSourceFile,
        message: error.message
      });
      continue;
    }

    const discovered = discoverCandidatesInDocument({
      authoring,
      job,
      minRepeatCount: options.minRepeatCount,
      minObjectFieldCount: options.minObjectFieldCount
    });
    candidates.push(...discovered);
  }

  return { candidates, diagnostics };
}

function discoverCandidatesInDocument(input) {
  const rootPointer = readPointer(input.authoring, "/root").exists ? "/root" : "";
  const root = readPointer(input.authoring, rootPointer).value;
  const groups = new Map();

  const visit = (value, pointer) => {
    if (pointer === "/_definitions" || pointer.startsWith("/_definitions/")) {
      return;
    }
    if (isPlainObject(value)) {
      const normalizedShape = normalizePrototypeShape(value);
      if (countFields(normalizedShape) >= input.minObjectFieldCount && pointer !== rootPointer) {
        const signature = stableStringify(normalizedShape);
        const group = groups.get(signature) || { normalizedShape, pointers: [], values: [] };
        group.pointers.push(pointer);
        group.values.push(value);
        groups.set(signature, group);
      }
      for (const [key, child] of Object.entries(value)) {
        visit(child, joinPointer(pointer, key));
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, joinPointer(pointer, String(index))));
    }
  };

  visit(root, rootPointer);

  return [...groups.entries()]
    .filter(([, group]) => group.pointers.length >= input.minRepeatCount)
    .map(([signature, group]) => {
      const commonBody = buildCommonBody(group.values);
      const overrideFieldCount = group.values.reduce((total, value) => total + countFields(diffOverride(value, commonBody)), 0);
      const score = buildScore({
        repetitionCount: group.pointers.length,
        commonFieldCount: countFields(commonBody),
        overrideFieldCount
      });
      return {
        id: `prototype-candidate:${hash(`${input.job.relativeSourceFile}:${signature}`)}`,
        source: "deterministic",
        classification: score.overExtractionRisk === "high" ? "local-only" : "local-prototype-candidate",
        scope: scopeForJob(input.job),
        gameId: input.job.gameId,
        channel: input.job.channel,
        filePath: input.job.relativeSourceFile,
        sourcePointers: group.pointers,
        signature: hash(signature),
        normalizedShape: group.normalizedShape,
        score,
        summary: `${group.pointers.length} repeated authoring object(s), shared ratio ${score.sharedFieldRatio}.`,
        recommendedAction: score.overExtractionRisk === "high" ? "review-copy-vs-prototype" : "review-local-prototype",
        requiredChecks: [
          "editor-change-set-dry-run",
          "compiler-dry-run",
          "canonical-runtime-diff",
          "source-map-pointer-existence"
        ]
      };
    })
    .sort(compareCandidates);
}

function compareCandidates(left, right) {
  if (right.score.repetitionCount !== left.score.repetitionCount) {
    return right.score.repetitionCount - left.score.repetitionCount;
  }
  return right.score.commonFieldCount - left.score.commonFieldCount;
}

function collectLocalPrototypes(jobs) {
  const prototypes = [];
  for (const job of jobs) {
    let authoring;
    try {
      authoring = readJson(job.sourceFile);
    } catch {
      continue;
    }
    if (!isPlainObject(authoring._definitions)) {
      continue;
    }
    for (const [name, definition] of Object.entries(authoring._definitions)) {
      if (!isPlainObject(definition)) {
        continue;
      }
      const normalizedShape = normalizePrototypeShape(definition);
      prototypes.push({
        id: `local-prototype:${hash(`${job.relativeSourceFile}:${name}`)}`,
        name,
        scope: scopeForJob(job),
        gameId: job.gameId,
        channel: job.channel,
        filePath: job.relativeSourceFile,
        pointer: joinPointer("/_definitions", name),
        hasSemantics: typeof definition._semantics === "string" && definition._semantics.trim() !== "",
        hasPromptTemplate: isPlainObject(definition._promptTemplate) || typeof definition._promptTemplate === "string",
        extends: typeof definition._extends === "string" ? definition._extends : undefined,
        normalizedSignature: hash(stableStringify(normalizedShape)),
        normalizedShape
      });
    }
  }
  return prototypes;
}

function runSemanticAudit(input) {
  if (!input.options.includeLlm && input.options.mode !== "semantic-llm" && input.options.mode !== "weekly") {
    return { status: "not-requested", candidates: [], diagnostics: [] };
  }

  const command = process.env.PROTOTYPE_AUDIT_LLM_COMMAND;
  if (!command || command.trim() === "") {
    const diagnostic = {
      severity: input.options.allowLlmSkip ? "warning" : "error",
      source: "semantic-llm",
      message: "PROTOTYPE_AUDIT_LLM_COMMAND is not configured; semantic audit was skipped."
    };
    if (!input.options.allowLlmSkip) {
      throw new Error(diagnostic.message);
    }
    return { status: "skipped", candidates: [], diagnostics: [diagnostic] };
  }

  const payload = {
    schemaVersion: 1,
    kind: "cubica.prototype.semantic-audit",
    generatedAt: new Date().toISOString(),
    deterministicCandidates: input.deterministic.candidates.map(compactCandidate),
    localPrototypes: input.prototypes.map(compactPrototype)
  };
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    input: JSON.stringify(payload, null, 2),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10
  });

  if (result.status !== 0) {
    const message = result.stderr.trim() || `LLM command exited with ${result.status}`;
    if (!input.options.allowLlmSkip) {
      throw new Error(message);
    }
    return {
      status: "failed",
      candidates: [],
      diagnostics: [{ severity: "warning", source: "semantic-llm", message }]
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates.map(normalizeSemanticCandidate).filter(Boolean) : [];
    return {
      status: "completed",
      candidates,
      diagnostics: []
    };
  } catch (error) {
    if (!input.options.allowLlmSkip) {
      throw error;
    }
    return {
      status: "failed",
      candidates: [],
      diagnostics: [{ severity: "warning", source: "semantic-llm", message: `Invalid LLM JSON output: ${error.message}` }]
    };
  }
}

function compactCandidate(candidate) {
  return {
    id: candidate.id,
    scope: candidate.scope,
    filePath: candidate.filePath,
    sourcePointers: candidate.sourcePointers,
    score: candidate.score,
    summary: candidate.summary
  };
}

function compactPrototype(prototype) {
  return {
    id: prototype.id,
    name: prototype.name,
    scope: prototype.scope,
    filePath: prototype.filePath,
    pointer: prototype.pointer,
    hasSemantics: prototype.hasSemantics,
    hasPromptTemplate: prototype.hasPromptTemplate
  };
}

function normalizeSemanticCandidate(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const sourcePointers = Array.isArray(value.sourcePointers)
    ? value.sourcePointers.filter((pointer) => typeof pointer === "string")
    : [];
  const scope = typeof value.scope === "string" ? value.scope : "unknown";
  const summary = typeof value.summary === "string" ? value.summary : "Semantic candidate from LLM audit.";
  return {
    id: typeof value.id === "string" ? value.id : `semantic-prototype-candidate:${hash(`${scope}:${summary}:${sourcePointers.join("|")}`)}`,
    source: "semantic-llm",
    classification: typeof value.classification === "string" ? value.classification : "local-prototype-candidate",
    scope,
    filePath: typeof value.filePath === "string" ? value.filePath : undefined,
    sourcePointers,
    summary,
    recommendedAction: typeof value.recommendedAction === "string" ? value.recommendedAction : "review-semantic-prototype",
    falsePositiveRisk: typeof value.falsePositiveRisk === "string" ? value.falsePositiveRisk : "medium",
    requiredChecks: Array.isArray(value.requiredChecks)
      ? value.requiredChecks.filter((item) => typeof item === "string")
      : ["compiler-dry-run", "canonical-runtime-diff", "source-map-pointer-existence"]
  };
}

function buildPromotionBacklog(input) {
  const backlog = [];
  const prototypeGroups = new Map();
  for (const prototype of input.prototypes) {
    const group = prototypeGroups.get(prototype.normalizedSignature) || [];
    group.push(prototype);
    prototypeGroups.set(prototype.normalizedSignature, group);
  }

  for (const [signature, group] of prototypeGroups.entries()) {
    const independentScopes = new Set(group.map((prototype) => prototype.scope));
    if (independentScopes.size < 2) {
      continue;
    }
    backlog.push({
      id: `promotion-candidate:${hash(`prototype:${signature}`)}`,
      source: "local-prototype-registry",
      classification: "review-platform-promotion",
      prototypeNames: [...new Set(group.map((prototype) => prototype.name))],
      evidence: group.map((prototype) => ({
        filePath: prototype.filePath,
        pointer: prototype.pointer,
        scope: prototype.scope,
        hasSemantics: prototype.hasSemantics,
        hasPromptTemplate: prototype.hasPromptTemplate
      })),
      summary: `${group.length} local prototype(s) share the same normalized shape across ${independentScopes.size} scope(s).`,
      requiredChecks: [
        "manual-general-vs-game-specific-classification",
        "schema-example",
        "compiler-validation-coverage",
        "migration-guidance",
        "versioning-policy"
      ]
    });
  }

  for (const candidate of input.semanticCandidates) {
    if (candidate.classification !== "platform-promotion-candidate") {
      continue;
    }
    backlog.push({
      id: `promotion-candidate:${hash(`semantic:${candidate.id}`)}`,
      source: "semantic-llm",
      classification: "review-platform-promotion",
      prototypeNames: [],
      evidence: [{
        filePath: candidate.filePath,
        pointers: candidate.sourcePointers,
        scope: candidate.scope
      }],
      summary: candidate.summary,
      requiredChecks: [
        "deterministic-proposal-confirmation",
        "manual-general-vs-game-specific-classification",
        "compiler-dry-run",
        "canonical-runtime-diff"
      ]
    });
  }

  return backlog;
}

function buildStatusRecord(report, completedAt) {
  const weeklyLike = report.mode === "weekly" || report.mode === "semantic-llm";
  const status = report.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "failed" : "completed";
  return {
    schemaVersion: 1,
    cadence: weeklyLike ? "weekly" : "manual",
    expectedEveryDays: 7,
    graceHours: 36,
    lastStartedAt: report.startedAt,
    lastCompletedAt: completedAt,
    status,
    llmStatus: report.llmStatus,
    branch: report.commit.branch,
    commitSha: report.commit.sha,
    reportPath: report.outputPath,
    summary: report.summary
  };
}

function renderMarkdownReport(report) {
  const lines = [
    "# Prototype Candidate Audit",
    "",
    `- Mode: ${report.mode}`,
    `- Scope: ${report.scope}`,
    `- Generated: ${report.generatedAt}`,
    `- Files scanned: ${report.summary.filesScanned}`,
    `- Deterministic candidates: ${report.summary.deterministicCandidates}`,
    `- Semantic candidates: ${report.summary.semanticCandidates}`,
    `- Promotion candidates: ${report.summary.promotionCandidates}`,
    `- LLM status: ${report.llmStatus}`,
    ""
  ];

  appendCandidateTable(lines, "Deterministic Candidates", report.deterministicCandidates);
  appendCandidateTable(lines, "Semantic Candidates", report.semanticCandidates);
  appendPromotionBacklog(lines, report.promotionBacklog);

  if (report.diagnostics.length > 0) {
    lines.push("## Diagnostics", "");
    for (const diagnostic of report.diagnostics) {
      lines.push(`- ${diagnostic.severity}: ${diagnostic.source}: ${diagnostic.message}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function appendCandidateTable(lines, title, candidates) {
  lines.push(`## ${title}`, "");
  if (candidates.length === 0) {
    lines.push("No candidates.", "");
    return;
  }
  lines.push("| ID | Scope | Sources | Score | Action |", "| --- | --- | --- | --- | --- |");
  for (const candidate of candidates.slice(0, 50)) {
    const score = candidate.score ? `${candidate.score.repetitionCount}x / ${candidate.score.sharedFieldRatio}` : candidate.falsePositiveRisk || "n/a";
    lines.push(`| ${candidate.id} | ${candidate.scope} | ${(candidate.sourcePointers || []).length} | ${score} | ${candidate.recommendedAction} |`);
  }
  if (candidates.length > 50) {
    lines.push(`| ... | ... | ... | +${candidates.length - 50} more | ... |`);
  }
  lines.push("");
}

function appendPromotionBacklog(lines, backlog) {
  lines.push("## Promotion Backlog", "");
  if (backlog.length === 0) {
    lines.push("No platform promotion candidates.", "");
    return;
  }
  lines.push("| ID | Source | Evidence | Summary |", "| --- | --- | --- | --- |");
  for (const item of backlog) {
    lines.push(`| ${item.id} | ${item.source} | ${item.evidence.length} | ${item.summary} |`);
  }
  lines.push("");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function joinPointer(parent, segment) {
  const encoded = String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
  return parent === "" ? `/${encoded}` : `${parent}/${encoded}`;
}

function readPointer(document, pointer) {
  if (pointer === "") {
    return { exists: true, value: document };
  }
  if (!pointer.startsWith("/")) {
    return { exists: false, value: undefined };
  }
  let current = document;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isPlainObject(current) && !Array.isArray(current)) {
      return { exists: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { exists: false, value: undefined };
    }
    current = current[segment];
  }
  return { exists: true, value: current };
}

function normalizePrototypeShape(value, keyHint = "") {
  if (Array.isArray(value)) {
    return value.map((item) => normalizePrototypeShape(item));
  }
  if (isPlainObject(value)) {
    const normalized = {};
    for (const [key, child] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      if (defaultVariantKeys.has(key)) {
        continue;
      }
      normalized[key] = normalizePrototypeShape(child, key);
    }
    return normalized;
  }
  if (stableLiteralKeys.has(keyHint)) {
    return value;
  }
  return { $scalar: value === null ? "null" : typeof value };
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildCommonBody(values) {
  if (values.length === 0) {
    return {};
  }
  return commonValue(values);
}

function commonValue(values) {
  if (values.every(Array.isArray)) {
    const minLength = Math.min(...values.map((value) => value.length));
    const common = [];
    for (let index = 0; index < minLength; index += 1) {
      const child = commonValue(values.map((value) => value[index]));
      if (child !== undefined) {
        common.push(child);
      }
    }
    return common.length > 0 ? common : undefined;
  }
  if (values.every(isPlainObject)) {
    const common = {};
    const keys = Object.keys(values[0]).filter((key) => !defaultVariantKeys.has(key));
    for (const key of keys) {
      if (!values.every((value) => Object.prototype.hasOwnProperty.call(value, key))) {
        continue;
      }
      const child = commonValue(values.map((value) => value[key]));
      if (child !== undefined) {
        common[key] = child;
      }
    }
    return Object.keys(common).length > 0 ? common : undefined;
  }
  const first = stableStringify(normalizePrototypeShape(values[0]));
  return values.every((value) => stableStringify(normalizePrototypeShape(value)) === first) ? values[0] : undefined;
}

function diffOverride(value, common) {
  if (common === undefined) {
    return value;
  }
  if (Array.isArray(value) && Array.isArray(common)) {
    return value.map((child, index) => diffOverride(child, common[index])).filter((child) => child !== undefined);
  }
  if (isPlainObject(value) && isPlainObject(common)) {
    const diff = {};
    for (const [key, child] of Object.entries(value)) {
      if (defaultVariantKeys.has(key)) {
        diff[key] = child;
        continue;
      }
      const childDiff = diffOverride(child, common[key]);
      if (childDiff !== undefined) {
        diff[key] = childDiff;
      }
    }
    return Object.keys(diff).length > 0 ? diff : undefined;
  }
  return stableStringify(normalizePrototypeShape(value)) === stableStringify(normalizePrototypeShape(common)) ? undefined : value;
}

function countFields(value) {
  if (value === undefined) {
    return 0;
  }
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + countFields(child), 0);
  }
  if (isPlainObject(value)) {
    return Object.values(value).reduce((total, child) => total + 1 + countFields(child), 0);
  }
  return 1;
}

function buildScore(input) {
  const totalFields = input.commonFieldCount + input.overrideFieldCount;
  const sharedFieldRatio = totalFields === 0 ? 0 : Number((input.commonFieldCount / totalFields).toFixed(3));
  const readabilityRisk =
    sharedFieldRatio < 0.35 || input.overrideFieldCount > input.commonFieldCount * 2 ? "high" : sharedFieldRatio < 0.55 ? "medium" : "low";
  const overExtractionRisk = input.repetitionCount < 3 && sharedFieldRatio < 0.65 ? "high" : input.repetitionCount < 3 ? "medium" : "low";
  return {
    repetitionCount: input.repetitionCount,
    commonFieldCount: input.commonFieldCount,
    overrideFieldCount: input.overrideFieldCount,
    sharedFieldRatio,
    readabilityRisk,
    overExtractionRisk
  };
}

function scopeForJob(job) {
  return job.kind === "game" ? `game:${job.gameId}` : `game:${job.gameId}/ui:${job.channel}`;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function readCommitMetadata() {
  const readGit = (args, fallback) => {
    try {
      return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return fallback;
    }
  };
  return {
    branch: readGit(["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
    sha: readGit(["rev-parse", "HEAD"], "unknown")
  };
}

try {
  main();
} catch (error) {
  console.error(`audit-prototype-candidates: ${error.message}`);
  process.exit(1);
}
