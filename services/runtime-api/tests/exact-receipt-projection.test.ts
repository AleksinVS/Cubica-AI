/** Exact-retry regression for the actor identity used by public projection. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { GameManifest } from "@cubica/contracts-manifest";

import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../src/modules/runtime/actionDispatcher.ts";
import { BoundedInMemoryCommandAdmissionController } from "../src/modules/runtime/commandAdmission.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";

test("an exact retry keeps its receipt actor but projects the current viewer actor", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as GameManifest;
  const gameId = manifest.meta.id;
  const immutableBundle = createImmutableBundleContent(gameId, manifest as unknown as Record<string, unknown>);
  const access = createLocalSessionAccess("player");
  const store = new InMemorySessionStore<Record<string, unknown>>();
  // The generated manifest state is structurally JSON, while the generic
  // session test intentionally treats its top-level keys as opaque.
  const initialState = structuredClone(manifest.state) as unknown as Record<string, unknown>;
  const publicState = initialState.public as Record<string, unknown>;
  publicState.turn = { activePlayerId: "p1" };
  initialState.players = {
    p1: { privateValue: "only-p1" },
    p2: { privateValue: "only-p2" }
  };

  try {
    const created = await store.createSession({
      gameId,
      initialState,
      sessionRole: "player",
      immutableBundle,
      principal: access.principal
    });
    const input = {
      sessionId: created.session.sessionId,
      actionId: "choice.accept",
      commandId: `cli_${"R".repeat(22)}`,
      expectedStateVersion: 0,
      params: {}
    };
    const admissionController = new BoundedInMemoryCommandAdmissionController();
    const first = await dispatchRuntimeAction({
      sessionStore: store,
      credentialSha256: access.principal.credentialSha256,
      input,
      admissionController
    });
    assert.equal(first.actorPlayerId, "p1");

    let protectedReceipt: unknown;
    await store.withCommandTransaction({
      sessionId: created.session.sessionId,
      credentialSha256: access.principal.credentialSha256,
      commandId: input.commandId
    }, async ({ existingReceipt }) => {
      protectedReceipt = existingReceipt;
      return { result: undefined };
    });
    const storedReceipt = protectedReceipt as {
      actorId?: string;
      result?: unknown;
      audit?: {
        mechanics?: {
          formatVersion?: string;
          steps?: Array<{ stepId?: string; operation?: string }>;
          cost?: { steps?: number; writes?: number; auditBytes?: number };
        };
      };
    };
    const protectedResult = storedReceipt.result;
    assert.equal(storedReceipt.actorId, "p1", "audit identity must remain the pre-action command actor");
    assert.deepEqual(protectedResult, {
      formatVersion: "1.0.0",
      kind: "game-intent",
      value: { ok: true }
    });
    assert.equal(JSON.stringify(protectedResult).includes("candidateState"), false);
    assert.equal(JSON.stringify(protectedResult).includes('"secret"'), false);
    assert.equal(storedReceipt.audit?.mechanics?.formatVersion, "1.0.0");
    assert.equal(storedReceipt.audit?.mechanics?.steps?.[0]?.stepId, "s001-precondition");
    assert.equal(storedReceipt.audit?.mechanics?.steps?.[0]?.operation, "core.assert");
    assert.equal(storedReceipt.audit?.mechanics?.cost?.steps, storedReceipt.audit?.mechanics?.steps?.length);
    assert.ok((storedReceipt.audit?.mechanics?.cost?.writes ?? 0) > 0);
    assert.ok((storedReceipt.audit?.mechanics?.cost?.auditBytes ?? 0) > 0);
    assert.equal("mechanics" in first.receipt, false, "public receipt must not expose the protected trace");

    const afterFirst = await store.getSession(created.session.sessionId);
    assert.ok(afterFirst);
    const nextState = structuredClone(afterFirst.state);
    ((nextState.public as Record<string, unknown>).turn as Record<string, unknown>).activePlayerId = "p2";
    await store.updateSession({
      ...afterFirst,
      state: nextState,
      version: {
        ...afterFirst.version,
        stateVersion: afterFirst.version.stateVersion + 1
      },
      updatedAt: new Date()
    }, { expectedStateVersion: afterFirst.version.stateVersion });

    // The stale version is intentionally retained: receipt lookup still comes
    // first, but the response is a fresh projection of the current snapshot.
    const retry = await dispatchRuntimeAction({
      sessionStore: store,
      credentialSha256: access.principal.credentialSha256,
      input,
      admissionController
    });
    assert.equal(retry.snapshot.version.stateVersion, afterFirst.version.stateVersion + 1);
    assert.equal(retry.actorPlayerId, "p2");
    assert.equal(
      ((retry.snapshot.state.public as Record<string, unknown>).turn as Record<string, unknown>).activePlayerId,
      "p2"
    );
    assert.deepEqual(retry.receipt, first.receipt);
  } finally {
    await store.close();
  }
});
