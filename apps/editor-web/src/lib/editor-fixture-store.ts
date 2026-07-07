/**
 * Server-side store for PINNED state fixtures (ADR-057 §4.9, §9.3; design-spec
 * §2.5, §3.3, §4).
 *
 * A "state fixture" (фикстура состояния) is a named snapshot of runtime game
 * state that becomes a REVIEWABLE authoring artifact at
 * `games/<gameId>/authoring/fixtures/<fixtureId>.json`. It gives the editor
 * Design mode a reproducible state context and a playthrough starting point.
 *
 * Invariants this module upholds (ADR-057 §5):
 *   - fixtures are written ONLY into the session worktree authoring tree, so
 *     they commit together with the rest of the author's edits on Save (the
 *     Save commit already stages `games/<id>/authoring`);
 *   - runtime-api / player-web / compiler NEVER read fixture files — this module
 *     is the only reader, and the captured `state` reaches runtime solely through
 *     the existing preview-only restore endpoint (handled by the client);
 *   - JSON Schema stays the single source of truth (CLAUDE.md §12): structural
 *     validation runs Ajv against `state-fixture.schema.json` through the engine
 *     schema registry, never a hand-written type guard.
 *
 * The deterministic manifest content hash is produced by the NODE-ONLY module
 * `@cubica/editor-engine/state-fixture-hash` (it needs `node:crypto`); it is
 * imported here on the server, never in a browser bundle.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  STATE_FIXTURE_SCHEMA_ID,
  buildManifestChronologyTimeline,
  collectManifestChronologyStepIds,
  collectUiScreenIds,
  createDocumentStore,
  createSchemaRegistry,
  inferEditorEntityDocumentKind,
  validateStateFixtureSemantics,
  type DocumentDiagnostic,
  type JsonValue,
  type ManifestContentFile
} from "@cubica/editor-engine";
import { computeManifestContentHash } from "@cubica/editor-engine/state-fixture-hash";

import { EditorRepositoryError, listAuthoringFiles, openAuthoringFile } from "./editor-repository";

/** A fixture as stored on disk / returned to the client (schema shape + `stale`). */
export interface StateFixtureRecord {
  readonly id: string;
  readonly _label: string;
  readonly screenRef?: string;
  readonly stepRef?: string;
  readonly state: Record<string, unknown>;
  readonly manifestHash: string;
  readonly sourceTraceRef?: string;
  readonly note?: string;
}

/** A listed fixture augmented with the derived `fixture-stale` verdict. */
export interface ListedStateFixture extends StateFixtureRecord {
  /** True when the fixture `manifestHash` no longer matches the current manifests. */
  readonly stale: boolean;
  /** Semantic diagnostics (`fixture-stale` / `fixture-unknown-ref`) for the badge/tooltip. */
  readonly diagnostics: readonly DocumentDiagnostic[];
}

/** The manifest facts a fixture is validated against (hash + known id sets). */
interface FixtureManifestContext {
  readonly manifestHash: string;
  readonly stepIds: readonly string[];
  readonly screenIds: readonly string[];
}

/** Fixture ids double as file names, so they are restricted to a safe segment. */
const safeFixtureIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,120}$/u;
const gameIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;

/** Absolute path of a game's pinned-fixtures directory inside a repo/worktree. */
function fixturesDirectory(repoRoot: string, gameId: string): string {
  if (!gameIdPattern.test(gameId) || gameId.includes("..")) {
    throw new EditorRepositoryError("Fixture requests require a safe gameId.", 400);
  }
  return path.join(repoRoot, "games", gameId, "authoring", "fixtures");
}

/**
 * Loads the `state-fixture.schema.json` and registers it in a fresh engine
 * schema registry. The schema is a repository document, present in every editor
 * worktree and in the configured project root; we resolve it from `repoRoot`
 * first and fall back to the running process root so a session worktree, the
 * e2e project, and the main repo all work.
 */
async function loadFixtureSchemaRegistry(repoRoot: string) {
  const relative = path.join("docs", "architecture", "schemas", "state-fixture.schema.json");
  const candidates = [path.join(repoRoot, relative), path.join(process.cwd(), relative)];
  let schemaText: string | undefined;
  for (const candidate of candidates) {
    schemaText = await readFile(candidate, "utf8").catch(() => undefined);
    if (schemaText !== undefined) {
      break;
    }
  }
  if (schemaText === undefined) {
    throw new EditorRepositoryError("state-fixture.schema.json could not be located.", 500);
  }

  const registry = createSchemaRegistry();
  registry.registerSchema(STATE_FIXTURE_SCHEMA_ID, JSON.parse(schemaText) as JsonValue as never);
  return registry;
}

function safeParseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Derives the current manifest content hash plus the known chronology-step and
 * UI-screen id sets from a game's authoring manifests. Fixture files are NOT
 * `*.authoring.json`, so `listAuthoringFiles` never folds a fixture into the
 * hash — that would make every fixture make the next one stale.
 */
async function buildFixtureManifestContext(gameId: string, repoRoot: string): Promise<FixtureManifestContext> {
  const list = await listAuthoringFiles({ gameId, repoRoot });
  const manifestFiles: ManifestContentFile[] = [];
  const stepIds = new Set<string>();
  const screenIds = new Set<string>();

  for (const file of list.files) {
    const { text } = await openAuthoringFile({ gameId, filePath: file.filePath, repoRoot });
    manifestFiles.push({ path: `games/${gameId}/authoring/${file.filePath}`, content: text });

    const json = safeParseJson(text);
    if (json === undefined) {
      continue;
    }
    const kind = inferEditorEntityDocumentKind(json);
    if (kind === "game") {
      const snapshot = createDocumentStore({ filePath: file.filePath, text }).snapshot();
      for (const stepId of collectManifestChronologyStepIds(buildManifestChronologyTimeline({ snapshot }))) {
        stepIds.add(stepId);
      }
    } else if (kind === "ui") {
      for (const screenId of collectUiScreenIds(json)) {
        screenIds.add(screenId);
      }
    }
  }

  return {
    manifestHash: computeManifestContentHash(manifestFiles),
    stepIds: [...stepIds],
    screenIds: [...screenIds]
  };
}

/** Input to {@link writeStateFixture}: the client supplies everything but the hash. */
export interface WriteStateFixtureInput {
  readonly gameId: string;
  readonly repoRoot: string;
  readonly id: string;
  readonly label: string;
  readonly state: Record<string, unknown>;
  readonly screenRef?: string;
  readonly stepRef?: string;
  readonly sourceTraceRef?: string;
  readonly note?: string;
}

/**
 * Builds a schema-valid fixture object (server stamps the fresh `manifestHash`),
 * validates it with Ajv + the semantic checks, and — only if there is no
 * blocking error — writes it into the worktree authoring tree. The write is not
 * committed here: it lands in the worktree and commits on the next Save, exactly
 * like any other authoring edit.
 */
export async function writeStateFixture(input: WriteStateFixtureInput): Promise<StateFixtureRecord> {
  if (!safeFixtureIdPattern.test(input.id) || input.id.includes("..")) {
    throw new EditorRepositoryError("Fixture id must be a safe file segment.", 400);
  }
  if (typeof input.label !== "string" || input.label.trim() === "") {
    throw new EditorRepositoryError("Fixture requires a non-empty _label.", 400);
  }
  if (typeof input.state !== "object" || input.state === null || Array.isArray(input.state)) {
    throw new EditorRepositoryError("Fixture requires a state object snapshot.", 400);
  }

  const context = await buildFixtureManifestContext(input.gameId, input.repoRoot);
  // Assemble ONLY the allowed fields (schema is additionalProperties:false), so a
  // client cannot smuggle extra keys past validation into the stored artifact.
  const fixture: StateFixtureRecord = {
    id: input.id,
    _label: input.label,
    ...(input.screenRef !== undefined ? { screenRef: input.screenRef } : {}),
    ...(input.stepRef !== undefined ? { stepRef: input.stepRef } : {}),
    state: input.state,
    manifestHash: context.manifestHash,
    ...(input.sourceTraceRef !== undefined ? { sourceTraceRef: input.sourceTraceRef } : {}),
    ...(input.note !== undefined && input.note !== "" ? { note: input.note } : {})
  };

  const registry = await loadFixtureSchemaRegistry(input.repoRoot);
  const schemaDiagnostics = registry.validateValue({ schemaId: STATE_FIXTURE_SCHEMA_ID, value: fixture as unknown as JsonValue });
  if (schemaDiagnostics.length > 0) {
    throw new EditorRepositoryError(`Fixture failed schema validation: ${schemaDiagnostics[0]?.message}`, 400);
  }

  const semantic = validateStateFixtureSemantics({
    fixture: fixture as unknown as JsonValue,
    knownScreenIds: context.screenIds,
    knownStepIds: context.stepIds,
    currentManifestHash: context.manifestHash
  });
  const blocking = semantic.find((diagnostic) => diagnostic.severity === "error");
  if (blocking !== undefined) {
    throw new EditorRepositoryError(`Fixture failed semantic validation: ${blocking.message}`, 400);
  }

  const directory = fixturesDirectory(input.repoRoot, input.gameId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${input.id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return fixture;
}

/**
 * Lists the pinned fixtures of a game and marks each stale when its
 * `manifestHash` no longer matches the current manifests (the `fixture-stale`
 * diagnostic drives the selector badge). Malformed / non-object files are
 * skipped rather than throwing, so one bad file cannot break the selector.
 */
export async function listStateFixtures(input: {
  readonly gameId: string;
  readonly repoRoot: string;
}): Promise<{ readonly fixtures: readonly ListedStateFixture[]; readonly manifestHash: string }> {
  const context = await buildFixtureManifestContext(input.gameId, input.repoRoot);
  const directory = fixturesDirectory(input.repoRoot, input.gameId);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });

  const fixtures: ListedStateFixture[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const text = await readFile(path.join(directory, entry.name), "utf8").catch(() => undefined);
    const parsed = text === undefined ? undefined : safeParseJson(text);
    if (parsed === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      continue;
    }
    const record = parsed as unknown as StateFixtureRecord;
    if (typeof record.id !== "string" || typeof record._label !== "string" || typeof record.manifestHash !== "string") {
      continue;
    }

    const diagnostics = validateStateFixtureSemantics({
      fixture: parsed as JsonValue,
      knownScreenIds: context.screenIds,
      knownStepIds: context.stepIds,
      currentManifestHash: context.manifestHash
    });
    fixtures.push({
      ...record,
      stale: diagnostics.some((diagnostic) => diagnostic.code === "fixture-stale"),
      diagnostics
    });
  }

  fixtures.sort((left, right) => left._label.localeCompare(right._label));
  return { fixtures, manifestHash: context.manifestHash };
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}
