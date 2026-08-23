/**
 * Focused tests for idempotent command delivery and snapshot ownership at the
 * player-web/runtime boundary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GamePlayerUiContent, PlayerFacingContent } from "@cubica/contracts-manifest";
import type { SessionVersionNotification } from "@cubica/contracts-session";

import type { GameSession } from "@/types/game-state";
import { createDefaultGameConfig, createDefaultGameConfigData } from "./game-config";
import { GamePresenter } from "./game-presenter";
import { ReactViewGateway } from "./react-view-gateway";
import * as runtimeClient from "./runtime-client";
import {
  loadPendingRuntimeCommand,
  savePendingRuntimeCommand
} from "./command-outbox";
import { buildPrivateInviteFragment } from "@/lib/private-invite-fragment";

let sessionVersionCallback: ((notification: SessionVersionNotification, requiresResync?: boolean) => void) | null = null;
let unsubscribeSessionVersions: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionVersionCallback = null;
  unsubscribeSessionVersions = vi.fn();
  vi.spyOn(runtimeClient, "subscribeSessionVersions").mockImplementation((_sessionId, onVersion) => {
    sessionVersionCallback = onVersion;
    return unsubscribeSessionVersions;
  });
});

const turnSession = (
  activePlayerId: unknown,
  players?: Record<string, unknown>
): GameSession => ({
  sessionId: "session-hotseat",
  gameId: "turn-fixture",
  participants: [
    { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" },
    { seatId: "p2", playerId: "p2", kind: "human", joinState: "local" },
  ],
  version: {
    sessionId: "session-hotseat",
    stateVersion: 1,
    lastEventSequence: 0
  },
  actionAvailability: [],
  state: {
    ...(players === undefined ? {} : { players }),
    public: {
      turn: { activePlayerId }
    },
    secret: {}
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
});

describe("GamePresenter session recovery", () => {
  it.each([401, 404])("replaces an inaccessible local session after HTTP %s and clears its outbox", async (status) => {
    const content = neutralContent("neutral-session-recovery");
    const config = createDefaultGameConfig(createDefaultGameConfigData(content));
    const freshSession: GameSession = {
      ...turnSession("p1"),
      sessionId: "session-fresh",
      gameId: content.gameId,
      version: {
        sessionId: "session-fresh",
        stateVersion: 0,
        lastEventSequence: 0
      }
    };
    window.localStorage.setItem(config.storageKey, "session-stale");
    savePendingRuntimeCommand({
      endpoint: "action",
      envelope: {
        sessionId: "session-stale",
        actionId: "turn.roll",
        commandId: "cli_AAAAAAAAAAAAAAAAAAAAAA",
        expectedStateVersion: 3,
        params: {}
      }
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Session is inaccessible" }), { status }))
      .mockResolvedValueOnce(runtimeResponse(freshSession, 0));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config
    });
    await presenter.boot();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/runtime/sessions/session-stale",
      "/api/runtime/sessions"
    ]);
    expect(window.localStorage.getItem(config.storageKey)).toBe("session-fresh");
    expect(loadPendingRuntimeCommand("session-stale")).toBeNull();
    expect(presenter.sessionSnapshot?.sessionId).toBe("session-fresh");
  });

  it("uses only the portal rebind flow when launch parameters are present", async () => {
    const content = neutralContent("neutral-portal-rebind");
    const config = createDefaultGameConfig(createDefaultGameConfigData(content));
    const portalSession: GameSession = {
      ...turnSession("p1"),
      sessionId: "session-portal",
      gameId: content.gameId,
      version: {
        sessionId: "session-portal",
        stateVersion: 0,
        lastEventSequence: 0
      }
    };
    window.history.replaceState({}, "", "/?launchToken=opaque-token&launchCounter=7");
    window.localStorage.setItem(config.storageKey, "unrelated-local-session");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      runtimeSession: portalSession
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config
    });
    await presenter.boot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/portal/runtime-session");
    expect(window.localStorage.getItem(config.storageKey)).toBe("unrelated-local-session");
    expect(presenter.sessionSnapshot?.sessionId).toBe("session-portal");
  });

  it("keeps automatic creation when the content has no agent-seat declaration", async () => {
    const content = neutralContent("neutral-auto-create");
    const session = { ...turnSession("p1"), gameId: content.gameId };
    const fetchMock = vi.fn().mockResolvedValue(runtimeResponse(session, 0));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    await presenter.boot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenter.playerState.sessionSetup).toBeNull();
    expect(presenter.sessionSnapshot?.sessionId).toBe(session.sessionId);
  });

  it("requires an explicit human/agent choice before creating a declared session", async () => {
    const content = agentSeatContent("neutral-agent-setup", 2);
    const session = { ...turnSession("p1"), gameId: content.gameId };
    const fetchMock = vi.fn().mockResolvedValue(runtimeResponse(session, 0));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    await presenter.boot();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(presenter.playerState.sessionSetup).toEqual({
      participantCount: 2,
      minParticipants: 2,
      maxAgentSeats: 2,
      privateInviteAvailable: true
    });

    await presenter.createSessionFromSetup({ agentSeatCount: 0 });
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      gameId: content.gameId
    });
  });

  it("bounds agent seats, blocks duplicate setup submits and keeps a creation error on the form", async () => {
    const content = agentSeatContent("neutral-agent-bounds", 1);
    let rejectCreation: (error: Error) => void = () => undefined;
    const deferred = new Promise<Response>((_resolve, reject) => {
      rejectCreation = reject;
    });
    const fetchMock = vi.fn().mockReturnValue(deferred);
    vi.stubGlobal("fetch", fetchMock);
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    await presenter.boot();

    await presenter.createSessionFromSetup({ agentSeatCount: 2 });
    expect(fetchMock).not.toHaveBeenCalled();

    const creation = presenter.createSessionFromSetup({ agentSeatCount: 1 });
    const duplicate = presenter.createSessionFromSetup({ agentSeatCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(presenter.playerState.booting).toBe(true);
    expect(presenter.playerState.sessionSetup).toBeNull();
    await duplicate;
    rejectCreation(new Error("creation failed"));
    await creation;
    expect(presenter.playerState.booting).toBe(false);
    expect(presenter.playerState.sessionSetup).not.toBeNull();
    expect(presenter.playerState.error).toBe("creation failed");
  });

  it("resets a declared session back to setup without creating it implicitly", async () => {
    const content = agentSeatContent("neutral-agent-reset", 1);
    const session = { ...turnSession("p1"), gameId: content.gameId };
    const fetchMock = vi.fn().mockResolvedValue(runtimeResponse(session, 0));
    vi.stubGlobal("fetch", fetchMock);
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    await presenter.boot();
    expect(presenter.playerState.sessionSetup).not.toBeNull();

    await presenter.resetGame();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(presenter.sessionSnapshot).toBeNull();
    expect(presenter.playerState.sessionSetup).not.toBeNull();
  });

  it("offers private invites for a ranged published setup but explicitly disables them in editor preview", async () => {
    const content: PlayerFacingContent = {
      ...neutralContent("neutral-ranged-setup"),
      playerConfig: { min: 2, max: 6 }
    };
    const published = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content)),
      editorPreviewMode: false
    });
    const preview = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content)),
      editorPreviewMode: true
    });

    await published.boot();
    await preview.boot();

    expect(published.playerState.sessionSetup).toEqual({
      participantCount: 2,
      minParticipants: 2,
      maxAgentSeats: 0,
      privateInviteAvailable: true
    });
    expect(preview.playerState.sessionSetup).toEqual({
      participantCount: 2,
      minParticipants: 2,
      maxAgentSeats: 0,
      privateInviteAvailable: false
    });
  });

  it("clears a private invite fragment before a failed import can expose it in the address bar", async () => {
    const content = neutralContent("neutral-private-import");
    const invite = {
      sessionId: "session-private",
      invite: {
        seatId: "seat-2",
        playerId: "player-2",
        credential: `ses_${"a".repeat(43)}`
      }
    } as const;
    window.history.replaceState({}, "", `/play?gameId=${content.gameId}${buildPrivateInviteFragment(invite)}`);
    const importInvite = vi.spyOn(runtimeClient, "importPrivateInvite")
      .mockRejectedValue(new Error("invite rejected"));
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });

    await presenter.boot();

    expect(importInvite).toHaveBeenCalledWith(invite);
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?gameId=${content.gameId}`);
    expect(presenter.sessionSnapshot).toBeNull();
    expect(presenter.playerState.error).toBe("invite rejected");
  });

  it("clears a malformed private invite before the readiness request starts", async () => {
    const content: PlayerFacingContent = {
      ...neutralContent("neutral-private-readiness"),
      executionMode: "ai-driven",
      agentRuntime: {
        ...({ initialActionId: "agent.continue" } as { initialActionId: string }),
        agentId: "scenario-agent",
        runtimeId: "mock",
        required: true,
        failurePolicy: "pause",
        surfaceCatalog: ["cubica.choiceList"]
      }
    };
    window.history.replaceState({}, "", "/play#invite?credential=malformed");
    const fetchMock = vi.fn().mockImplementation(() => {
      expect(window.location.hash).toBe("");
      return Promise.resolve(new Response(JSON.stringify({
        ready: false,
        service: "runtime-api",
        gameId: content.gameId,
        executionMode: "ai-driven",
        dependencies: {
          agentRuntime: {
            status: "error",
            required: true,
            mode: "missing",
            runtimeId: "mock",
            failurePolicy: "pause",
            reason: "Agent Runtime unavailable"
          }
        }
      }), { status: 503 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });

    await presenter.boot();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");
    expect(presenter.sessionSnapshot).toBeNull();
  });
});

describe("GamePresenter session version cursor", () => {
  it("ignores stale, duplicate and malformed notifications", async () => {
    const { presenter, resume } = await bootPresenterWithSession(versionedSession(3, 5));

    sessionVersionCallback?.({ stateVersion: 2, lastEventSequence: 99 });
    sessionVersionCallback?.({ stateVersion: 3, lastEventSequence: 5 });
    sessionVersionCallback?.({ stateVersion: -1, lastEventSequence: 6 } as SessionVersionNotification);
    sessionVersionCallback?.({ stateVersion: 4 } as SessionVersionNotification);
    await Promise.resolve();

    expect(resume).not.toHaveBeenCalled();
    expect(presenter.sessionSnapshot?.version).toMatchObject({ stateVersion: 3, lastEventSequence: 5 });
  });

  it("refreshes through one safe GET when a newer cursor arrives", async () => {
    const refreshed = versionedSession(2, 4);
    const { presenter, resume } = await bootPresenterWithSession(versionedSession(1, 1), refreshed);

    sessionVersionCallback?.({ stateVersion: 2, lastEventSequence: 4 });

    await vi.waitFor(() => expect(presenter.sessionSnapshot?.version).toMatchObject({
      stateVersion: 2,
      lastEventSequence: 4
    }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith("session-hotseat");
  });

  it("repairs a snapshot-to-subscription gap on the first event even when its cursor is equal", async () => {
    const refreshed = versionedSession(2, 4);
    const { presenter, resume } = await bootPresenterWithSession(versionedSession(1, 1), refreshed);

    sessionVersionCallback?.({ stateVersion: 1, lastEventSequence: 1 }, true);

    await vi.waitFor(() => expect(presenter.sessionSnapshot?.version).toMatchObject({
      stateVersion: 2,
      lastEventSequence: 4
    }));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple newer cursors when the in-flight GET already reaches the newest one", async () => {
    let resolveRefresh: (session: GameSession) => void = () => undefined;
    const refresh = new Promise<GameSession>((resolve) => { resolveRefresh = resolve; });
    const { presenter, resume } = await bootPresenterWithSession(versionedSession(1, 1));
    resume.mockReturnValueOnce(refresh);

    sessionVersionCallback?.({ stateVersion: 2, lastEventSequence: 2 });
    sessionVersionCallback?.({ stateVersion: 3, lastEventSequence: 7 });
    resolveRefresh(versionedSession(3, 7));

    await vi.waitFor(() => expect(presenter.sessionSnapshot?.version).toMatchObject({
      stateVersion: 3,
      lastEventSequence: 7
    }));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("drains a cursor emitted synchronously while setup session creation is still booting", async () => {
    const content: PlayerFacingContent = {
      ...neutralContent("neutral-setup-cursor"),
      playerConfig: { min: 2, max: 6 }
    };
    const created = { ...versionedSession(1, 1), gameId: content.gameId };
    const refreshed = { ...versionedSession(2, 3), gameId: content.gameId };
    vi.spyOn(runtimeClient, "createNewSessionWithOptions").mockResolvedValue(created);
    const resume = vi.spyOn(runtimeClient, "resumeSession").mockResolvedValue(refreshed);
    vi.mocked(runtimeClient.subscribeSessionVersions).mockImplementation((_sessionId, onVersion) => {
      sessionVersionCallback = onVersion;
      onVersion({ stateVersion: 2, lastEventSequence: 3 });
      return unsubscribeSessionVersions;
    });
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content)),
      editorPreviewMode: false
    });
    await presenter.boot();

    await presenter.createSessionFromSetup({ agentSeatCount: 0, accessMode: "private-invite" });

    expect(resume).toHaveBeenCalledTimes(1);
    expect(presenter.sessionSnapshot?.version).toMatchObject({ stateVersion: 2, lastEventSequence: 3 });
  });

  it("does not lose a cursor emitted during the action's final view sync", async () => {
    const initial = versionedSession(1, 1);
    const actionSnapshot = versionedSession(2, 2);
    const refreshed = versionedSession(3, 4);
    const { presenter, resume, gateway } = await bootPresenterWithSession(initial, refreshed);
    vi.spyOn(runtimeClient, "dispatchAction").mockResolvedValue(actionSnapshot);
    let emitted = false;
    gateway.subscribe((command) => {
      const state = command.payload?.state as { isPending?: boolean; version?: unknown } | undefined;
      if (!emitted && command.type === "SYNC_STATE" && state?.isPending === false && presenter.sessionSnapshot?.version.stateVersion === 2) {
        emitted = true;
        sessionVersionCallback?.({ stateVersion: 3, lastEventSequence: 4 });
      }
    });

    await presenter.handleBoardAction("turn.advance");
    await vi.waitFor(() => expect(presenter.sessionSnapshot?.version).toMatchObject({
      stateVersion: 3,
      lastEventSequence: 4
    }));

    expect(emitted).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("treats a notification already covered by the action response as inert", async () => {
    let resolveAction: (session: GameSession) => void = () => undefined;
    const action = new Promise<GameSession>((resolve) => { resolveAction = resolve; });
    const { presenter, resume } = await bootPresenterWithSession(versionedSession(1, 1));
    vi.spyOn(runtimeClient, "dispatchAction").mockReturnValue(action);

    const pendingAction = presenter.handleBoardAction("turn.advance");
    sessionVersionCallback?.({ stateVersion: 2, lastEventSequence: 2 });
    resolveAction(versionedSession(2, 2));
    await pendingAction;
    await Promise.resolve();

    expect(resume).not.toHaveBeenCalled();
    expect(presenter.sessionSnapshot?.version).toMatchObject({ stateVersion: 2, lastEventSequence: 2 });
  });

  it("unsubscribes the active session stream when disposed", async () => {
    const { presenter } = await bootPresenterWithSession(versionedSession(1, 1));

    presenter.dispose();

    expect(unsubscribeSessionVersions).toHaveBeenCalledTimes(1);
  });

  it("does not let a delayed refresh resurrect a session after reset", async () => {
    let resolveRefresh: (session: GameSession) => void = () => undefined;
    const delayedRefresh = new Promise<GameSession>((resolve) => { resolveRefresh = resolve; });
    const { presenter, resume } = await bootPresenterWithSession(versionedSession(1, 1));
    Reflect.set(presenter, "content", agentSeatContent("turn-fixture", 2));
    resume.mockReturnValueOnce(delayedRefresh);

    sessionVersionCallback?.({ stateVersion: 2, lastEventSequence: 2 });
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    await presenter.resetGame();
    resolveRefresh(versionedSession(2, 2));
    await Promise.resolve();
    await Promise.resolve();

    expect(unsubscribeSessionVersions).toHaveBeenCalledTimes(1);
    expect(presenter.sessionSnapshot).toBeNull();
    expect(presenter.playerState.sessionSetup).not.toBeNull();
  });

  it("does not attach or apply a boot result that resolves after dispose", async () => {
    let resolveCreate: (session: GameSession) => void = () => undefined;
    const delayedCreate = new Promise<GameSession>((resolve) => { resolveCreate = resolve; });
    const content = neutralContent("neutral-dispose-during-boot");
    vi.spyOn(runtimeClient, "createNewSessionWithOptions").mockReturnValue(delayedCreate);
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });

    const boot = presenter.boot();
    await vi.waitFor(() => expect(runtimeClient.createNewSessionWithOptions).toHaveBeenCalledTimes(1));
    presenter.dispose();
    resolveCreate({ ...versionedSession(1, 1), gameId: content.gameId });
    await boot;

    expect(presenter.sessionSnapshot).toBeNull();
    expect(runtimeClient.subscribeSessionVersions).not.toHaveBeenCalled();
  });
});

describe("GamePresenter board action serialization", () => {
  it("preserves participants from an Agent Turn response", async () => {
    const content = neutralContent("neutral-agent-turn");
    const initialSession = { ...turnSession("p1"), gameId: content.gameId };
    const participants = [
      { seatId: "seat-local", playerId: "p1", kind: "human" as const, joinState: "local" as const },
      { seatId: "seat-agent", playerId: "p2", kind: "agent" as const, joinState: "local" as const }
    ];
    const agentTurn = vi.spyOn(runtimeClient, "runAgentTurn").mockResolvedValue({
      sessionId: initialSession.sessionId,
      participants,
      version: { ...initialSession.version, stateVersion: 2, lastEventSequence: 1 },
      state: { public: { turn: { activePlayerId: "p2" } }, secret: {} },
      actionAvailability: [],
      agentTurn: {
        schemaVersion: "1.0.0",
        turnId: "turn-test",
        agentId: "agent-test",
        ok: true,
        audit: { source: "mock", createdAt: "2026-08-13T00:00:00.000Z" }
      },
      agentControl: {
        playerId: "p2",
        status: "paused" as const,
        reasonCode: "runtimeUnavailable" as const
      }
    });
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await presenter.handleSurfaceAction({
      id: "agent-turn",
      kind: "agentTurn",
      target: "turn.advance",
      sideEffectPolicy: "system-approved"
    });

    expect(presenter.sessionSnapshot?.participants).toEqual(participants);
    expect(presenter.playerState.agentControl).toEqual({
      kind: "valid",
      value: {
        playerId: "p2",
        status: "paused",
        reasonCode: "runtimeUnavailable"
      }
    });
    agentTurn.mockRestore();
  });

  it("propagates and clears agent control across ordinary action snapshots", async () => {
    const content = neutralContent("neutral-control-clear");
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId,
      agentControl: {
        playerId: "p2",
        status: "facilitatorTakeover",
        reasonCode: "stepLimit"
      }
    };
    const nextSession: GameSession = {
      ...initialSession,
      version: { ...initialSession.version, stateVersion: 2, lastEventSequence: 1 }
    };
    delete nextSession.agentControl;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(runtimeResponse(nextSession, 2)));
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    expect(presenter.playerState.agentControl.kind).toBe("valid");
    await presenter.handleBoardAction("turn.advance");
    expect(presenter.playerState.agentControl).toEqual({ kind: "absent" });
  });

  it("fails closed when a session contains malformed agent control", () => {
    const content = neutralContent("neutral-control-invalid");
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", {
      ...turnSession("p1"),
      gameId: content.gameId,
      agentControl: {
        playerId: "p2",
        status: "facilitatorTakeover",
        reasonCode: "not-a-server-code"
      }
    });
    Reflect.set(presenter, "booting", false);

    expect(presenter.playerState.agentControl).toEqual({ kind: "invalid" });
  });

  it("sends one request per state version and unlocks after the response", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-board",
      version: "1.0.0",
      name: "Neutral board",
      description: "Neutral presenter fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p1", { p1: { metrics: {} } }),
      gameId: content.gameId
    };
    let resolveFirstResponse: (response: Response) => void = () => undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirstResponse = resolve;
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(runtimeResponse(initialSession, 3));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    // This test starts after boot so it can isolate one user gesture without
    // coupling the serialization invariant to session-creation transport.
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    const first = presenter.handleBoardAction("board.move", { target: "b" });
    const duplicate = presenter.handleBoardAction("board.move", { target: "b" });

    await expect(duplicate).rejects.toThrow("Дождитесь завершения");
    resolveFirstResponse(runtimeResponse(initialSession, 2));
    await first;
    await presenter.handleBoardAction("board.move", { target: "c" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchRequestVersions(fetchMock)).toEqual([1, 2]);
  });

  it("retries an uncertain result with the original envelope", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-retry",
      version: "1.0.0",
      name: "Neutral retry",
      description: "Neutral retry fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId
    };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(runtimeResponse(initialSession, 2));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await expect(presenter.handleBoardAction("board.move", { target: "b" })).rejects.toThrow("Failed to fetch");
    await expect(presenter.handleBoardAction("board.move", { target: "b" })).resolves.toBeUndefined();

    const bodies = fetchMock.mock.calls.map(([, request]) =>
      JSON.parse(String((request as RequestInit).body)) as Record<string, unknown>
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).not.toHaveProperty("playerId");
    expect(bodies[0]).not.toHaveProperty("payload");
    expect(bodies[0]?.commandId).toMatch(/^cli_[A-Za-z0-9_-]{22}$/u);
  });

  it("clears the outbox after a deterministic client error", async () => {
    const content = neutralContent("neutral-terminal-outcome");
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Invalid action parameters" }),
      { status: 400 }
    )));
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await expect(presenter.handleBoardAction("board.move", { target: "b" }))
      .rejects.toThrow("Invalid action parameters");

    expect(loadPendingRuntimeCommand(initialSession.sessionId)).toBeNull();
  });

  it("keeps and exactly retries the outbox after a transient HTTP response", async () => {
    const content = neutralContent("neutral-transient-outcome");
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Runtime temporarily unavailable" }), { status: 503 }))
      .mockResolvedValueOnce(runtimeResponse(initialSession, 2));
    vi.stubGlobal("fetch", fetchMock);
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await expect(presenter.handleBoardAction("board.move", { target: "b" }))
      .rejects.toThrow("Runtime temporarily unavailable");
    expect(loadPendingRuntimeCommand(initialSession.sessionId)).not.toBeNull();
    await expect(presenter.handleBoardAction("board.move", { target: "b" })).resolves.toBeUndefined();

    const bodies = fetchMock.mock.calls.map(([, request]) => String((request as RequestInit).body));
    expect(bodies[0]).toBe(bodies[1]);
    expect(loadPendingRuntimeCommand(initialSession.sessionId)).toBeNull();
  });

  it("replaces the local snapshot instead of merge-patching removed keys", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-snapshot",
      version: "1.0.0",
      name: "Neutral snapshot",
      description: "Neutral snapshot fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p1"),
      gameId: content.gameId,
      state: { public: { obsolete: true }, secret: {} }
    };
    const nextSession: GameSession = {
      ...initialSession,
      version: { ...initialSession.version, stateVersion: 2, lastEventSequence: 1 },
      state: { public: { current: true }, secret: {} }
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(runtimeResponse(nextSession, 2)));

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);

    await presenter.handleBoardAction("state.replace");

    expect(presenter.sessionSnapshot?.state).toEqual({ public: { current: true }, secret: {} });
  });
});

describe("GamePresenter road preview", () => {
  it("uses the current version without claiming an actor or changing local state", async () => {
    const content: PlayerFacingContent = {
      gameId: "neutral-road-preview",
      version: "1.0.0",
      name: "Neutral road preview",
      description: "Read-only presenter fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 2 },
      actions: [],
      mockups: []
    };
    const initialSession: GameSession = {
      ...turnSession("p2", { p1: { metrics: {} }, p2: { metrics: {} } }),
      gameId: content.gameId,
      version: {
        sessionId: "session-hotseat",
        stateVersion: 7,
        lastEventSequence: 6
      }
    };
    const previewResponse = {
      sessionId: initialSession.sessionId,
      actionId: "transport.road.build",
      usedStateVersion: 7,
      paramsFingerprint: `sha256:${"1".repeat(64)}`,
      definitionHash: `sha256:${"2".repeat(64)}`,
      networkId: "main",
      fromNodeId: "east",
      toNodeId: "west",
      polyline: [{ x: 90, y: 50 }, { x: 10, y: 50 }],
      regionSequence: ["east", "west"],
      regionSegments: 2,
      planning: {
        mode: "region-segment-minimum" as const,
        algorithmVersion: "1",
        geometryVersion: "fixture-v1",
        geometryHash: "sha256:fixture",
        boundaryPolicy: "lowest-region-id"
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(previewResponse),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", initialSession);
    Reflect.set(presenter, "booting", false);
    const sessionBefore = presenter.sessionSnapshot;

    await expect(presenter.previewTransportRoad("transport.road.build", {
      fromNodeId: "east",
      toNodeId: "west"
    })).resolves.toEqual(previewResponse);

    expect(presenter.sessionSnapshot).toBe(sessionBefore);
    expect(presenter.playerState.isPending).toBe(false);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      sessionId: "session-hotseat",
      expectedStateVersion: 7,
      actionId: "transport.road.build",
      params: {
        fromNodeId: "east",
        toNodeId: "west"
      }
    });
  });
});

describe("GamePresenter declarative layout", () => {
  it("uses the selected screen map-first layout before routing fallbacks", () => {
    const content: PlayerFacingContent = {
      gameId: "spatial-fixture",
      version: "1.0.0",
      name: "Spatial fixture",
      description: "Neutral map-first presenter fixture",
      locale: "ru",
      playerConfig: { min: 1, max: 1 },
      actions: [],
      mockups: []
    };
    const gameUi: GamePlayerUiContent = {
      id: "spatial-fixture.ui.web",
      version: "1.0.0",
      gameId: content.gameId,
      entryPoint: "workspace",
      screens: {
        workspace: {
          type: "screen",
          title: "Workspace",
          layoutMode: "map-first",
          root: {
            type: "screenComponent",
            props: {},
            children: [{
              type: "areaComponent",
              props: { workspaceSlot: "board" },
              children: []
            }]
          }
        }
      }
    };
    const presenter = new GamePresenter({
      gateway: new ReactViewGateway(),
      content,
      gameUi,
      config: createDefaultGameConfig(createDefaultGameConfigData(content))
    });
    Reflect.set(presenter, "session", {
      ...turnSession("p1"),
      gameId: content.gameId,
      state: {
        public: { timeline: { screenId: "workspace" } },
        secret: {}
      }
    } satisfies GameSession);

    expect(presenter.playerState.screenKey).toBe("workspace");
    expect(presenter.playerState.layoutMode).toBe("map-first");
  });
});

function versionedSession(stateVersion: number, lastEventSequence: number): GameSession {
  return {
    ...turnSession("p1"),
    version: {
      sessionId: "session-hotseat",
      stateVersion,
      lastEventSequence
    }
  };
}

async function bootPresenterWithSession(initial: GameSession, refreshed = initial) {
  const content = neutralContent(initial.gameId);
  const gateway = new ReactViewGateway();
  vi.spyOn(runtimeClient, "createNewSessionWithOptions").mockResolvedValue(initial);
  const resume = vi.spyOn(runtimeClient, "resumeSession").mockResolvedValue(refreshed);
  const presenter = new GamePresenter({
    gateway,
    content,
    config: createDefaultGameConfig(createDefaultGameConfigData(content))
  });
  await presenter.boot();
  resume.mockClear();
  return { presenter, resume, gateway };
}

function runtimeResponse(session: GameSession, stateVersion: number): Response {
  return new Response(JSON.stringify({
    ...session,
    version: {
      ...session.version,
      stateVersion,
      lastEventSequence: stateVersion
    }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function neutralContent(gameId: string): PlayerFacingContent {
  return {
    gameId,
    version: "1.0.0",
    name: "Neutral fixture",
    description: "Presenter transport fixture",
    locale: "ru",
    playerConfig: { min: 1, max: 1 },
    actions: [],
    mockups: []
  };
}

function agentSeatContent(gameId: string, participantCount: number): PlayerFacingContent {
  return {
    ...neutralContent(gameId),
    playerConfig: {
      min: participantCount,
      max: participantCount,
      agentSeats: {
        max: 4,
        invalidAttemptLimit: 1,
        deterministicFallbackCandidates: [{ actionId: "turn.advance", params: {} }]
      }
    }
  };
}

function fetchRequestVersions(fetchMock: ReturnType<typeof vi.fn>): number[] {
  return fetchMock.mock.calls.map(([, request]) => {
    const body = JSON.parse(String((request as RequestInit | undefined)?.body ?? "{}")) as {
      expectedStateVersion?: unknown;
    };
    return Number(body.expectedStateVersion);
  });
}
