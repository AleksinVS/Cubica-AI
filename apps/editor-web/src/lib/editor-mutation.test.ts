import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorMutationRequest } from "@cubica/editor-engine";

const state = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  dryRunMode: "valid" as "valid" | "invalid" | "no-op",
  apply: vi.fn(),
  compile: vi.fn(),
  preview: vi.fn(),
  lease: vi.fn(),
  candidateSequence: 0,
  candidateDiscard: vi.fn(),
  candidateRetire: vi.fn()
}));

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

vi.mock("@cubica/editor-engine", async (importOriginal) => ({
  ...await importOriginal<typeof import("@cubica/editor-engine")>(),
  buildEditorEntityProjection: () => ({}),
  classifyChangeSet: () => ({ risk: "safe", reasons: [] }),
  createDocumentStore: () => ({ snapshot: () => ({ json: {} }) }),
  inferEditorEntityDocumentKind: () => undefined,
  dryRunMultiDocumentChangeSet: (input: {
    changeSet: { id: string; summary: string; jsonPatches: { filePath: string; operations: { value?: unknown }[] }[] };
    documentTextByPath: ReadonlyMap<string, string>;
  }) => {
    const before = new Map(input.documentTextByPath);
    if (state.dryRunMode === "invalid") return {
      ok: false, beforeTextByPath: before, afterTextByPath: new Map(),
      inverseChangeSet: { id: "inverse", summary: "Undo", jsonPatches: [] },
      affectedFilePaths: [...before.keys()], changedPointersByFile: {}, diffSummary: [],
      diagnostics: [{ severity: "error", source: "schema", pointer: "/v", message: "Invalid value" }]
    };
    const after = new Map(before);
    for (const patch of input.changeSet.jsonPatches) {
      if (state.dryRunMode !== "no-op") {
        after.set(patch.filePath, JSON.stringify({ v: patch.operations[0]?.value }));
      }
    }
    return {
      ok: true, beforeTextByPath: before, afterTextByPath: after,
      inverseChangeSet: { id: "inverse", summary: "Undo", jsonPatches: [] },
      affectedFilePaths: [...after.keys()], changedPointersByFile: {}, diffSummary: [], diagnostics: []
    };
  }
}));

vi.mock("./editor-repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("./editor-repository")>(),
  listAuthoringFiles: async () => ({ files: [...state.disk.keys()].map((filePath) => ({ filePath })) }),
  openAuthoringFile: async ({ filePath }: { filePath: string }) => {
    const text = state.disk.get(filePath);
    if (text === undefined) throw new Error(`missing ${filePath}`);
    return { text, versionHash: hash(text) };
  },
  applyAuthoringFilesToWorktree: state.apply
}));

vi.mock("./editor-session-store", () => ({
  repoRootForSession: async () => ({ repoRoot: "/test/worktree", session: { gameId: "simple-choice" } }),
  withEditorSessionMutationLease: state.lease
}));

vi.mock("./compiler-workflow", () => ({
  compileGameForEditor: state.compile,
  loadPreviewSelectionSourceMaps: async () => []
}));
vi.mock("./editor-preview-runtime", () => ({ prepareRuntimeSession: state.preview }));
vi.mock("./editor-mutation-candidate", () => ({
  createEditorMutationCandidate: async () => ({
    repoRoot: "/test/candidate", contentSourceId: `candidate-session-${++state.candidateSequence}`,
    discard: state.candidateDiscard, retirePrevious: state.candidateRetire
  }),
  copyCandidatePluginBundles: async () => undefined
}));
vi.mock("./project-plugin-validation", () => ({
  validateAndBundleProjectPlugins: async () => ({ ok: true, playerWebBundles: [], diagnostics: [] })
}));
vi.mock("./editor-json-schema", () => ({
  getSharedAuthoringSchemaRegistry: () => ({}),
  schemaIdForAuthoringDocument: () => undefined
}));

import { clearPendingEditorMutationEffectsForTests, executeEditorMutation, mutationErrorResponse, validateEditorMutationRequest } from "./editor-mutation";

const activeFilePath = "game.authoring.json";
const siblingFilePath = "ui/web.authoring.json";
const activeBuffer = JSON.stringify({ v: 1 });

function request(action: "prepare" | "direct" | "confirm", effectDigest?: string): EditorMutationRequest {
  return {
    action, gameId: "simple-choice", sessionId: "editor-session-1", activeFilePath,
    activeDocument: { text: activeBuffer, versionHash: hash(state.disk.get(activeFilePath) ?? "") },
    changeSet: {
      id: "change-1", summary: "Set values", jsonPatches: [
        { filePath: activeFilePath, operations: [{ op: "replace", path: "/v", value: 2 }] },
        { filePath: siblingFilePath, operations: [{ op: "replace", path: "/v", value: 3 }] }
      ]
    },
    ...(effectDigest === undefined ? {} : { effectDigest })
  } as EditorMutationRequest;
}

beforeEach(() => {
  clearPendingEditorMutationEffectsForTests();
  state.disk.clear();
  state.disk.set(activeFilePath, JSON.stringify({ v: 0 }));
  state.disk.set(siblingFilePath, JSON.stringify({ v: 0 }));
  state.dryRunMode = "valid";
  state.candidateSequence = 0;
  vi.clearAllMocks();
  state.candidateDiscard.mockResolvedValue(undefined);
  state.candidateRetire.mockResolvedValue(undefined);
  state.lease.mockImplementation(async (_sessionId, _operation, callback) => callback());
  state.compile.mockResolvedValue({ ok: true, diagnostics: [] });
  state.preview.mockResolvedValue({ ready: true, playerUrl: "http://player/?contentSourceId=pkg-test", diagnostics: [] });
  state.apply.mockImplementation(async ({ files, expectedBeforeHashes }: {
    files: { filePath: string; text: string }[];
    expectedBeforeHashes: Record<string, string>;
  }) => {
    for (const file of files) {
      if (hash(state.disk.get(file.filePath) ?? "") !== expectedBeforeHashes[file.filePath]) {
        throw new Error("stale disk");
      }
    }
    for (const file of files) state.disk.set(file.filePath, file.text);
    return { files: files.map((file) => ({ filePath: file.filePath, versionHash: hash(file.text) })) };
  });
});

describe("server editor mutation boundary", () => {
  it("validates all actions with the canonical schema", () => {
    expect(validateEditorMutationRequest(request("prepare"))).toBe(true);
    expect(validateEditorMutationRequest(request("direct"))).toBe(true);
    expect(validateEditorMutationRequest(request("confirm", "a".repeat(64)))).toBe(true);
    expect(validateEditorMutationRequest({ ...request("confirm"), files: [] })).toBe(false);
  });

  it("prepares both documents under the lease without authoring writes and binds the browser buffer", async () => {
    const result = await executeEditorMutation(request("prepare"), "http://editor");
    const body = result.body as { status: string; effectDigest: string; documents: { filePath: string; previousVersionHash: string }[] };
    expect(body.status).toBe("prepared");
    expect(body.documents).toHaveLength(2);
    expect(body.documents[0]?.previousVersionHash).toBe(hash(activeBuffer));
    expect(body.effectDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(state.lease).toHaveBeenCalledWith("editor-session-1", "editor-mutation:prepare", expect.any(Function));
    expect(state.compile.mock.calls[0]?.[0].authoringTextOverrides.get(activeFilePath)).toBe(JSON.stringify({ v: 2 }));
    expect(state.compile.mock.calls[0]?.[0].generatedArtifactRoot).toBe("/test/candidate");
    expect(state.preview.mock.calls[0]?.[2]).toMatchObject({ contentSourceId: "candidate-session-1", contentRoot: "/test/candidate" });
    expect(state.apply).not.toHaveBeenCalled();
    expect(state.disk.get(activeFilePath)).toBe(JSON.stringify({ v: 0 }));
  });

  it("rejects substituted digest and a stale active disk version before writing", async () => {
    await expect(executeEditorMutation(request("confirm", "f".repeat(64)), undefined))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(state.apply).not.toHaveBeenCalled();
    const stale = request("direct");
    state.disk.set(activeFilePath, JSON.stringify({ v: 9 }));
    await expect(executeEditorMutation(stale, undefined)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("rejects noncanonical paths before dry-run or preview", async () => {
    for (const filePath of ["./game.authoring.json", "ui//web.authoring.json", "ui/./web.authoring.json"]) {
      const invalid = request("prepare");
      await expect(executeEditorMutation({ ...invalid, activeFilePath: filePath }, undefined))
        .rejects.toMatchObject({ statusCode: 400 });
      await expect(executeEditorMutation({
        ...invalid,
        changeSet: {
          ...invalid.changeSet,
          jsonPatches: invalid.changeSet.jsonPatches.map((patch, index) => index === 0 ? { ...patch, filePath } : patch)
        }
      }, undefined)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(state.compile).not.toHaveBeenCalled();
    expect(state.preview).not.toHaveBeenCalled();
  });

  it("requires the latest ready candidate and consumes it after confirmation", async () => {
    const first = await executeEditorMutation(request("prepare"), undefined);
    const firstDigest = (first.body as { effectDigest: string }).effectDigest;
    const changed = request("prepare");
    const nextRequest = {
      ...changed,
      changeSet: { ...changed.changeSet, jsonPatches: changed.changeSet.jsonPatches.map((patch, index) => ({
        ...patch,
        operations: [{ op: "replace" as const, path: "/v", value: index === 0 ? 4 : 5 }]
      })) }
    };
    const second = await executeEditorMutation(nextRequest, undefined);
    const secondDigest = (second.body as { effectDigest: string }).effectDigest;
    expect(secondDigest).not.toBe(firstDigest);
    await expect(executeEditorMutation(request("confirm", firstDigest), undefined))
      .rejects.toMatchObject({ statusCode: 409 });
    await executeEditorMutation({ ...nextRequest, action: "confirm", effectDigest: secondDigest }, undefined);
    await expect(executeEditorMutation({ ...nextRequest, action: "confirm", effectDigest: secondDigest }, undefined))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("invalidates an older confirmation digest even when the same effect is prepared again", async () => {
    const first = await executeEditorMutation(request("prepare"), undefined);
    const firstDigest = (first.body as { effectDigest: string }).effectDigest;
    const second = await executeEditorMutation(request("prepare"), undefined);
    const secondDigest = (second.body as { effectDigest: string }).effectDigest;
    expect(secondDigest).not.toBe(firstDigest);
    await expect(executeEditorMutation(request("confirm", firstDigest), undefined))
      .rejects.toMatchObject({ statusCode: 409 });
    await expect(executeEditorMutation(request("confirm", secondDigest), undefined))
      .resolves.toMatchObject({ body: { status: "confirmed" } });
  });

  it("does not authorize a candidate whose runtime preview is not ready", async () => {
    state.preview.mockResolvedValueOnce({ ready: false, diagnostics: ["offline"] });
    const prepared = await executeEditorMutation(request("prepare"), undefined);
    const digest = (prepared.body as { effectDigest: string; preview: { ready: boolean } }).effectDigest;
    expect((prepared.body as { preview: { ready: boolean } }).preview.ready).toBe(false);
    await expect(executeEditorMutation(request("confirm", digest), undefined))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("rejects sibling changes and browser-buffer substitution after preparation", async () => {
    const prepared = await executeEditorMutation(request("prepare"), undefined);
    const digest = (prepared.body as { effectDigest: string }).effectDigest;
    state.disk.set(siblingFilePath, JSON.stringify({ v: 9 }));
    await expect(executeEditorMutation(request("confirm", digest), undefined))
      .rejects.toMatchObject({ statusCode: 409 });
    state.disk.set(siblingFilePath, JSON.stringify({ v: 0 }));
    const substituted = {
      ...request("confirm", digest), activeDocument: {
        text: JSON.stringify({ v: 8 }), versionHash: hash(state.disk.get(activeFilePath) ?? "")
      }
    };
    await expect(executeEditorMutation(substituted, undefined)).rejects.toMatchObject({ statusCode: 409 });
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("confirms the prepared effect and allows a dirty active browser buffer", async () => {
    const prepared = await executeEditorMutation(request("prepare"), undefined);
    const digest = (prepared.body as { effectDigest: string }).effectDigest;
    const result = await executeEditorMutation(request("confirm", digest), undefined);
    expect((result.body as { status: string }).status).toBe("confirmed");
    expect(state.disk.get(activeFilePath)).toBe(JSON.stringify({ v: 2 }));
    expect(state.disk.get(siblingFilePath)).toBe(JSON.stringify({ v: 3 }));
    expect(state.apply.mock.calls[0]?.[0].expectedBeforeHashes[activeFilePath]).toBe(hash(JSON.stringify({ v: 0 })));
    expect(state.compile.mock.calls[1]?.[0].generatedArtifactRoot).toBe("/test/candidate");
  });

  it("rejects invalid and no-op effects without compilation or writes", async () => {
    state.dryRunMode = "invalid";
    const invalid = await executeEditorMutation(request("prepare"), undefined);
    expect(invalid.status).toBe(422);
    expect((invalid.body as { status: string }).status).toBe("invalid");
    state.dryRunMode = "no-op";
    const noOp = await executeEditorMutation(request("direct"), undefined);
    expect(noOp.status).toBe(422);
    expect((noOp.body as { status: string }).status).toBe("no-op");
    expect(state.compile).not.toHaveBeenCalled();
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("returns a bounded validation error and leaves authoring bytes untouched when confirm compilation fails", async () => {
    const prepared = await executeEditorMutation(request("prepare"), undefined);
    const digest = (prepared.body as { effectDigest: string }).effectDigest;
    state.compile.mockResolvedValue({ ok: false, diagnostics: [{ severity: "error", source: "compile", pointer: "", message: "bad" }] });
    try {
      await executeEditorMutation(request("confirm", digest), undefined);
      throw new Error("expected validation error");
    } catch (error) {
      expect(mutationErrorResponse(error).status).toBe(422);
    }
    expect(state.apply).not.toHaveBeenCalled();
  });

  it("validates direct runtime output in an isolated root before writing", async () => {
    state.compile.mockResolvedValueOnce({ ok: false, diagnostics: [{ severity: "error", source: "compile", pointer: "", message: "bad" }] });
    await expect(executeEditorMutation(request("direct"), undefined))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(state.compile.mock.calls[0]?.[0].generatedArtifactRoot).toBe("/test/candidate");
    expect(state.apply).not.toHaveBeenCalled();
  });
});
