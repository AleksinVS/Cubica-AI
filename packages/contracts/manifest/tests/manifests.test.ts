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
import addFormatsLib from "ajv-formats";
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
// ajv-formats is a dual CJS/ESM module; unwrap `.default` the same way as Ajv so
// standard formats (uri, date-time, ...) are registered under strict mode.
const addFormats =
  (addFormatsLib as unknown as { default?: (ajv: unknown) => void }).default ??
  (addFormatsLib as unknown as (ajv: unknown) => void);

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
  // Strict Ajv mode enforces ADR-025: unknown keywords/formats and malformed
  // schemas fail the contract test instead of being silently ignored. The two
  // relaxations are principled, not defect-hiding: allowUnionTypes accepts valid
  // `type: [...]` unions (e.g. ui-manifest uiStyle.width), and ajv-formats
  // registers standard formats (uri, date-time, ...) so `format` is recognised.
  // strictRequired is disabled because game-manifest.schema.json uses standard
  // declarative idioms — "at least one of" (`anyOf` of `{required:[x]}`) and
  // "must be absent" (`not: {required:[x]}`) — where the property lives at the
  // parent level or is intentionally forbidden and cannot be re-listed locally.
  // `required` is still fully enforced; only the authoring lint is relaxed.
  // Documented bounded exception in LEGACY-0016.
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
  addFormats(ajv);
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
const gameAssetRegistryFiles = collectFiles(gamesRoot, (filePath) => filePath.endsWith("/assets/assets.json"));

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

describe("interactive board surface UI contract", () => {
  const validateUiManifest = buildValidator("ui-manifest.schema.json");
  const fixture = {
    meta: { id: "neutral.board.web", version: "1.0.0", game_id: "neutral-board" },
    entry_point: "board",
    screens: {
      board: {
        type: "screen",
        root: {
          type: "interactiveBoardSurface",
          props: { sceneId: "main", designWidth: 1400, designHeight: 1000, accessibleLabel: "Board" }
        }
      }
    }
  };

  it("accepts bounded board dimensions and required scene id", () => {
    expect(validateUiManifest(fixture)).toBe(true);
  });

  it("accepts a high-detail logical map plane larger than the browser viewport", () => {
    const highDetailMap = structuredClone(fixture) as any;
    highDetailMap.screens.board.root.props.designWidth = 5079;
    highDetailMap.screens.board.root.props.designHeight = 3627;
    expect(validateUiManifest(highDetailMap)).toBe(true);
  });

  it("rejects an unbounded logical map plane", () => {
    const invalid = structuredClone(fixture) as any;
    invalid.screens.board.root.props.designWidth = 100001;
    expect(validateUiManifest(invalid)).toBe(false);
  });

  it("rejects a board surface without scene id", () => {
    const invalid = structuredClone(fixture) as any;
    delete invalid.screens.board.root.props.sceneId;
    expect(validateUiManifest(invalid)).toBe(false);
  });
});

describe("map-first workspace UI contract", () => {
  const validateUiManifest = buildValidator("ui-manifest.schema.json");
  const fixture = {
    meta: { id: "neutral.workspace.web", version: "1.0.0", game_id: "neutral-workspace" },
    entry_point: "workspace",
    screens: {
      workspace: {
        type: "screen",
        layout_mode: "map-first",
        root: {
          type: "screenComponent",
          children: [
            {
              type: "areaComponent",
              props: { workspaceSlot: "board" },
              children: [
                {
                  type: "interactiveBoardSurface",
                  props: { sceneId: "neutral-scene", accessibleLabel: "Spatial workspace" }
                }
              ]
            },
            {
              type: "areaComponent",
              props: { workspaceSlot: "status" },
              children: [{ type: "richTextComponent", props: { html: "Ready" } }]
            }
          ]
        }
      }
    }
  };

  it("accepts neutral direct workspace zones with one board", () => {
    const valid = validateUiManifest(fixture);
    if (!valid) {
      throw new Error(`neutral map-first fixture failed schema validation: ${formatErrors(validateUiManifest)}`);
    }
    expect(valid).toBe(true);
  });

  it("rejects an unsupported workspace slot", () => {
    const invalid = structuredClone(fixture) as any;
    invalid.screens.workspace.root.children[1].props.workspaceSlot = "side-widget";
    expect(validateUiManifest(invalid)).toBe(false);
  });

  it("rejects a map-first screen without a direct board zone", () => {
    const invalid = structuredClone(fixture) as any;
    invalid.screens.workspace.root.children[0].props.workspaceSlot = "primary-panel";
    expect(validateUiManifest(invalid)).toBe(false);
  });

  it("rejects workspace slots nested below a direct zone", () => {
    const invalid = structuredClone(fixture) as any;
    invalid.screens.workspace.root.children[1].children[0] = {
      type: "areaComponent",
      props: { workspaceSlot: "overlay" }
    };
    expect(validateUiManifest(invalid)).toBe(false);
  });

  it("rejects workspace slots in a non-map-first screen", () => {
    const invalid = structuredClone(fixture) as any;
    invalid.screens.workspace.layout_mode = "topbar";
    expect(validateUiManifest(invalid)).toBe(false);
  });

  it("rejects direct zones that are not area components", () => {
    const invalid = structuredClone(fixture) as any;
    invalid.screens.workspace.root.children[1] = {
      type: "richTextComponent",
      props: { html: "Ready", workspaceSlot: "status" }
    };
    expect(validateUiManifest(invalid)).toBe(false);
  });
});

describe("built-in leaf component UI contract", () => {
  const validateUiManifest = buildValidator("ui-manifest.schema.json");
  const manifestWithRoot = (root: Record<string, unknown>) => ({
    meta: { id: "neutral.leaf.web", version: "1.0.0", game_id: "neutral-leaf" },
    entry_point: "main",
    screens: {
      main: {
        type: "screen",
        root
      }
    }
  });

  it.each([
    ["button caption", { type: "buttonComponent", props: {} }],
    ["rich text body", { type: "richTextComponent", props: {} }],
    ["image source", { type: "imageComponent", props: {} }],
    ["metric binding", { type: "gameVariableComponent", props: {} }],
    ["non-empty metric binding", { type: "gameVariableComponent", props: { metricId: "" } }],
    ["card content", { type: "cardComponent", props: {} }],
    ["non-empty card content", { type: "cardComponent", props: { title: "" } }],
    ["non-empty card back content", { type: "cardComponent", props: { backText: "" } }]
  ])("rejects a built-in leaf without %s", (_label, root) => {
    expect(validateUiManifest(manifestWithRoot(root))).toBe(false);
  });

  it("accepts the public two-sided card contract", () => {
    expect(validateUiManifest(manifestWithRoot({
      type: "cardComponent",
      props: {
        title: "Neutral option",
        backText: "Neutral result",
        visualState: "resolved"
      }
    }))).toBe(true);
  });

  it("keeps props optional for structural containers", () => {
    expect(validateUiManifest(manifestWithRoot({
      type: "areaComponent",
      children: [{ type: "richTextComponent", props: { html: "Ready" } }]
    }))).toBe(true);
  });
});

describe("game asset registry contract", () => {
  const validateGameAssets = buildValidator("game-assets.schema.json");
  const examplesRoot = join(schemasRoot, "examples");

  it("accepts the neutral positive example", () => {
    const valid = validateGameAssets(readJson(join(examplesRoot, "game-assets.valid.json")));
    if (!valid) {
      throw new Error(`valid asset example failed schema validation: ${formatErrors(validateGameAssets)}`);
    }
    expect(valid).toBe(true);
  });

  for (const filename of [
    "game-assets.invalid-extra-field.json",
    "game-assets.invalid-id.json",
    "game-assets.invalid-extension.json",
    "game-assets.invalid-third-party-license.json"
  ]) {
    it(`rejects ${filename}`, () => {
      expect(validateGameAssets(readJson(join(examplesRoot, filename)))).toBe(false);
    });
  }

  for (const filePath of gameAssetRegistryFiles) {
    it(`validates ${relative(repoRoot, filePath)}`, () => {
      const valid = validateGameAssets(readJson(filePath));
      if (!valid) {
        throw new Error(`${relative(repoRoot, filePath)} failed schema validation: ${formatErrors(validateGameAssets)}`);
      }
      expect(valid).toBe(true);
    });
  }
});
