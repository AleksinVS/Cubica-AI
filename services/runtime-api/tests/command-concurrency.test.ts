/** True same-session races for command locking, retries and stale versions. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import type { CubicaMechanicsIRV1Alpha1, GameManifest } from "@cubica/contracts-manifest";

import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import { dispatchRuntimeAction } from "../src/modules/runtime/actionDispatcher.ts";
import type { CommandAdmissionRequest } from "../src/modules/runtime/commandAdmission.ts";
import { InMemorySessionStore } from "../src/modules/session/inMemorySessionStore.ts";
import { createLocalSessionAccess } from "../src/modules/session/sessionAuthentication.ts";
import {
  SessionVersionConflictError,
  SessionWriteLockedError
} from "../src/modules/session/sessionStoreErrors.ts";

type RuntimeState = Record<string, unknown>;
type DispatchOutcome = Awaited<ReturnType<typeof dispatchRuntimeAction>>;
type Reflected<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

const require = createRequire(import.meta.url);
const { recommendedModuleLock } = require("../../../scripts/manifest-tools/mechanics-modules.cjs") as {
  recommendedModuleLock: (moduleIds: Array<string>) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { mechanicsSha256 } = require("../../../scripts/manifest-tools/mechanics-canonicalize.cjs") as {
  mechanicsSha256: (value: unknown) => string;
};

test("two concurrent deliveries with one command id commit once and retry by receipt", async () => {
  const fixture = await createFixture();
  try {
    const commandId = `cli_${"I".repeat(22)}`;
    const input = {
      sessionId: fixture.sessionId,
      actionId: "choice.accept",
      commandId,
      expectedStateVersion: 0,
      params: {}
    };
    const [winner, lockedDelivery] = await dispatchPair(fixture, input, input);

    assert.equal(winner.status, "fulfilled");
    assert.equal(lockedDelivery.status, "rejected");
    if (winner.status !== "fulfilled" || lockedDelivery.status !== "rejected") return;
    assert.ok(lockedDelivery.reason instanceof SessionWriteLockedError);
    assert.equal(winner.value.committedState, true);

    const retry = await dispatchRuntimeAction({
      sessionStore: fixture.store,
      credentialSha256: fixture.credentialSha256,
      input,
      admissionController: fixture.admission
    });
    assert.equal(retry.committedState, false);
    assert.deepEqual(retry.receipt, winner.value.receipt);
    await assertSingleCommit(fixture);
  } finally {
    await fixture.store.close();
  }
});

test("two concurrent command ids with one expected version cannot partially apply the loser", async () => {
  const fixture = await createFixture();
  try {
    const firstInput = {
      sessionId: fixture.sessionId,
      actionId: "choice.accept",
      commandId: `cli_${"V".repeat(22)}`,
      expectedStateVersion: 0,
      params: {}
    };
    const staleInput = {
      ...firstInput,
      commandId: `cli_${"S".repeat(22)}`
    };
    const [winner, lockedDelivery] = await dispatchPair(fixture, firstInput, staleInput);

    assert.equal(winner.status, "fulfilled");
    assert.equal(lockedDelivery.status, "rejected");
    if (lockedDelivery.status !== "rejected") return;
    assert.ok(lockedDelivery.reason instanceof SessionWriteLockedError);

    // Once the winning transaction releases the lock, the losing logical
    // command is still new and therefore must fail its stale version gate.
    await assert.rejects(
      dispatchRuntimeAction({
        sessionStore: fixture.store,
        credentialSha256: fixture.credentialSha256,
        input: staleInput,
        admissionController: fixture.admission
      }),
      SessionVersionConflictError
    );
    await assertSingleCommit(fixture);
  } finally {
    await fixture.store.close();
  }
});

interface Fixture {
  store: InMemorySessionStore<RuntimeState>;
  sessionId: string;
  credentialSha256: string;
  admission: GatedAdmissionController;
}

async function createFixture(): Promise<Fixture> {
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as GameManifest;
  manifest.mechanics.moduleLock = recommendedModuleLock(Object.keys(manifest.mechanics.moduleLock));
  republishFixtureHashes(manifest);
  const access = createLocalSessionAccess("player");
  const store = new InMemorySessionStore<RuntimeState>();
  const created = await store.createSession({
    gameId: manifest.meta.id,
    initialState: structuredClone(manifest.state) as unknown as RuntimeState,
    sessionRole: "player",
    immutableBundle: createImmutableBundleContent(
      manifest.meta.id,
      manifest as unknown as Record<string, unknown>
    ),
    principal: access.principal
  });
  return {
    store,
    sessionId: created.session.sessionId,
    credentialSha256: access.principal.credentialSha256,
    admission: new GatedAdmissionController()
  };
}

async function dispatchPair(
  fixture: Fixture,
  firstInput: Parameters<typeof dispatchRuntimeAction>[0]["input"],
  secondInput: Parameters<typeof dispatchRuntimeAction>[0]["input"]
): Promise<[Reflected<DispatchOutcome>, Reflected<DispatchOutcome>]> {
  const first = reflect(dispatchRuntimeAction({
    sessionStore: fixture.store,
    credentialSha256: fixture.credentialSha256,
    input: firstInput,
    admissionController: fixture.admission
  }));
  await fixture.admission.entered;

  const second = reflect(dispatchRuntimeAction({
    sessionStore: fixture.store,
    credentialSha256: fixture.credentialSha256,
    input: secondInput,
    admissionController: fixture.admission
  }));
  fixture.admission.release();

  // Both real dispatch promises are pending together: the gate keeps the
  // first transaction open until the second has attempted the same lock.
  return Promise.all([first, second]);
}

async function reflect<T>(promise: Promise<T>): Promise<Reflected<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

async function assertSingleCommit(fixture: Fixture): Promise<void> {
  const snapshot = await fixture.store.getSession(fixture.sessionId);
  assert.equal(snapshot?.version.stateVersion, 1);
  assert.equal(snapshot?.version.lastEventSequence, 1);
  assert.equal((await fixture.store.getSessionEvents(fixture.sessionId)).length, 1);
  assert.equal(fixture.admission.calls, 1, "retries and rejected contenders must not consume admission");
}

class GatedAdmissionController {
  calls = 0;
  readonly entered: Promise<void>;
  private markEntered!: () => void;
  private readonly gate: Promise<void>;
  private openGate!: () => void;

  constructor() {
    this.entered = new Promise((resolve) => { this.markEntered = resolve; });
    this.gate = new Promise((resolve) => { this.openGate = resolve; });
  }

  async assertNewCommandAdmitted(_request: CommandAdmissionRequest): Promise<void> {
    this.calls += 1;
    this.markEntered();
    await this.gate;
  }

  release(): void {
    this.openGate();
  }
}

function republishFixtureHashes(manifest: GameManifest): void {
  const networkModelsHash = mechanicsSha256(manifest.networkModels ?? {});
  for (const [planId, plan] of Object.entries(manifest.mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      budgetProfile: manifest.mechanics.budgetProfile,
      moduleLock: manifest.mechanics.moduleLock,
      stateModel: manifest.mechanics.stateModel,
      objectModels: manifest.objectModels ?? {},
      networkModelsHash,
      planId,
      transaction: plan.transaction
    });
  }
  for (const [actionId, action] of Object.entries(manifest.actions)) {
    const { definitionHash: _oldHash, ...definition } = action;
    action.definitionHash = mechanicsSha256({
      apiVersion: manifest.mechanics.apiVersion,
      actionId,
      definition,
      planHash: manifest.mechanics.plans[action.binding.planRef]!.planHash
    });
  }
}
