import { describe, expect, it, vi } from "vitest";
import { forwardMvpAgentRequest, isMvpExactTextOrNamePrompt, parseMvpAgentCandidate, resolveMvpAgentCandidateScope, type MvpAgentCandidateScope } from "./mvp-agent-candidate";

const filePath = "ui/web.authoring.json";
const pointer = "/root/screens/0/root/children/0";
const scope: MvpAgentCandidateScope = {
  token: "request-1", gameId: "simple-choice", sessionId: "session-1",
  sources: [{ filePath, pointer, revision: "revision-1" }]
};
const live = { gameId: scope.gameId, sessionId: scope.sessionId, revisions: new Map([[filePath, "revision-1"]]) };
const candidate = {
  id: "candidate-1", summary: "Change label", jsonPatches: [{ filePath,
    operations: [{ op: "replace", path: `${pointer}/_label`, value: "Новый ответ" }] }]
};

describe("MVP agent candidate boundary", () => {
  it("requires the captured request token and never falls back to a later selection", () => {
    expect(resolveMvpAgentCandidateScope(scope, scope.token)).toEqual({ ok: true, scope });
    expect(resolveMvpAgentCandidateScope(scope, undefined).ok).toBe(false);
    expect(resolveMvpAgentCandidateScope(scope, "other-request").ok).toBe(false);
    expect(resolveMvpAgentCandidateScope(null, scope.token).ok).toBe(false);
    expect(resolveMvpAgentCandidateScope(null, undefined).ok).toBe(false);
    const afterGameSwitch = { ...scope, token: "request-2", gameId: "antarctica" };
    expect(resolveMvpAgentCandidateScope(afterGameSwitch, scope.token).ok).toBe(false);
  });
  it("uses the local planner only for a single explicit text or name change", () => {
    expect(isMvpExactTextOrNamePrompt("Измени текст на «Проверка MVP»")).toBe(true);
    expect(isMvpExactTextOrNamePrompt("Поменяй надпись кнопки на \"Старт\"")).toBe(true);
    expect(isMvpExactTextOrNamePrompt("Сделай кнопку синей с надписью «Старт»")).toBe(false);
    expect(isMvpExactTextOrNamePrompt("Сделай кнопку крупнее")).toBe(false);
  });
  it("accepts a selected JSON source through the canonical change-set schema", () => {
    expect(parseMvpAgentCandidate(JSON.stringify(candidate), scope, live)).toEqual({ ok: true, changeSet: candidate });
    expect(parseMvpAgentCandidate(JSON.stringify({ ...candidate, jsonPatches: [{ filePath,
      operations: [{ op: "add", path: `${pointer}/_prompt/raw`, value: "Новый замысел" }] }] }), scope, live).ok).toBe(true);
  });

  it("rejects malformed shapes, escapes and non-JSON side effects before preparation", () => {
    const invalid = [
      "{",
      JSON.stringify({ ...candidate, unknown: true }),
      JSON.stringify({ ...candidate, jsonPatches: [{ filePath, operations: [{ op: "move", path: `${pointer}/_label`, from: "/root" }] }] }),
      JSON.stringify({ ...candidate, jsonPatches: [{ filePath, operations: [{ op: "replace", path: "/root", value: "bad" }] }] }),
      JSON.stringify({ ...candidate, jsonPatches: [{ filePath, operations: [{ op: "replace", path: `${pointer}2/_label`, value: "bad" }] }] }),
      JSON.stringify({ ...candidate, fileDeletes: [{ filePath }] }),
      JSON.stringify({ ...candidate, jsonPatches: [{ filePath, operations: [{ op: "test", path: `${pointer}/_label`, value: "Ответ" }] }] })
    ];
    for (const input of invalid) expect(parseMvpAgentCandidate(input, scope, live).ok, input).toBe(false);
  });

  it("rejects a captured request after game, session or source revision changes", () => {
    expect(parseMvpAgentCandidate(JSON.stringify(candidate), scope, { ...live, gameId: "antarctica" }).ok).toBe(false);
    expect(parseMvpAgentCandidate(JSON.stringify(candidate), scope, { ...live, sessionId: "session-2" }).ok).toBe(false);
    expect(parseMvpAgentCandidate(JSON.stringify(candidate), scope, { ...live, revisions: new Map([[filePath, "revision-2"]]) }).ok).toBe(false);
  });

  it("reports unavailable or failed agent forwarding without claiming acceptance", async () => {
    expect((await forwardMvpAgentRequest(null, "Change", "context")).forwarded).toBe(false);
    const rejected = vi.fn(async () => { throw new Error("Agent unavailable"); });
    expect(await forwardMvpAgentRequest(rejected, "Change", "context")).toEqual({ forwarded: false, message: "Agent unavailable" });
    expect(rejected).toHaveBeenCalledWith({ text: "Change", context: "context" });
    const accepted = vi.fn(async () => {});
    expect((await forwardMvpAgentRequest(accepted, "Change", "context")).forwarded).toBe(true);
  });

  it("limits the complete authored draft even when it is hidden from the chat", async () => {
    const sender = vi.fn(async () => {});
    expect((await forwardMvpAgentRequest(sender, "Change", "source", "x".repeat(12_001))).forwarded).toBe(false);
    expect(sender).not.toHaveBeenCalled();
    const draft = "x".repeat(12_000);
    expect((await forwardMvpAgentRequest(sender, "Change", "source", draft)).forwarded).toBe(true);
    expect(sender).toHaveBeenCalledWith({ text: "Change", context: `source\n\n${draft}` });
  });
});
