import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

type RuntimeState = {
  runtime?: Record<string, unknown>;
  public?: Record<string, unknown>;
};

type ActionResponse = {
  state?: RuntimeState;
};

type SessionResponse = {
  state?: RuntimeState;
};

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const runtimeApi = createRuntimeApiServer({
    port: 0,
    sessionStore: new InMemorySessionStore<Record<string, unknown>>()
  });
  await runtimeApi.start();

  try {
    const baseUrl = `http://127.0.0.1:${runtimeApi.port}`;

    // Smoke 3a: Add health check before session creation
    const healthResponse = await fetch(`${baseUrl}/health`);
    assert(healthResponse.status === 200, `Expected 200 from GET /health, got ${healthResponse.status}`);
    const healthBody = (await healthResponse.json()) as { status?: string };
    assert(healthBody.status === "ok", `Expected status "ok" from GET /health, got "${healthBody.status}"`);

    // Smoke 3b: Add readiness check after health check
    const readinessResponse = await fetch(`${baseUrl}/readiness`);
    assert(readinessResponse.status === 200, `Expected 200 from GET /readiness, got ${readinessResponse.status}`);
    const readinessBody = (await readinessResponse.json()) as {
      ready?: boolean;
      dependencies?: {
        sessionStore?: { mode?: string };
      };
    };
    assert(readinessBody.ready === true, `Expected ready=true from GET /readiness, got "${readinessBody.ready}"`);

    // Smoke 3c: Verify session store mode in readiness response
    assert(
      readinessBody.dependencies?.sessionStore?.mode === "in-memory",
      `Expected sessionStore.mode "in-memory" from GET /readiness, got "${readinessBody.dependencies?.sessionStore?.mode}"`
    );

    // Continue with session/action path
    const sessionResponse = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ gameId: "antarctica", playerId: "smoke" })
    });

    assert(sessionResponse.status === 201, `Expected 201 from POST /sessions, got ${sessionResponse.status}`);
    const sessionBody = (await sessionResponse.json()) as { sessionId?: string };
    assert(typeof sessionBody.sessionId === "string", "POST /sessions did not return sessionId");

    const actionResponse = await fetch(`${baseUrl}/actions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId: sessionBody.sessionId,
        actionId: "opening.info.i0.advance",
        payload: { source: "smoke" }
      })
    });

    assert(actionResponse.status === 200, `Expected 200 from POST /actions, got ${actionResponse.status}`);
    const actionBody = (await actionResponse.json()) as ActionResponse;
    assert(actionBody.state && typeof actionBody.state === "object", "POST /actions did not return state");

    const runtime = actionBody.state?.runtime;
    assert(
      runtime?.lastActionId === "opening.info.i0.advance",
      "Deterministic runtime state did not record the manifest action"
    );

    const timeline = actionBody.state?.public?.timeline as { stepIndex?: number } | undefined;
    assert(timeline?.stepIndex === 1, "Manifest action did not advance the public timeline to step 1");

    // Read the session back so the smoke proves the transition was persisted,
    // not merely returned optimistically by the action endpoint.
    const persistedResponse = await fetch(`${baseUrl}/sessions/${sessionBody.sessionId}`);
    assert(persistedResponse.status === 200, `Expected 200 from GET /sessions/:id, got ${persistedResponse.status}`);
    const persistedBody = (await persistedResponse.json()) as SessionResponse;
    const persistedRuntime = persistedBody.state?.runtime;
    const persistedTimeline = persistedBody.state?.public?.timeline as { stepIndex?: number } | undefined;
    assert(
      persistedRuntime?.lastActionId === "opening.info.i0.advance",
      "Persisted session did not retain the manifest action"
    );
    assert(persistedTimeline?.stepIndex === 1, "Persisted session did not retain the timeline transition");

    // eslint-disable-next-line no-console
    console.log(`runtime-api smoke passed on ${baseUrl}`);
  } finally {
    await runtimeApi.close();
  }
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("runtime-api smoke failed", error);
  process.exitCode = 1;
});
