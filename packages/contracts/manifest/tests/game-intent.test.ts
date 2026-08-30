/**
 * Contract tests for the published Game Intent catalog.
 *
 * The draft-07 game manifest deliberately validates only that `actions` is an
 * object. This file executes the independent JSON Schema 2020-12 contract over
 * every shipped catalog so action definitions and bounded parameter schemas do
 * not drift into imperative TypeScript checks.
 */
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import type {
  GameManifest,
  GameManifestStringActionParamSchema
} from "../src/index.ts";

type Ajv2020Constructor = new (options?: Record<string, unknown>) => {
  compile: (schema: unknown) => ValidateFunction;
};

const Ajv2020 =
  (Ajv2020Lib as unknown as { default?: Ajv2020Constructor }).default ??
  (Ajv2020Lib as unknown as Ajv2020Constructor);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const schemaPath = join(repoRoot, "docs", "architecture", "schemas", "game-intent.schema.json");
const manifestSchemaPath = join(repoRoot, "docs", "architecture", "schemas", "game-manifest.schema.json");
const generatedRoot = join(repoRoot, "packages", "contracts", "manifest", "src", "generated");

const readJson = (filePath: string): unknown => JSON.parse(readFileSync(filePath, "utf8"));

/** Collect generated game manifests without hardcoding game ids. */
function collectGameManifests(): string[] {
  const result: string[] = [];
  const gamesRoot = join(repoRoot, "games");
  for (const entry of readdirSync(gamesRoot, { withFileTypes: true })) {
    const manifestPath = join(gamesRoot, entry.name, "game.manifest.json");
    if (entry.isDirectory() && existsSync(manifestPath)) {
      result.push(manifestPath);
    }
  }
  return result.sort();
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateGameIntentCatalog = ajv.compile(readJson(schemaPath));

function validationErrors(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
}

const neutralCatalog = {
  "fixture.choose": {
    displayName: "Choose",
    allowedSessionRoles: ["player"],
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        choiceId: {
          type: "string",
          maxLength: 64
        }
      },
      required: ["choiceId"]
    },
    definitionHash: `sha256:${"0".repeat(64)}`,
    invocation: "external",
    binding: {
      kind: "mechanics-plan",
      planRef: "fixture.choose"
    }
  }
};

type HasStringIndex<T> = string extends keyof T ? true : false;
// These assignments intentionally fail `tsc` if generator normalization ever
// reintroduces the historical catch-all into either closed public structure.
const gameManifestHasStringIndex: HasStringIndex<GameManifest> = false;
const stringParamSchemaHasStringIndex: HasStringIndex<GameManifestStringActionParamSchema> = false;

describe("Game Intent JSON Schema 2020-12", () => {
  it("keeps draft-07 GameManifest as a structural delegation only", () => {
    const manifestSchema = readJson(manifestSchemaPath) as any;
    const actionsSchema = manifestSchema.definitions.GameManifest.properties.actions;
    expect(actionsSchema.type).toBe("object");
    expect(actionsSchema.$ref).toBeUndefined();
    expect(manifestSchema.definitions.GameManifestActionDefinition).toBeUndefined();
    expect(manifestSchema.definitions.GameManifestActionParamsSchema).toBeUndefined();
  });

  it("accepts a neutral actor-scoped catalog", () => {
    expect(validateGameIntentCatalog(neutralCatalog), validationErrors(validateGameIntentCatalog)).toBe(true);
  });

  it("requires the published external-or-system invocation boundary", () => {
    const invalid = structuredClone(neutralCatalog) as Record<string, Record<string, unknown>>;
    delete invalid["fixture.choose"]!.invocation;
    expect(validateGameIntentCatalog(invalid)).toBe(false);
  });

  for (const manifestPath of collectGameManifests()) {
    it(`validates ${relative(repoRoot, manifestPath)} actions`, () => {
      const manifest = readJson(manifestPath) as { actions?: unknown };
      expect(
        validateGameIntentCatalog(manifest.actions),
        `${relative(repoRoot, manifestPath)}: ${validationErrors(validateGameIntentCatalog)}`
      ).toBe(true);
    });
  }

  it("rejects fields outside the closed intent definition", () => {
    const invalid = structuredClone(neutralCatalog) as Record<string, Record<string, unknown>>;
    invalid["fixture.choose"]!.legacyHandler = "unsafe";
    expect(validateGameIntentCatalog(invalid)).toBe(false);
  });

  it("rejects parameter schemas with more than sixteen scalar properties", () => {
    const invalid = structuredClone(neutralCatalog) as any;
    invalid["fixture.choose"].paramsSchema.properties = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`param${index}`, { type: "boolean" }])
    );
    expect(validateGameIntentCatalog(invalid)).toBe(false);
  });

  it("rejects an open or extended string parameter schema", () => {
    const invalid = structuredClone(neutralCatalog) as any;
    invalid["fixture.choose"].paramsSchema.properties.choiceId.format = "uri";
    expect(validateGameIntentCatalog(invalid)).toBe(false);
  });

  it("enforces the shorter bound for a live resource reference", () => {
    const invalid = structuredClone(neutralCatalog) as any;
    invalid["fixture.choose"].paramsSchema.properties.choiceId.maxLength = 129;
    invalid["fixture.choose"].paramsSchema.properties.choiceId["x-cubica-ref"] = {
      kind: "object",
      collection: "choices",
      visibility: "public"
    };
    expect(validateGameIntentCatalog(invalid)).toBe(false);
  });

  it("rejects unsafe catalog keys and undeclared actor roles", () => {
    const unsafeKey = { constructor: neutralCatalog["fixture.choose"] };
    expect(validateGameIntentCatalog(unsafeKey)).toBe(false);

    const invalidRole = structuredClone(neutralCatalog) as any;
    invalidRole["fixture.choose"].allowedSessionRoles = ["administrator"];
    expect(validateGameIntentCatalog(invalidRole)).toBe(false);
  });
});

describe("schema-derived TypeScript closure", () => {
  it("keeps GameManifest and the string parameter schema free of a catch-all", () => {
    expect(gameManifestHasStringIndex).toBe(false);
    expect(stringParamSchemaHasStringIndex).toBe(false);

    const gameManifestSource = readFileSync(join(generatedRoot, "game-manifest.ts"), "utf8");
    const gameIntentSource = readFileSync(join(generatedRoot, "game-intent.ts"), "utf8");
    const manifestDeclaration = gameManifestSource.match(/export interface GameManifest \{[\s\S]*?\n\}/u)?.[0];
    const stringSchemaDeclaration = gameIntentSource.match(
      /export interface GameManifestStringActionParamSchema \{[\s\S]*?\n\}/u
    )?.[0];

    expect(manifestDeclaration).toBeDefined();
    expect(stringSchemaDeclaration).toBeDefined();
    expect(manifestDeclaration).toContain("actions: GameIntentCatalog");
    expect(manifestDeclaration).not.toContain("[k: string]: unknown");
    expect(stringSchemaDeclaration).not.toContain("[k: string]: unknown");
  });
});
