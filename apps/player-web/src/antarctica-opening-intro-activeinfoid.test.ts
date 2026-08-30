/**
 * Regression test for the "stuck after the first Antarctica info screen" bug
 * (TSK-20260719-antarctica-remediation, block R0).
 *
 * Root cause: `games/antarctica/authoring/game.authoring.json` gained two new
 * loss-line info entries, `i34` (stepIndex 0, screenId "S1") and `i34_2`
 * (stepIndex 1, screenId "S1"), which happen to reuse the exact same
 * (stepIndex, screenId) pair as the main-line intro entries `i0` (stepIndex 0)
 * and `i02` (stepIndex 1). The Antarctica player plugin's
 * `resolveCurrentInfoEntry` (games/antarctica/plugins/antarctica-player/src/
 * state-resolvers.ts) disambiguates such collisions using
 * `state.public.timeline.activeInfoId`, matching an info entry only when its
 * `id` also matches. The compiled mechanics plan for `opening.info.i0.advance`
 * patched `stepIndex`/`screenId` on advance but never patched `activeInfoId`,
 * so after the very first "continue" click the client was left with
 * `stepIndex=1, screenId="S1", activeInfoId="i0"` (stale) — an ambiguous state
 * matching both `i02` and `i34_2` — which made the resolver return `null` and
 * the "continue" button silently stop working (its manifest-declared
 * `advanceActionId` template resolved to nothing, so the platform-generic
 * `createManifestActionAdapter` in src/lib/manifest-action-adapter.ts refused
 * to dispatch, matching the reported hang exactly).
 *
 * The fix is a game-data (authoring) change: `opening.info.i0.advance`'s plan
 * now also patches `public.timeline.activeInfoId` to `"i02"`, the same
 * disambiguation convention already used elsewhere in this manifest (see
 * `opening.info.i20.advance`, `opening.info.i34.advance`,
 * `opening.info.i34_2.advance`). This test reads the *compiled* manifest
 * (not a hand-written fixture) so it fails again if the authoring source or
 * the compiler output ever regresses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type PatchOp = {
  operation: string;
  target: { endpoint: string };
  value: { op: string; value: unknown };
};

type PlanStep = {
  kind: string;
  op: string;
  patches?: PatchOp[];
  /** Step-level conditional guard (e.g. a `predicate.compare` on preAction state). */
  when?: unknown;
};

type InfoEntry = {
  id: string;
  stepIndex: number;
  screenId: string;
};

const readRelativeToThisFile = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const manifest = JSON.parse(
  readRelativeToThisFile("../../../games/antarctica/game.manifest.json")
) as {
  content: { data: { infos: InfoEntry[] } };
  mechanics: { plans: Record<string, { transaction: { steps: PlanStep[] } }> };
  state: { public: { timeline: { stepIndex: number; screenId: string; activeInfoId: string } } };
};

const infos = manifest.content.data.infos;

/** Reads the literal string value a plan sets for one `public.timeline.*` endpoint, if any. */
function literalPatchValue(steps: PlanStep[], endpoint: string): unknown {
  for (const step of steps) {
    for (const patch of step.patches ?? []) {
      if (patch.target.endpoint === endpoint && patch.value.op === "value.literal") {
        return patch.value.value;
      }
    }
  }
  return undefined;
}

describe("antarctica opening intro: info-screen disambiguation after advance", () => {
  it("documents the real collision that broke the intro: i0/i34 and i02/i34_2 share (stepIndex, screenId)", () => {
    const atStep0OnS1 = infos.filter((entry) => entry.stepIndex === 0 && entry.screenId === "S1");
    const atStep1OnS1 = infos.filter((entry) => entry.stepIndex === 1 && entry.screenId === "S1");

    expect(atStep0OnS1.map((entry) => entry.id).sort()).toEqual(["i0", "i34"]);
    expect(atStep1OnS1.map((entry) => entry.id).sort()).toEqual(["i02", "i34_2"]);
  });

  it("makes opening.info.i0.advance patch activeInfoId to the unique main-line target (i02)", () => {
    const plan = manifest.mechanics.plans["opening.info.i0.advance"];
    expect(plan, 'compiled plan "opening.info.i0.advance" must exist').toBeDefined();

    const steps = plan.transaction.steps;
    const targetStepIndex = literalPatchValue(steps, "public.timeline.stepIndex");
    const targetScreenId = literalPatchValue(steps, "public.timeline.screenId");
    const targetActiveInfoId = literalPatchValue(steps, "public.timeline.activeInfoId");

    // Sanity check the fixture assumption above still holds for the endpoint
    // this plan actually writes to.
    expect(targetStepIndex).toBe(1);
    expect(targetScreenId).toBe("S1");

    const candidates = infos.filter(
      (entry) => entry.stepIndex === targetStepIndex && entry.screenId === targetScreenId
    );
    // The whole point of this test: more than one info entry shares the
    // landing (stepIndex, screenId), so the plan MUST disambiguate explicitly.
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.map((entry) => entry.id)).toContain(targetActiveInfoId);
    expect(targetActiveInfoId).toBe("i02");
  });

  it("starts a fresh session with activeInfoId already resolving the (stepIndex 0, S1) collision", () => {
    // The very first screen is never reached through a mechanics plan — it is
    // the session's initial `state.public.timeline`. If this ever regresses
    // to omit activeInfoId, a brand-new session would hang on info screen 1
    // exactly like the original bug, before any action is even dispatched.
    const initialTimeline = manifest.state.public.timeline;
    expect(initialTimeline.stepIndex).toBe(0);
    expect(initialTimeline.screenId).toBe("S1");
    expect(initialTimeline.activeInfoId).toBe("i0");
  });
});

/**
 * TSK-20260719-antarctica-remediation, block R7: generic (stepIndex,
 * screenId) collision audit across the whole compiled manifest — not just the
 * i0/i34 pair R0 already fixed. R0 flagged `i19`/`i19_1` (stepIndex 35,
 * screenId "S1") as an unverified, structurally identical risk; this section
 * checks that pair (and any other collision that may appear later) the same
 * way R0 checked i0/i34, and turns the one-off audit into a standing
 * regression guard.
 *
 * A plan can reach a given (stepIndex, screenId) through conditional
 * (`step.when`-guarded) patch steps — see `opening.card.68.advance`, which
 * sets `activeInfoId` to "i19" unconditionally and then conditionally
 * overrides it to "i19_1" when `public.metrics.time < 54`. The branch
 * enumeration below is conservative: it explores both the "when true" and
 * "when false" outcome of every conditional step independently, without
 * proving the underlying predicates are jointly satisfiable. That makes a
 * clean run (zero problems) a sound guarantee — every actually-reachable
 * branch is a subset of the enumerated ones — while a flagged problem still
 * needs a human to check the predicate is reachable before treating it as a
 * real regression.
 */
describe("antarctica opening intro: generic (stepIndex, screenId) collision audit", () => {
  const ENDPOINT_SUFFIXES = ["timeline.stepIndex", "timeline.screenId", "timeline.activeInfoId"] as const;
  type World = Partial<Record<(typeof ENDPOINT_SUFFIXES)[number], unknown>>;

  const literalOrTag = (value: { op: string; value: unknown }): unknown =>
    value.op === "value.literal" ? value.value : `<non-literal:${value.op}>`;

  /** Enumerates every reachable final (stepIndex, screenId, activeInfoId) world for a plan. */
  function enumerateFinalWorlds(steps: PlanStep[]): Array<World> {
    let worlds: Array<World> = [{}];
    for (const step of steps) {
      if (step.op !== "core.state.patch") continue;
      const relevant = (step.patches ?? []).filter((patch) =>
        ENDPOINT_SUFFIXES.some((suffix) => patch.target.endpoint.endsWith(suffix))
      );
      if (relevant.length === 0) continue;

      const applyPatches = (world: World): World => {
        const next = { ...world };
        for (const patch of relevant) {
          const suffix = ENDPOINT_SUFFIXES.find((candidate) => patch.target.endpoint.endsWith(candidate));
          if (suffix) {
            next[suffix] = literalOrTag(patch.value);
          }
        }
        return next;
      };

      if (step.when) {
        worlds = [...worlds.map(applyPatches), ...worlds.map((world) => ({ ...world }))];
      } else {
        worlds = worlds.map(applyPatches);
      }
      expect(worlds.length, `branch explosion in a plan — needs manual review`).toBeLessThanOrEqual(64);
    }
    return worlds;
  }

  const byPair = new Map<string, Array<string>>();
  for (const entry of infos) {
    const key = `${entry.stepIndex}::${entry.screenId}`;
    byPair.set(key, [...(byPair.get(key) ?? []), entry.id]);
  }
  const collisionPairs = [...byPair.entries()].filter(([, ids]) => ids.length > 1);

  it("has exactly the known, already-resolved collision pairs (update this list if content changes)", () => {
    expect(collisionPairs.map(([key]) => key).sort()).toEqual(["0::S1", "1::S1", "35::S1"]);
  });

  it("resolves every reachable landing on a collision pair to a valid activeInfoId, for every plan", () => {
    const problems: Array<{ planId: string; key: string; activeInfoVal: unknown }> = [];

    for (const [planId, plan] of Object.entries(manifest.mechanics.plans)) {
      const worlds = enumerateFinalWorlds(plan.transaction.steps);
      for (const world of worlds) {
        const stepVal = world["timeline.stepIndex"];
        const screenVal = world["timeline.screenId"];
        if (typeof stepVal !== "number" || typeof screenVal !== "string") continue;

        const key = `${stepVal}::${screenVal}`;
        const candidates = byPair.get(key);
        if (!candidates || candidates.length <= 1) continue;

        const activeInfoVal = world["timeline.activeInfoId"];
        const ok = typeof activeInfoVal === "string" && candidates.includes(activeInfoVal);
        if (!ok) {
          problems.push({ planId, key, activeInfoVal });
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("specifically resolves the i19/i19_1 collision (stepIndex 35, screenId S1) via opening.card.68.advance", () => {
    const candidates = infos.filter((entry) => entry.stepIndex === 35 && entry.screenId === "S1");
    expect(candidates.map((entry) => entry.id).sort()).toEqual(["i19", "i19_1"]);

    const plan = manifest.mechanics.plans["opening.card.68.advance"];
    expect(plan, 'compiled plan "opening.card.68.advance" must exist').toBeDefined();

    const worlds = enumerateFinalWorlds(plan.transaction.steps);
    const landingActiveInfoIds = worlds
      .filter((world) => world["timeline.stepIndex"] === 35 && world["timeline.screenId"] === "S1")
      .map((world) => world["timeline.activeInfoId"]);

    // Both branches this plan can take when it lands on (35, S1) resolve to a
    // real candidate — the default ("i19") and the fast-relocation override
    // ("i19_1", guarded by `public.metrics.time < 54`).
    expect(new Set(landingActiveInfoIds)).toEqual(new Set(["i19", "i19_1"]));
  });
});
