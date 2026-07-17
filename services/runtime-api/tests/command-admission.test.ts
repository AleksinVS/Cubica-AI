/** Regression coverage for bounded, idempotency-aware command admission. */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BoundedInMemoryCommandAdmissionController,
  COMMAND_ADMISSION_CODES,
  CommandAdmissionRejectedError,
  type CommandAdmissionPolicy
} from "../src/modules/runtime/commandAdmission.ts";
import { createRuntimeApiServer } from "../src/modules/player-api/httpServer.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";

const policy = (overrides: Partial<CommandAdmissionPolicy> = {}): CommandAdmissionPolicy => ({
  commandRate: { limit: 4, windowMs: 60_000 },
  agentTurnRate: { limit: 4, windowMs: 60_000 },
  agentTurnCost: { limit: 1, windowMs: 60_000 },
  maxSubjects: 10,
  ...overrides
});

test("a rejected AI cost charge does not consume the general command budget", async () => {
  const controller = new BoundedInMemoryCommandAdmissionController({ policy: policy(), now: () => 0 });
  const identity = {
    sessionId: "session-a",
    principalId: "principal-a"
  };

  await controller.assertNewCommandAdmitted({
    ...identity,
    commandId: "command-ai-1",
    kind: "agent-turn",
    costUnits: 1
  });
  await assert.rejects(
    controller.assertNewCommandAdmitted({
      ...identity,
      commandId: "command-ai-2",
      kind: "agent-turn",
      costUnits: 1
    }),
    (error: unknown) => {
      assert.ok(error instanceof CommandAdmissionRejectedError);
      assert.equal(error.code, COMMAND_ADMISSION_CODES.agentTurnCost);
      assert.equal(error.retryAfterSeconds, 60);
      return true;
    }
  );

  // Only the successful AI turn consumed the common budget. Three ordinary
  // commands still fit in the four-command window.
  for (let index = 0; index < 3; index += 1) {
    await controller.assertNewCommandAdmitted({
      ...identity,
      commandId: `command-game-${index}`,
      kind: "game-intent"
    });
  }
  await assert.rejects(
    controller.assertNewCommandAdmitted({
      ...identity,
      commandId: "command-game-over-limit",
      kind: "game-intent"
    }),
    (error: unknown) => {
      assert.ok(error instanceof CommandAdmissionRejectedError);
      assert.equal(error.code, COMMAND_ADMISSION_CODES.commandRate);
      return true;
    }
  );
});

test("bounded storage evicts expired subjects and never evicts an active limiter", async () => {
  let nowMs = 0;
  const controller = new BoundedInMemoryCommandAdmissionController({
    policy: policy({
      commandRate: { limit: 1, windowMs: 10_000 },
      agentTurnRate: { limit: 1, windowMs: 10_000 },
      agentTurnCost: { limit: 1, windowMs: 10_000 },
      maxSubjects: 1
    }),
    now: () => nowMs
  });

  await controller.assertNewCommandAdmitted({
    sessionId: "session-a",
    principalId: "principal-a",
    commandId: "command-a",
    kind: "game-intent"
  });
  await assert.rejects(
    controller.assertNewCommandAdmitted({
      sessionId: "session-b",
      principalId: "principal-b",
      commandId: "command-b",
      kind: "game-intent"
    }),
    (error: unknown) => {
      assert.ok(error instanceof CommandAdmissionRejectedError);
      assert.equal(error.code, COMMAND_ADMISSION_CODES.capacity);
      assert.equal(error.retryAfterSeconds, 10);
      return true;
    }
  );
  assert.equal(controller.activeSubjectCount(), 1);

  nowMs = 10_000;
  await controller.assertNewCommandAdmitted({
    sessionId: "session-b",
    principalId: "principal-b",
    commandId: "command-b",
    kind: "game-intent"
  });
  assert.equal(controller.activeSubjectCount(), 1);
});

test("HTTP admission returns 429 with Retry-After, while an exact receipt retry bypasses charging", async () => {
  const admission = new BoundedInMemoryCommandAdmissionController({
    policy: policy({ commandRate: { limit: 1, windowMs: 60_000 } }),
    now: () => 0
  });
  const api = createRuntimeApiServer({
    port: 0,
    sessionStore: new InMemorySessionStore<Record<string, unknown>>(),
    commandAdmissionController: admission
  });
  await api.start();
  const baseUrl = `http://127.0.0.1:${api.port}`;

  try {
    const createResponse = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId: "simple-choice" })
    });
    assert.equal(createResponse.status, 201);
    const session = await createResponse.json() as {
      sessionId: string;
      credential: string;
      version: { stateVersion: number };
    };
    const firstCommand = {
      sessionId: session.sessionId,
      actionId: "choice.accept",
      commandId: `cli_${"A".repeat(22)}`,
      expectedStateVersion: session.version.stateVersion,
      params: {}
    };
    const postAction = (body: Record<string, unknown>) => fetch(`${baseUrl}/actions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.credential}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const accepted = await postAction(firstCommand);
    assert.equal(accepted.status, 200);
    const acceptedBody = await accepted.json() as {
      version: { stateVersion: number };
    };

    // A transport retry is resolved from the durable receipt before the
    // controller, despite carrying the now-stale original state version.
    const retry = await postAction(firstCommand);
    assert.equal(retry.status, 200);

    const limited = await postAction({
      ...firstCommand,
      commandId: `cli_${"B".repeat(22)}`,
      // Admission is intentionally checked only after optimistic concurrency.
      // Use the committed version so this request reaches the rate limiter
      // instead of correctly failing earlier as a stale write.
      expectedStateVersion: acceptedBody.version.stateVersion
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Retry-After"), "60");
    const body = await limited.json() as { code?: string };
    assert.equal(body.code, COMMAND_ADMISSION_CODES.commandRate);
  } finally {
    await api.close();
  }
});
