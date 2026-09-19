import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "",
  compile: vi.fn(),
  runtime: vi.fn(),
  plugin: vi.fn(),
  sourceMaps: vi.fn(),
  lease: vi.fn(),
  registeredRoot: undefined as string | undefined,
  runtimeFailure: false,
  compileFailure: false,
  registrations: [] as { sourceId: string; root: string }[]
}));

vi.mock("@/lib/compiler-workflow", () => ({
  compileGameForEditor: state.compile,
  loadPreviewSelectionSourceMaps: state.sourceMaps
}));
vi.mock("@/lib/editor-session-store", () => ({
  repoRootForSession: async () => ({
    repoRoot: state.root,
    session: { sessionId: "editor-session-1", gameId: "simple-choice", worktreePath: state.root }
  }),
  evaluateEditorSessionCompatibility: () => ({ ok: true }),
  withEditorSessionMutationLease: state.lease
}));
vi.mock("@/lib/editor-project-root", () => ({ configuredEditorProjectRoot: () => state.root }));
vi.mock("@/lib/project-plugin-validation", () => ({ validateAndBundleProjectPlugins: state.plugin }));
vi.mock("@/lib/editor-preview-runtime", () => ({ prepareRuntimeSession: state.runtime }));

import { POST } from "./route";

const testRoot = path.resolve(process.cwd(), ".tmp", "editor-current-preview-route-tests");
const sourceFile = path.join(testRoot, "games", "simple-choice", "authoring", "game.authoring.json");

function previewRequest(): Request {
  return new Request("http://editor.local/api/editor/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "simple-choice", sessionId: "editor-session-1" })
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.root = testRoot;
  state.registeredRoot = undefined;
  state.runtimeFailure = false;
  state.compileFailure = false;
  state.registrations = [];
  await rm(testRoot, { recursive: true, force: true });
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, '{"version":1}\n');
  state.lease.mockImplementation(async (_sessionId, _operation, callback) => callback());
  state.compile.mockImplementation(async ({ repoRoot, generatedArtifactRoot }: { repoRoot: string; generatedArtifactRoot: string }) => {
    const source = await readFile(path.join(repoRoot, "games", "simple-choice", "authoring", "game.authoring.json"), "utf8");
    if (state.compileFailure) return { ok: false, diagnostics: [{ severity: "error", message: "bad source" }], artifacts: [] };
    const generated = path.join(generatedArtifactRoot, "games", "simple-choice", "game.manifest.json");
    await writeFile(generated, source);
    return { ok: true, diagnostics: [], artifacts: [] };
  });
  state.plugin.mockResolvedValue({ ok: true, diagnostics: [], playerWebBundles: [] });
  state.sourceMaps.mockResolvedValue([]);
  state.runtime.mockImplementation(async (_gameId, _origin, contentSource: { contentSourceId: string; contentRoot: string }) => {
    state.registrations.push({ sourceId: contentSource.contentSourceId, root: contentSource.contentRoot });
    if (state.runtimeFailure) return { ready: false, diagnostics: [{ severity: "warning", message: "reload failed" }] };
    state.registeredRoot = contentSource.contentRoot;
    return { ready: true, playerUrl: "http://player.local/?contentSourceId=editor-session-1", diagnostics: [] };
  });
});
afterEach(async () => rm(testRoot, { recursive: true, force: true }));

describe("current editor preview root replacement", () => {
  it("registers a complete separate root with the same source ID, then retires the old root", async () => {
    const first = await POST(previewRequest());
    expect((await first.json()).ready).toBe(true);
    const oldRoot = state.registeredRoot!;
    expect(oldRoot).not.toBe(testRoot);
    expect(await readFile(path.join(oldRoot, "games", "simple-choice", "game.manifest.json"), "utf8"))
      .toBe('{"version":1}\n');

    await writeFile(sourceFile, '{"version":2}\n');
    state.runtime.mockImplementationOnce(async (_gameId, _origin, contentSource: { contentSourceId: string; contentRoot: string }) => {
      expect(contentSource.contentSourceId).toBe("editor-session-1");
      expect(contentSource.contentRoot).not.toBe(oldRoot);
      expect(await readFile(path.join(oldRoot, "games", "simple-choice", "game.manifest.json"), "utf8"))
        .toBe('{"version":1}\n');
      expect(await readFile(path.join(contentSource.contentRoot, "games", "simple-choice", "game.manifest.json"), "utf8"))
        .toBe('{"version":2}\n');
      state.registeredRoot = contentSource.contentRoot;
      return { ready: true, playerUrl: "http://player.local/?contentSourceId=editor-session-1", diagnostics: [] };
    });
    const second = await POST(previewRequest());
    expect((await second.json()).ready).toBe(true);
    await expect(readFile(path.join(oldRoot, "games", "simple-choice", "game.manifest.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(state.sourceMaps.mock.calls[1]?.[2]).toBe(state.registeredRoot);
    expect(state.lease).toHaveBeenCalledWith("editor-session-1", "preview-build", expect.any(Function));
  });

  it("keeps the registered root on compilation failure and on failed reload", async () => {
    await POST(previewRequest());
    const oldRoot = state.registeredRoot!;
    state.compileFailure = true;
    const failedCompile = await POST(previewRequest());
    expect((await failedCompile.json()).ready).toBe(false);
    expect(state.runtime).toHaveBeenCalledTimes(1);
    expect(state.registeredRoot).toBe(oldRoot);
    state.compileFailure = false;
    state.runtimeFailure = true;
    const failedReload = await POST(previewRequest());
    expect((await failedReload.json()).ready).toBe(false);
    expect(state.registeredRoot).toBe(oldRoot);
    expect(await readFile(path.join(oldRoot, "games", "simple-choice", "game.manifest.json"), "utf8"))
      .toBe('{"version":1}\n');
    const parent = path.dirname(oldRoot);
    expect((await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory())).toHaveLength(2);
  });

  it("recovers a pending root before allocating another replacement", async () => {
    await POST(previewRequest());
    const oldRoot = state.registeredRoot!;
    state.runtimeFailure = true;
    await POST(previewRequest());
    state.runtimeFailure = false;
    const resumed = await POST(previewRequest());
    expect((await resumed.json()).ready).toBe(true);
    expect(state.runtime).toHaveBeenCalledTimes(4);
    await expect(readFile(path.join(oldRoot, "games", "simple-choice", "game.manifest.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
