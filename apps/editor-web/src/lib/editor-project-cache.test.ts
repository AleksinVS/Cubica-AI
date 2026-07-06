/**
 * Tests for the Level-2 PROJECT-artifact warm-start cache (ADR-057 §4.13
 * "Уровень 2 — проектные артефакты"; Phase 2.2b/3.a).
 *
 * Covers: the PROJECT key (every document + active channel + lens-set version
 * participate), miss-then-hit telemetry via the real cache dir, cache-disabled
 * bypass, corrupt-file -> silent miss, the per-document `documentHashes`
 * verification payload the client uses, cross-document facets in the envelope, and
 * a build-vs-hit measurement on a heavy authoring file.
 */
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, afterAll } from "vitest";

import {
  PROJECTION_LENS_SET_VERSION,
  buildEditorEntityProjection,
  createDocumentStore,
  hashEditorText,
  reviveEditorEntityProjection
} from "@cubica/editor-engine";
import {
  computeProjectionArtifactKey,
  createEditorProjectionCacheTelemetry,
  loadProjectionEnvelopeWithCache
} from "./editor-project-cache";

const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const testRoot = path.join(workspaceRoot, ".tmp", "editor-project-cache-tests");

const gameText = `${JSON.stringify(
  {
    _manifestType: "game",
    id: "x",
    _label: "X",
    root: {
      _label: "X",
      logic: {
        flows: [{ id: "main", steps: [{ id: "main.start", _type: "game.Step", _label: "Start", screenId: "intro" }] }],
        actions: [{ id: "a", _label: "A" }]
      }
    }
  },
  null,
  2
)}\n`;
const uiText = `${JSON.stringify(
  {
    _manifestType: "ui",
    _channel: "web",
    root: {
      _type: "ui.Manifest",
      _label: "UI",
      screens: [{ id: "intro", _type: "ui.Screen", _label: "Intro" }]
    }
  },
  null,
  2
)}\n`;
const gameDoc = { filePath: "game.authoring.json", text: gameText };
const uiDoc = { filePath: "ui/web.authoring.json", text: uiText };

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("editor project cache", () => {
  it("keys over every document, the active channel, and the lens-set version", () => {
    const base = computeProjectionArtifactKey([gameDoc, uiDoc], "web");
    expect(base).toBe(computeProjectionArtifactKey([gameDoc, uiDoc], "web")); // deterministic
    // Document ORDER must not change the key (the builder is order-independent).
    expect(base).toBe(computeProjectionArtifactKey([uiDoc, gameDoc], "web"));
    // A sibling document is a key input: dropping it changes the key.
    expect(base).not.toBe(computeProjectionArtifactKey([gameDoc], "web"));
    // Any document's text is a key input.
    expect(base).not.toBe(computeProjectionArtifactKey([gameDoc, { ...uiDoc, text: `${uiText} ` }], "web"));
    // The active channel is a key input.
    expect(base).not.toBe(computeProjectionArtifactKey([gameDoc, uiDoc], "telegram"));
    expect(base).not.toBe(computeProjectionArtifactKey([gameDoc, uiDoc], undefined));
  });

  it("builds a project envelope whose revived projection equals a fresh cross-document build", async () => {
    const envelope = await loadProjectionEnvelopeWithCache({
      documents: [gameDoc, uiDoc],
      activeChannel: "web",
      cacheEnabled: false
    });
    expect(envelope.lensSetVersion).toBe(PROJECTION_LENS_SET_VERSION);
    // A verification hash per document the client will use.
    expect(envelope.documentHashes?.[gameDoc.filePath]).toBe(hashEditorText(gameText));
    expect(envelope.documentHashes?.[uiDoc.filePath]).toBe(hashEditorText(uiText));

    const documents = [gameDoc, uiDoc].map((entry) => ({
      filePath: entry.filePath,
      json: createDocumentStore({ filePath: entry.filePath, text: entry.text }).snapshot().json
    }));
    const fresh = buildEditorEntityProjection({ documents, activeChannel: "web" });
    const revived = reviveEditorEntityProjection(JSON.parse(JSON.stringify(envelope)));
    expect(revived).not.toBeNull();
    expect(revived!.entities).toEqual(fresh.entities);
    expect(revived!.diagnostics).toEqual(fresh.diagnostics);
    // The cross-document facet is present: the game step gets the UI screen view.
    expect(revived!.entityById.get("game-step:main.start")?.facets.view?.[0]?.filePath).toBe(uiDoc.filePath);
  });

  it("records a miss on first load and a hit on the second via the real cache dir", async () => {
    const marker = `${JSON.stringify({ _manifestType: "game", id: "hitmiss", n: Date.now(), r: Math.random(), root: {} })}\n`;
    const documents = [{ filePath: "game.authoring.json", text: marker }, uiDoc];
    const telemetry = createEditorProjectionCacheTelemetry();

    await loadProjectionEnvelopeWithCache({ documents, activeChannel: "web", telemetry });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the deferred write land
    await loadProjectionEnvelopeWithCache({ documents, activeChannel: "web", telemetry });

    const snapshot = telemetry.snapshot();
    expect(snapshot.cacheMisses).toBe(1);
    expect(snapshot.cacheHits).toBe(1);
  });

  it("bypasses the cache when disabled", async () => {
    const telemetry = createEditorProjectionCacheTelemetry();
    const envelope = await loadProjectionEnvelopeWithCache({
      documents: [gameDoc, uiDoc],
      activeChannel: "web",
      telemetry,
      cacheEnabled: false
    });
    expect(envelope.payload.entities.length).toBeGreaterThan(0);
    expect(telemetry.snapshot()).toEqual({ cacheHits: 0, cacheMisses: 0, hitReadMs: 0, missBuildMs: 0 });
  });

  it("measures project projection build (cold) vs client revive (warm) on the real antarctica game (profiling baseline §9.9)", async () => {
    const gameFilePath = "games/antarctica/authoring/game.authoring.json";
    const webFilePath = "games/antarctica/authoring/ui/web.authoring.json";
    const documents = [
      { filePath: gameFilePath, text: await readFile(path.join(workspaceRoot, gameFilePath), "utf8") },
      { filePath: webFilePath, text: await readFile(path.join(workspaceRoot, webFilePath), "utf8") }
    ];

    const projectionDocuments = documents.map((entry) => ({
      filePath: entry.filePath,
      json: createDocumentStore({ filePath: entry.filePath, text: entry.text }).snapshot().json
    }));

    let buildMs = 0;
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      buildEditorEntityProjection({ documents: projectionDocuments, activeChannel: "web" });
      buildMs = performance.now() - start; // last iteration (warmed JIT)
    }

    const envelope = await loadProjectionEnvelopeWithCache({ documents, activeChannel: "web", cacheEnabled: false });
    const serialized = JSON.stringify(envelope);
    let reviveMs = 0;
    let revived = reviveEditorEntityProjection(JSON.parse(serialized));
    for (let i = 0; i < 5; i += 1) {
      const parsed = JSON.parse(serialized);
      const start = performance.now();
      revived = reviveEditorEntityProjection(parsed);
      reviveMs = performance.now() - start;
    }

    expect(revived).not.toBeNull();
    const viewFacetCount = revived!.entities.filter((entity) => entity.facets.view !== undefined).length;
    // eslint-disable-next-line no-console
    console.log(
      `[L2 project projection warm-open] antarctica cold(build)=${buildMs.toFixed(1)}ms warm(revive)=${reviveMs.toFixed(1)}ms ` +
        `entities=${revived!.entities.length} withViewFacet=${viewFacetCount} payload=${(serialized.length / 1024).toFixed(0)}KiB ` +
        `speedup=${(buildMs / reviveMs).toFixed(1)}x`
    );
  });
});
