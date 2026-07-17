/** Authenticated principal roles, never session defaults, authorize commands. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { GameManifest } from "@cubica/contracts-manifest";
import type { CommandAdmissionController } from "../src/modules/runtime/commandAdmission.ts";

import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../src/modules/runtime/actionDispatcher.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";

class TrackingAdmissionController implements CommandAdmissionController {
  calls = 0;

  async assertNewCommandAdmitted(): Promise<void> {
    this.calls += 1;
  }
}

const loadManifest = async (): Promise<GameManifest> => JSON.parse(await readFile(
  new URL("../../../games/cards-money-trains-mock/game.manifest.json", import.meta.url),
  "utf8"
)) as GameManifest;

test("command authorization follows the authenticated principal role in both mismatch directions", async () => {
  const manifest = await loadManifest();
  const immutableBundle = createImmutableBundleContent(
    manifest.meta.id,
    manifest as unknown as Record<string, unknown>
  );

  const deniedAccess = createLocalSessionAccess("player");
  const deniedStore = new InMemorySessionStore<Record<string, unknown>>();
  const deniedAdmission = new TrackingAdmissionController();
  const denied = await deniedStore.createSession({
    gameId: manifest.meta.id,
    // Deliberately opposite to the authenticated principal. This retained
    // session metadata must never elevate the caller to facilitator authority.
    sessionRole: "facilitator",
    initialState: structuredClone(manifest.state) as unknown as Record<string, unknown>,
    immutableBundle,
    principal: deniedAccess.principal
  });

  try {
    await assert.rejects(
      dispatchRuntimeAction({
        sessionStore: deniedStore,
        credentialSha256: deniedAccess.principal.credentialSha256,
        admissionController: deniedAdmission,
        input: {
          sessionId: denied.session.sessionId,
          expectedStateVersion: 0,
          actionId: "mock.setup.start",
          commandId: `cli_${"D".repeat(22)}`,
          params: {}
        }
      }),
      /not available to this session role/u
    );
    assert.equal(deniedAdmission.calls, 0, "role rejection must happen before rate/cost admission");
  } finally {
    await deniedStore.close();
  }

  const allowedAccess = createLocalSessionAccess("facilitator");
  const allowedStore = new InMemorySessionStore<Record<string, unknown>>();
  const allowedAdmission = new TrackingAdmissionController();
  const allowed = await allowedStore.createSession({
    gameId: manifest.meta.id,
    // The inverse mismatch proves the old session-wide default can no longer
    // suppress authority that belongs to the authenticated facilitator.
    sessionRole: "player",
    initialState: structuredClone(manifest.state) as unknown as Record<string, unknown>,
    immutableBundle,
    principal: allowedAccess.principal
  });

  try {
    const outcome = await dispatchRuntimeAction({
      sessionStore: allowedStore,
      credentialSha256: allowedAccess.principal.credentialSha256,
      admissionController: allowedAdmission,
      input: {
        sessionId: allowed.session.sessionId,
        expectedStateVersion: 0,
        actionId: "mock.setup.start",
        commandId: `cli_${"A".repeat(22)}`,
        params: {}
      }
    });
    assert.equal(outcome.receipt.status, "applied");
    assert.equal(outcome.sessionRole, "facilitator");
    assert.equal(allowedAdmission.calls, 1);
  } finally {
    await allowedStore.close();
  }
});
