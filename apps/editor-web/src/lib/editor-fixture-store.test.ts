/**
 * Tests for the server-side pinned-fixture store (ADR-057 §4.9, §9.3).
 *
 * A temp project holds a game + ui authoring manifest and a copy of the real
 * `state-fixture.schema.json`. The tests assert:
 *   - `writeStateFixture` stamps the current manifest hash, produces a
 *     schema-valid artifact (re-validated with the engine Ajv registry), and
 *     writes it under `games/<id>/authoring/fixtures/`;
 *   - a fixture whose `screenRef`/`stepRef` is unknown is REJECTED before write
 *     (semantic `fixture-unknown-ref`);
 *   - `listStateFixtures` marks a fixture stale when the manifests change so its
 *     captured hash no longer matches (`fixture-stale`).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STATE_FIXTURE_SCHEMA_ID,
  createSchemaRegistry,
  type JsonSchema,
  type JsonValue
} from "@cubica/editor-engine";

import { listStateFixtures, writeStateFixture } from "./editor-fixture-store";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const repoRoot = path.resolve(process.cwd(), ".tmp", "editor-fixture-store-tests");
const gameId = "simple-choice";

const gameManifest = JSON.stringify({
  _manifestType: "game",
  root: { logic: { flows: [{ id: "main", steps: [{ id: "i11" }, { id: "i12" }] }] } }
});
const uiManifest = JSON.stringify({
  _manifestType: "ui",
  _channel: "web",
  root: { screens: [{ id: "route-choice" }, { id: "camp" }] }
});

async function seedProject(): Promise<void> {
  const authoring = path.join(repoRoot, "games", gameId, "authoring");
  await mkdir(path.join(authoring, "ui"), { recursive: true });
  await writeFile(path.join(authoring, "game.authoring.json"), `${gameManifest}\n`, "utf8");
  await writeFile(path.join(authoring, "ui", "web.authoring.json"), `${uiManifest}\n`, "utf8");
  // The store loads state-fixture.schema.json from `<repoRoot>/docs/...`; copy the
  // real schema in so the temp project can validate exactly like a worktree.
  const schemaDir = path.join(repoRoot, "docs", "architecture", "schemas");
  await mkdir(schemaDir, { recursive: true });
  const schemaText = await readFile(path.join(workspaceRoot, "docs", "architecture", "schemas", "state-fixture.schema.json"), "utf8");
  await writeFile(path.join(schemaDir, "state-fixture.schema.json"), schemaText, "utf8");
}

describe("editor-fixture-store", () => {
  beforeEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await seedProject();
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("pins a schema-valid fixture with the current manifest hash", async () => {
    const fixture = await writeStateFixture({
      gameId,
      repoRoot,
      id: "day4-route-choice",
      label: "День 4, выбор маршрута",
      state: { stage: "day4", metrics: { food: 3 } },
      screenRef: "route-choice",
      stepRef: "i12"
    });

    expect(fixture.manifestHash).toMatch(/^sha256-[0-9a-f]{64}$/u);
    expect(fixture._label).toBe("День 4, выбор маршрута");

    // Re-validate the WRITTEN file with the engine Ajv registry: JSON Schema stays
    // the single source of truth (CLAUDE.md §12).
    const written = JSON.parse(
      await readFile(path.join(repoRoot, "games", gameId, "authoring", "fixtures", "day4-route-choice.json"), "utf8")
    ) as JsonValue;
    const schema = JSON.parse(
      await readFile(path.join(repoRoot, "docs", "architecture", "schemas", "state-fixture.schema.json"), "utf8")
    ) as JsonSchema;
    const registry = createSchemaRegistry();
    registry.registerSchema(STATE_FIXTURE_SCHEMA_ID, schema);
    expect(registry.validateValue({ schemaId: STATE_FIXTURE_SCHEMA_ID, value: written })).toEqual([]);
  });

  it("rejects a fixture with an unknown stepRef before writing", async () => {
    await expect(
      writeStateFixture({
        gameId,
        repoRoot,
        id: "ghost",
        label: "Ghost",
        state: { stage: "x" },
        stepRef: "i99"
      })
    ).rejects.toThrow(/semantic validation/u);
  });

  it("marks a fixture stale once the manifests change", async () => {
    await writeStateFixture({
      gameId,
      repoRoot,
      id: "day4",
      label: "День 4",
      state: { stage: "day4" }
    });

    const fresh = await listStateFixtures({ gameId, repoRoot });
    expect(fresh.fixtures).toHaveLength(1);
    expect(fresh.fixtures[0]?.stale).toBe(false);

    // Change a manifest so the captured hash no longer matches.
    await writeFile(
      path.join(repoRoot, "games", gameId, "authoring", "game.authoring.json"),
      `${JSON.stringify({ _manifestType: "game", root: { logic: { flows: [{ id: "main", steps: [{ id: "i11" }, { id: "i12" }, { id: "i13" }] }] } } })}\n`,
      "utf8"
    );

    const afterEdit = await listStateFixtures({ gameId, repoRoot });
    expect(afterEdit.fixtures[0]?.stale).toBe(true);
    expect(afterEdit.fixtures[0]?.diagnostics.some((diagnostic) => diagnostic.code === "fixture-stale")).toBe(true);
  });
});
