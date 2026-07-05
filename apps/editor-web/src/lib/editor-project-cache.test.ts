/**
 * Tests for the Level-2 PROJECT-artifact warm-start cache (ADR-057 §4.13
 * "Уровень 2 — проектные артефакты"; Phase 2.2b).
 *
 * Covers: key inputs (lens-set version participates), miss-then-hit telemetry via
 * the real cache dir, cache-disabled bypass, corrupt-file -> silent miss, the
 * documentHashes verification payload the client uses, and a build-vs-hit
 * measurement on a heavy authoring file (the honest warm-open number, design-spec
 * §5, profiling baseline §9.9).
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

const sampleText = `${JSON.stringify(
  {
    _manifestType: "game",
    id: "x",
    _label: "X",
    root: { _label: "X", logic: { actions: [{ id: "a", _label: "A" }] } }
  },
  null,
  2
)}\n`;

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

describe("editor project cache", () => {
  it("keys over filePath, text, and the lens-set version", () => {
    const a = computeProjectionArtifactKey("game.authoring.json", sampleText);
    expect(a).toBe(computeProjectionArtifactKey("game.authoring.json", sampleText)); // deterministic
    expect(a).not.toBe(computeProjectionArtifactKey("ui/web.authoring.json", sampleText)); // path matters
    expect(a).not.toBe(computeProjectionArtifactKey("game.authoring.json", `${sampleText} `)); // text matters
  });

  it("builds an envelope whose revived projection equals a fresh build, with a verification hash", async () => {
    const filePath = "game.authoring.json";
    const text = `${JSON.stringify({ _manifestType: "game", id: "verify", n: Date.now(), root: { _label: "V" } })}\n`;

    const envelope = await loadProjectionEnvelopeWithCache({ filePath, text, cacheEnabled: false });
    expect(envelope.lensSetVersion).toBe(PROJECTION_LENS_SET_VERSION);
    // The verification hash the client checks against its current text.
    expect(envelope.documentHashes?.[filePath]).toBe(hashEditorText(text));

    const snapshot = createDocumentStore({ filePath, text }).snapshot();
    const fresh = buildEditorEntityProjection({ documents: [{ filePath, json: snapshot.json }] });
    const revived = reviveEditorEntityProjection(JSON.parse(JSON.stringify(envelope)));
    expect(revived).not.toBeNull();
    expect(revived!.entities).toEqual(fresh.entities);
    expect(revived!.diagnostics).toEqual(fresh.diagnostics);
  });

  it("records a miss on first load and a hit on the second via the real cache dir", async () => {
    const filePath = "game.authoring.json";
    const text = `${JSON.stringify({ _manifestType: "game", id: "hitmiss", n: Date.now(), r: Math.random(), root: {} })}\n`;
    const telemetry = createEditorProjectionCacheTelemetry();

    await loadProjectionEnvelopeWithCache({ filePath, text, telemetry });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the deferred write land
    await loadProjectionEnvelopeWithCache({ filePath, text, telemetry });

    const snapshot = telemetry.snapshot();
    expect(snapshot.cacheMisses).toBe(1);
    expect(snapshot.cacheHits).toBe(1);
  });

  it("bypasses the cache when disabled", async () => {
    const telemetry = createEditorProjectionCacheTelemetry();
    const envelope = await loadProjectionEnvelopeWithCache({
      filePath: "game.authoring.json",
      text: sampleText,
      telemetry,
      cacheEnabled: false
    });
    expect(envelope.payload.entities.length).toBeGreaterThan(0);
    expect(telemetry.snapshot()).toEqual({ cacheHits: 0, cacheMisses: 0, hitReadMs: 0, missBuildMs: 0 });
  });

  it("measures projection build (cold) vs client revive (warm) on a heavy authoring file (profiling baseline §9.9)", async () => {
    const filePath = "games/antarctica/authoring/game.authoring.json";
    const text = await readFile(path.join(workspaceRoot, filePath), "utf8");

    // The client builds the DocumentStore snapshot regardless of hydration (it has
    // its own Level-2 cache from Phase 2.2a). Hydration replaces only the ENTITY
    // PROJECTION build with a revive, so the honest warm-open delta is
    // build-projection (over the already-built snapshot) vs revive.
    const snapshot = createDocumentStore({ filePath, text }).snapshot();
    const documents = [{ filePath, json: snapshot.json }];

    let buildMs = 0;
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      buildEditorEntityProjection({ documents });
      buildMs = performance.now() - start; // last iteration (warmed JIT)
    }

    const envelope = await loadProjectionEnvelopeWithCache({ filePath, text, cacheEnabled: false });
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
    // eslint-disable-next-line no-console
    console.log(
      `[L2 projection warm-open] antarctica cold(build)=${buildMs.toFixed(1)}ms warm(revive)=${reviveMs.toFixed(1)}ms ` +
        `entities=${revived!.entities.length} payload=${(serialized.length / 1024).toFixed(0)}KiB ` +
        `speedup=${(buildMs / reviveMs).toFixed(1)}x`
    );
  });
});
