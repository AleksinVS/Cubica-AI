import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";

type RuntimeState = {
  runtime?: Record<string, unknown>;
};

type ActionResponse = {
  state?: RuntimeState;
};

const assert = (condition: unknown, message: string) => {
  if (!condition) {
    throw new Error(message);
  }
};

const main = async () => {
  const runtimeApi = createRuntimeApiServer({ port: 0 });
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
        actionId: "showHint",
        payload: { source: "smoke" }
      })
    });

    assert(actionResponse.status === 200, `Expected 200 from POST /actions, got ${actionResponse.status}`);
    const actionBody = (await actionResponse.json()) as ActionResponse;
    assert(actionBody.state && typeof actionBody.state === "object", "POST /actions did not return state");

    const runtime = actionBody.state?.runtime;
    assert(runtime?.lastActionId === "showHint", "Deterministic runtime state was not updated");

    // eslint-disable-next-line no-console
    console.log(`runtime-api smoke passed on ${baseUrl}`);
  } finally {
    await new Promise<void>((resolve) => runtimeApi.server.close(() => resolve()));
  }
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("runtime-api smoke failed", error);
  process.exitCode = 1;
});
