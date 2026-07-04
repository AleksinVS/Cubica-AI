/**
 * Contract tests for @cubica/contracts-manifest.
 *
 * These tests enforce ADR-056 parity from the data side: every shipped game and
 * UI manifest must validate against the canonical JSON Schemas that the TypeScript
 * contracts are derived from. Validation is performed by executing the schema with
 * AJV (a standard JSON Schema validator) — never by hand-written `if (typeof x...)`
 * guards, which ADR-025 forbids.
 *
 * Manifests are discovered from the `games/` tree at runtime, so adding a new game
 * is covered automatically with no hardcoded game id.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import AjvLib, { type ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";

// ajv ships a dual CommonJS/ESM default export; under NodeNext resolution the
// constructor lives on `.default` at runtime. Unwrap it the same way the rest of
// the codebase does (see services/runtime-api/.../contentService.ts) instead of
// relying on esModuleInterop, so this package stays consistent with repo tsconfig
// conventions. Typed as a minimal constructor to avoid `any`.
type AjvConstructor = new (options?: Record<string, unknown>) => {
  compile: (schema: unknown) => ValidateFunction;
};
const Ajv =
  (AjvLib as unknown as { default?: AjvConstructor }).default ?? (AjvLib as unknown as AjvConstructor);

// Repo root is four levels up from this file:
// tests -> manifest -> contracts -> packages -> <repo root>
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const schemasRoot = join(repoRoot, "docs", "architecture", "schemas");
const gamesRoot = join(repoRoot, "games");

/** Read and parse a JSON file relative to the repo root. */
function readJson(absolutePath: string): unknown {
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}

/** Recursively collect files under `root` whose absolute path matches `predicate`. */
function collectFiles(root: string, predicate: (filePath: string) => boolean): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (predicate(fullPath)) {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

/**
 * Build a validator for one schema file. game-manifest.schema.json has no `$id`,
 * so we register it under a stable id (matching the id used by the authoring CI
 * validator) and compile its root; ui-manifest carries its own `$id`.
 */
function buildValidator(schemaFile: string): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = readJson(join(schemasRoot, schemaFile)) as Record<string, unknown>;
  return ajv.compile(schema);
}

function formatErrors(validate: ValidateFunction): string {
  return (validate.errors || [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

const gameManifestFiles = collectFiles(gamesRoot, (filePath) => filePath.endsWith("/game.manifest.json"));
const uiManifestFiles = collectFiles(gamesRoot, (filePath) => filePath.endsWith("/ui.manifest.json"));

describe("shipped game manifests validate against game-manifest.schema.json", () => {
  const validateGameManifest = buildValidator("game-manifest.schema.json");

  it("discovers at least one shipped game manifest", () => {
    expect(gameManifestFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of gameManifestFiles) {
    it(`validates ${relative(repoRoot, filePath)}`, () => {
      const data = readJson(filePath);
      const valid = validateGameManifest(data);
      if (!valid) {
        throw new Error(`${relative(repoRoot, filePath)} failed schema validation: ${formatErrors(validateGameManifest)}`);
      }
      expect(valid).toBe(true);
    });
  }
});

describe("shipped UI manifests validate against ui-manifest.schema.json", () => {
  const validateUiManifest = buildValidator("ui-manifest.schema.json");

  it("discovers at least one shipped UI manifest", () => {
    expect(uiManifestFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of uiManifestFiles) {
    it(`validates ${relative(repoRoot, filePath)}`, () => {
      const data = readJson(filePath);
      const valid = validateUiManifest(data);
      if (!valid) {
        throw new Error(`${relative(repoRoot, filePath)} failed schema validation: ${formatErrors(validateUiManifest)}`);
      }
      expect(valid).toBe(true);
    });
  }
});
