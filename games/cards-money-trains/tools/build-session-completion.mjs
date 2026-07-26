#!/usr/bin/env node
/**
 * Build the final-score and protected session-completion slice.
 *
 * Product rules expressed by this game-local generator:
 * - only the facilitator may request, cancel or confirm completion;
 * - the request is accepted only at the `reporting` boundary of a normal
 *   running session, which is the point where every team has finished the
 *   current round;
 * - an active team's final capital is current coins minus outstanding debt
 *   plus every active vehicle valued at its effective purchase price;
 * - logistics companies and locomotive guilds receive separate stable
 *   rankings, while equal scores retain a shared place;
 * - excluded teams and market-returned vehicles never enter the result.
 *
 * The implementation composes the accepted neutral Mechanics operations.
 * It does not introduce a game-specific Runtime branch. Small derived fields
 * snapshot the exact facts used by the final calculation so a newcomer can
 * explain every total after the irreversible transition to `finished`.
 */

import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");

const normalFixtureId = "normal-start-policy";
const finishActionIds = [
  "session.finish.request",
  "session.finish.cancel",
  "session.finish.confirm"
];
const unvaluedAssetOwner = "unvalued-market-asset";

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const literal = (value) => ({ op: "value.literal", value });
const state = (endpoint) => ({ op: "value.state", ref: { endpoint } });
const result = (stepId, pathSegments) => ({
  op: "value.result",
  stepId,
  ...(pathSegments ? { path: pathSegments } : {})
});
const itemAttribute = (field) => ({
  op: "value.item",
  area: "attribute",
  field
});
const compare = (operator, left, right) => ({
  op: "predicate.compare",
  operator,
  left,
  right
});
const all = (...items) => ({ op: "predicate.all", items });
const subtract = (...items) => ({ op: "number.subtract", items });
const coalesce = (...items) => ({ op: "value.coalesce", items });

const noParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: []
};

/** Resolve a one-turn override before the persistent base market price. */
const effectivePurchasePrice = (assetKind) => coalesce(
  state(`public.turnEffects.purchasePriceOverrides.${assetKind}`),
  state(`public.market.basePurchasePrices.${assetKind}`)
);

/** Create one facilitator Game Intent backed by the same-named Mechanics plan. */
const action = ({ id, label, semantics }) => ({
  id,
  _type: "game.Action",
  _label: label,
  _semantics: semantics,
  capabilityFamily: "runtime.server",
  capability: id,
  displayName: label,
  allowedSessionRoles: ["facilitator"],
  paramsSchema: noParamsSchema,
  binding: {
    kind: "mechanics-plan",
    planRef: id
  }
});

/**
 * A full round is complete precisely at the reporting boundary.
 *
 * Earlier phases still contain unresolved actions for at least one team. A
 * dedicated boolean is also checked because the UI uses it to avoid presenting
 * the request as active outside this boundary.
 */
const finishRequestGuard = () => all(
  compare("eq", state("public.session.fixtureId"), literal(normalFixtureId)),
  compare("eq", state("public.session.status"), literal("running")),
  compare("eq", state("public.session.phase"), literal("reporting")),
  compare(
    "eq",
    state("public.session.finishConfirmationPending"),
    literal(false)
  ),
  compare("eq", state("public.session.canRequestFinish"), literal(true))
);

const buildRequest = () => {
  const id = "session.finish.request";
  return {
    action: action({
      id,
      label: "Завершить игру…",
      semantics:
        "На границе полного раунда открывает отдельное подтверждение и временно переводит сессию в состояние завершения."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: finishRequestGuard(),
            errorCode: "SESSION_FINISH_REQUEST_UNAVAILABLE"
          },
          {
            id: "open-confirmation",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.session.status" },
                value: literal("finishing")
              },
              {
                operation: "set",
                target: {
                  endpoint: "public.session.finishConfirmationPending"
                },
                value: literal(true)
              },
              {
                operation: "set",
                target: { endpoint: "public.session.canRequestFinish" },
                value: literal(false)
              }
            ]
          }
        ]
      }
    }
  };
};

const buildCancel = () => {
  const id = "session.finish.cancel";
  return {
    action: action({
      id,
      label: "Продолжить игру",
      semantics:
        "Отменяет ещё не подтверждённое завершение и возвращает ведущего к отчётной границе текущего раунда."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              compare(
                "eq",
                state("public.session.fixtureId"),
                literal(normalFixtureId)
              ),
              compare(
                "eq",
                state("public.session.status"),
                literal("finishing")
              ),
              compare(
                "eq",
                state("public.session.phase"),
                literal("reporting")
              ),
              compare(
                "eq",
                state("public.session.finishConfirmationPending"),
                literal(true)
              )
            ),
            errorCode: "SESSION_FINISH_CANCEL_UNAVAILABLE"
          },
          {
            id: "cancel-confirmation",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.session.status" },
                value: literal("running")
              },
              {
                operation: "set",
                target: {
                  endpoint: "public.session.finishConfirmationPending"
                },
                value: literal(false)
              },
              {
                operation: "set",
                target: { endpoint: "public.session.canRequestFinish" },
                value: literal(true)
              }
            ]
          }
        ]
      }
    }
  };
};

/**
 * Build the irreversible final calculation.
 *
 * The selectors are bounded by the existing collection capacities. Dynamic
 * score/ranking selections therefore remain safe for every supported party
 * size (4–12 teams) without predeclaring artificial team slots.
 */
const buildConfirm = () => {
  const id = "session.finish.confirm";
  const activeTeamSelector = {
    collection: "teams",
    objectTypes: ["game.team"],
    facets: { placementStatus: literal("placed") },
    cardinality: { min: 0, max: 12 }
  };
  return {
    action: action({
      id,
      label: "Подтвердить завершение",
      semantics:
        "Атомарно фиксирует текущие цены техники, считает капитал активных команд, публикует два рейтинга и необратимо завершает партию."
    }),
    plan: {
      transaction: {
        steps: [
          {
            id: "guard",
            kind: "assert",
            op: "core.assert",
            predicate: all(
              compare(
                "eq",
                state("public.session.fixtureId"),
                literal(normalFixtureId)
              ),
              compare(
                "eq",
                state("public.session.status"),
                literal("finishing")
              ),
              compare(
                "eq",
                state("public.session.phase"),
                literal("reporting")
              ),
              compare(
                "eq",
                state("public.session.finishConfirmationPending"),
                literal(true)
              )
            ),
            errorCode: "SESSION_FINISH_CONFIRM_UNAVAILABLE"
          },
          {
            id: "active-teams",
            kind: "query",
            op: "core.entities.select",
            selector: activeTeamSelector
          },
          {
            id: "prepare-team-score-base",
            kind: "command",
            op: "core.entities.update",
            selection: result("active-teams"),
            attributeValues: {
              finalScoreBase: subtract(
                itemAttribute("coins"),
                itemAttribute("outstandingDebt")
              )
            }
          },
          {
            id: "active-wagons",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "wagons",
              objectTypes: ["transport.wagon"],
              facets: { availability: literal("active") },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "value-active-wagons",
            kind: "command",
            op: "core.entities.update",
            selection: result("active-wagons"),
            attributeValues: {
              finalScoreOwnerTeamId: itemAttribute("ownerTeamId"),
              finalPurchaseValue: effectivePurchasePrice("wagon")
            }
          },
          {
            id: "active-locomotives",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "locomotives",
              objectTypes: ["transport.locomotive"],
              facets: { availability: literal("active") },
              cardinality: { min: 0, max: 64 }
            }
          },
          {
            id: "value-active-locomotives",
            kind: "command",
            op: "core.entities.update",
            selection: result("active-locomotives"),
            attributeValues: {
              finalScoreOwnerTeamId: itemAttribute("ownerTeamId"),
              finalPurchaseValue: effectivePurchasePrice("locomotive")
            }
          },
          {
            id: "scores",
            kind: "query",
            op: "core.entities.score",
            selection: result("active-teams"),
            baseField: "finalScoreBase",
            relatedSources: [
              {
                collection: "wagons",
                ownerField: "finalScoreOwnerTeamId",
                valueField: "finalPurchaseValue"
              },
              {
                collection: "locomotives",
                ownerField: "finalScoreOwnerTeamId",
                valueField: "finalPurchaseValue"
              }
            ]
          },
          {
            id: "logistics-teams",
            kind: "query",
            op: "core.entities.select",
            selector: {
              ...activeTeamSelector,
              attributes: { type: literal("logistics_company") }
            }
          },
          {
            id: "guild-teams",
            kind: "query",
            op: "core.entities.select",
            selector: {
              ...activeTeamSelector,
              attributes: { type: literal("locomotive_guild") }
            }
          },
          {
            id: "rankings",
            kind: "algorithm",
            op: "core.ranking.stable",
            scores: result("scores"),
            groups: [
              {
                id: "logistics-companies",
                selection: result("logistics-teams")
              },
              {
                id: "locomotive-guilds",
                selection: result("guild-teams")
              }
            ]
          },
          {
            id: "publish-final-results",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.finalResults.status" },
                value: literal("calculated")
              },
              {
                operation: "set",
                target: { endpoint: "public.finalResults.completedTurn" },
                value: state("public.session.turnNumber")
              },
              {
                operation: "set",
                target: {
                  endpoint: "public.finalResults.purchasePrice.wagon"
                },
                value: effectivePurchasePrice("wagon")
              },
              {
                operation: "set",
                target: {
                  endpoint: "public.finalResults.purchasePrice.locomotive"
                },
                value: effectivePurchasePrice("locomotive")
              },
              {
                operation: "set",
                target: { endpoint: "public.finalResults.rankings" },
                value: result("rankings", ["groups"])
              }
            ]
          },
          {
            id: "finish-session",
            kind: "command",
            op: "core.state.patch",
            patches: [
              {
                operation: "set",
                target: { endpoint: "public.session.status" },
                value: literal("finished")
              },
              {
                operation: "set",
                target: { endpoint: "public.session.phase" },
                value: literal("finished")
              },
              {
                operation: "set",
                target: {
                  endpoint: "public.session.finishConfirmationPending"
                },
                value: literal(false)
              },
              {
                operation: "set",
                target: { endpoint: "public.session.canRequestFinish" },
                value: literal(false)
              },
              {
                operation: "set",
                target: { endpoint: "public.construction.mode" },
                value: literal(null)
              }
            ]
          },
          {
            id: "journal",
            kind: "command",
            op: "core.event.emit",
            eventType: "session.finish.confirm.event.3",
            summary: literal(
              "Ведущий завершил игру и зафиксировал итоговые рейтинги"
            ),
            audience: "public",
            data: {
              kind: literal("session")
            }
          }
        ]
      }
    }
  };
};

/** Declare persisted inputs and outputs used only by the final calculation. */
const declareCompletionState = (root) => {
  const stateModel = root.mechanics.stateModel;
  const teams = stateModel.collections.teams;
  const wagons = stateModel.collections.wagons;
  const locomotives = stateModel.collections.locomotives;
  assert.ok(teams && wagons && locomotives, "final-score collections are required");

  /*
   * Persist the ranking through an exact declared shape rather than a broad
   * JSON escape hatch. The bounds come from this game's existing capacities:
   * at most 12 active teams and at most 128 active vehicles across the two
   * related collections.
   */
  stateModel.types["game.final-score-related-entry"] = {
    kind: "record",
    fields: {
      entityId: { typeRef: "core.string", optional: false },
      value: { typeRef: "core.integer", optional: false }
    }
  };
  stateModel.types["game.final-score-related-list"] = {
    kind: "list",
    itemType: "game.final-score-related-entry",
    maxItems: 128
  };
  stateModel.types["game.final-score-standing"] = {
    kind: "record",
    fields: {
      entityId: { typeRef: "core.string", optional: false },
      baseValue: { typeRef: "core.integer", optional: false },
      relatedValue: { typeRef: "core.integer", optional: false },
      score: { typeRef: "core.integer", optional: false },
      relatedItems: {
        typeRef: "game.final-score-related-list",
        optional: false
      },
      rank: { typeRef: "core.integer", optional: false }
    }
  };
  stateModel.types["game.final-score-standing-list"] = {
    kind: "list",
    itemType: "game.final-score-standing",
    maxItems: 12
  };
  stateModel.types["game.final-score-winner-list"] = {
    kind: "list",
    itemType: "core.string",
    maxItems: 12
  };
  stateModel.types["game.final-ranking-group"] = {
    kind: "record",
    fields: {
      standings: {
        typeRef: "game.final-score-standing-list",
        optional: false
      },
      winners: {
        typeRef: "game.final-score-winner-list",
        optional: false
      },
      tiedForFirst: { typeRef: "core.boolean", optional: false }
    }
  };
  stateModel.types["game.final-ranking-group-map"] = {
    kind: "map",
    valueType: "game.final-ranking-group",
    maxProperties: 2
  };

  teams.fields.finalScoreBase = {
    storage: { kind: "attribute", name: "finalScoreBase" },
    valueType: "core.integer",
    access: "read-write"
  };
  for (const collection of [wagons, locomotives]) {
    collection.fields.finalScoreOwnerTeamId = {
      storage: { kind: "attribute", name: "finalScoreOwnerTeamId" },
      valueType: "core.string",
      access: "read-write"
    };
    collection.fields.finalPurchaseValue = {
      storage: { kind: "attribute", name: "finalPurchaseValue" },
      valueType: "core.integer",
      access: "read-write"
    };
  }

  root.state.public.finalResults = {
    status: "not-calculated",
    completedTurn: 0,
    purchasePrice: {
      wagon: 0,
      locomotive: 0
    },
    rankings: {}
  };

  const endpoints = stateModel.endpoints;
  const finalEndpoint = (segments, valueType) => ({
    audienceRef: "public",
    storage: { root: "public", segments: ["finalResults", ...segments] },
    valueType,
    access: "read-write"
  });
  endpoints["public.finalResults.status"] = finalEndpoint(
    ["status"],
    "core.string"
  );
  endpoints["public.finalResults.completedTurn"] = finalEndpoint(
    ["completedTurn"],
    "core.integer"
  );
  endpoints["public.finalResults.purchasePrice.wagon"] = finalEndpoint(
    ["purchasePrice", "wagon"],
    "core.integer"
  );
  endpoints["public.finalResults.purchasePrice.locomotive"] = finalEndpoint(
    ["purchasePrice", "locomotive"],
    "core.integer"
  );
  // A ranking standing already contains the complete score explanation
  // (base, related items, total and place). Persisting the opaque intermediate
  // score result as a second JSON document would duplicate the same facts and
  // weaken the declared structural result boundary.
  delete endpoints["public.finalResults.scores"];
  endpoints["public.finalResults.rankings"] = finalEndpoint(
    ["rankings"],
    "game.final-ranking-group-map"
  );

  for (const team of Object.values(root.state.public.objects.teams)) {
    team.attributes.finalScoreBase ??= 0;
  }
  for (const collectionName of ["wagons", "locomotives"]) {
    for (const vehicle of Object.values(
      root.state.public.objects[collectionName]
    )) {
      vehicle.attributes.finalScoreOwnerTeamId ??= unvaluedAssetOwner;
      vehicle.attributes.finalPurchaseValue ??= 0;
    }
  }

  // Every dynamically created object must satisfy the declared typed fields
  // before it can later participate in the final calculation.
  for (const plan of Object.values(root.mechanics.plans)) {
    for (const step of plan.transaction.steps) {
      if (step.op !== "core.entity.create") continue;
      if (step.collection === "teams") {
        step.attributes.finalScoreBase ??= literal(0);
      }
      if (step.collection === "wagons" || step.collection === "locomotives") {
        step.attributes.finalScoreOwnerTeamId ??= literal(unvaluedAssetOwner);
        step.attributes.finalPurchaseValue ??= literal(0);
      }
    }
  }
};

/**
 * Keep the UI's existing availability flag aligned with the authoritative
 * phase. The runtime guard remains the security boundary; this derived flag
 * only prevents a visually active finish button during an unfinished round.
 */
const synchronizeFinishAvailability = (root) => {
  root.state.public.session.canRequestFinish = false;
  for (const plan of Object.values(root.mechanics.plans)) {
    for (const step of plan.transaction.steps) {
      if (step.op !== "core.state.patch") continue;
      const phasePatch = step.patches.find(
        (patch) =>
          patch.operation === "set"
          && patch.target?.endpoint === "public.session.phase"
          && patch.value?.op === "value.literal"
      );
      if (!phasePatch) continue;
      const canRequest = phasePatch.value.value === "reporting";
      const availabilityPatch = step.patches.find(
        (patch) =>
          patch.operation === "set"
          && patch.target?.endpoint === "public.session.canRequestFinish"
      );
      if (availabilityPatch) {
        availabilityPatch.value = literal(canRequest);
      } else {
        step.patches.push({
          operation: "set",
          target: { endpoint: "public.session.canRequestFinish" },
          value: literal(canRequest)
        });
      }
    }
  }
};

/** Replace the three pre-existing placeholder actions without changing order. */
const replaceFinishActionsAndPlans = (root, generated) => {
  const actionById = new Map(
    generated.map((candidate) => [candidate.action.id, candidate.action])
  );
  const seenActions = new Set();
  root.logic.actions = root.logic.actions.map((candidate) => {
    const replacement = actionById.get(candidate.id);
    if (!replacement) return candidate;
    seenActions.add(candidate.id);
    return replacement;
  });
  assert.deepEqual(
    [...seenActions].sort(),
    [...finishActionIds].sort(),
    "all placeholder finish actions must exist"
  );

  const planById = new Map(
    generated.map((candidate) => [candidate.action.id, candidate.plan])
  );
  const seenPlans = new Set();
  root.mechanics.plans = Object.fromEntries(
    Object.entries(root.mechanics.plans).map(([planId, plan]) => {
      const replacement = planById.get(planId);
      if (!replacement) return [planId, plan];
      seenPlans.add(planId);
      return [planId, replacement];
    })
  );
  assert.deepEqual(
    [...seenPlans].sort(),
    [...finishActionIds].sort(),
    "all placeholder finish plans must exist"
  );
};

/** Apply only the game-local session-completion transformation. */
const buildSessionCompletionAuthoring = (sourceAuthoring) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;

  declareCompletionState(root);
  synchronizeFinishAvailability(root);
  const generated = [buildRequest(), buildCancel(), buildConfirm()];
  replaceFinishActionsAndPlans(root, generated);

  root.content.data.sessionCompletion = {
    status: "executable-final-score-and-protected-completion",
    completionBoundary: "reporting-after-full-round",
    confirmationLifecycle: "running-to-finishing-to-finished",
    scoreFormula:
      "coins + active vehicles at effective purchase prices - outstanding debt",
    excludedTeams: "omitted",
    rankingGroups: ["logistics-companies", "locomotive-guilds"],
    ties: "shared-rank-and-all-first-place-winners",
    immutableAfterCompletion: true
  };

  const blockers = new Set(root.config.runtimeBlockers);
  blockers.delete("remaining reporting workflows");
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const buildFromDisk = async () =>
  buildSessionCompletionAuthoring(await readJson(authoringPath));

/** Replace generated authoring atomically so interruption cannot truncate it. */
const writeAtomically = async (filePath, content) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-session-completion.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "session completion authoring is stale; run build-session-completion.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} protected final scoring\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

export {
  authoringPath,
  buildSessionCompletionAuthoring,
  buildFromDisk,
  effectivePurchasePrice,
  finishActionIds,
  unvaluedAssetOwner
};
