/**
 * Neutral contract proof for the universal protected-deck lifecycle.
 *
 * The fixture deliberately uses generic item identifiers. It verifies the
 * schema, publication checker and transactional runtime without importing any
 * rule or name from a concrete game.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type {
  CubicaMechanicsIRV1Alpha1,
  Step
} from "@cubica/contracts-manifest";

import {
  executeMechanicsTransaction,
  MechanicsExecutionError
} from "../src/modules/mechanics/index.ts";
import { createSessionRandomStreamsState } from "../src/modules/runtime/sessionRandom.ts";

const require = createRequire(import.meta.url);
const { MAX_DECK_ITEMS, recommendedModuleLockForOperations } = require(
  "../../../scripts/manifest-tools/mechanics-modules.cjs"
) as {
  MAX_DECK_ITEMS: number;
  recommendedModuleLockForOperations: (
    operations: Array<string>
  ) => CubicaMechanicsIRV1Alpha1["moduleLock"];
};
const { validateMechanicsSchema } = require(
  "../../../scripts/manifest-tools/mechanics-validator.cjs"
) as {
  validateMechanicsSchema: (
    value: unknown
  ) => { valid: boolean; errors: Array<{ pointer?: string; message?: string }> };
};
const { checkMechanicsBundle } = require(
  "../../../scripts/manifest-tools/mechanics-checker.cjs"
) as {
  checkMechanicsBundle: (
    value: unknown,
    options?: { actions?: Record<string, unknown> }
  ) => unknown;
};
const { mechanicsSha256 } = require(
  "../../../scripts/manifest-tools/mechanics-canonicalize.cjs"
) as {
  mechanicsSha256: (value: unknown) => string;
};

const HASH = `sha256:${"0".repeat(64)}`;

/** Build one schema-valid neutral bundle around the supplied lifecycle steps. */
function createDeckMechanics(steps: [Step, ...Array<Step>]): CubicaMechanicsIRV1Alpha1 {
  const declarationSteps: [Step, ...Array<Step>] = [
    {
      id: "declareSampleDeck",
      kind: "command",
      op: "deck.shuffle",
      deckId: "sample",
      sourceCollection: "cards",
      stream: "fixture.deck.sample"
    },
    {
      id: "declareAlternateDeck",
      kind: "command",
      op: "deck.shuffle",
      deckId: "alternate",
      sourceCollection: "cards",
      stream: "fixture.deck.alternate"
    }
  ];
  const operations = [...declarationSteps, ...steps].map(({ op }) => op);
  const mechanics: CubicaMechanicsIRV1Alpha1 = {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    moduleLock: recommendedModuleLockForOperations([...new Set(operations)]),
    stateModel: {
      types: {
        "core.boolean": { kind: "boolean" },
        "core.integer": { kind: "integer", minimum: 0, maximum: 100 },
        "core.string": { kind: "string" },
        "core.optional-string": { kind: "option", itemType: "core.string" }
      },
      endpoints: {
        selectedCard: {
          audienceRef: "public",
          storage: { root: "public", segments: ["selectedCard"] },
          valueType: "core.optional-string",
          access: "read-write"
        },
        numericTarget: {
          audienceRef: "public",
          storage: { root: "public", segments: ["numericTarget"] },
          valueType: "core.integer",
          access: "read-write"
        },
        secretFlag: {
          audienceRef: "server",
          storage: { root: "secret", segments: ["flag"] },
          valueType: "core.boolean",
          access: "read-only"
        }
      },
      collections: {
        cards: {
          audienceRef: "public",
          storage: { root: "public", segments: ["cards"] },
          capacity: 16,
          stableKey: "map-key",
          itemTypes: ["fixture.item"],
          fields: {
            active: {
              storage: { kind: "facet", name: "active" },
              valueType: "core.boolean",
              access: "read-only"
            }
          }
        }
      },
      events: {}
    },
    plans: {
      declarations: {
        planHash: HASH,
        transaction: { steps: declarationSteps }
      },
      lifecycle: {
        planHash: HASH,
        transaction: { steps }
      }
    }
  };
  finalizePlanHash(mechanics);
  return mechanics;
}

/** Recompute the compiler-owned plan identity after a test-only mutation. */
function finalizePlanHash(mechanics: CubicaMechanicsIRV1Alpha1): void {
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    plan.planHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      budgetProfile: mechanics.budgetProfile,
      moduleLock: mechanics.moduleLock,
      stateModel: mechanics.stateModel,
      objectModels: {},
      networkModels: {},
      planId,
      transaction: plan.transaction
    });
  }
}

function createCards(): Record<string, unknown> {
  return Object.fromEntries(
    ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => [
      id,
      { objectType: "fixture.item", facets: { active: true }, attributes: {} }
    ])
  );
}

function createState(deck: {
  order: Array<string>;
  discard: Array<string>;
  held?: Array<string>;
  stream?: string;
}, additionalDecks: Record<string, {
  order: Array<string>;
  discard: Array<string>;
  held?: Array<string>;
  stream?: string;
}> = {}): Record<string, unknown> {
  return {
    public: { cards: createCards(), numericTarget: 0 },
    secret: {
      flag: true,
      decks: {
        sample: structuredClone(deck),
        ...structuredClone(additionalDecks)
      }
    }
  };
}

function execute(
  mechanics: CubicaMechanicsIRV1Alpha1,
  state: Record<string, unknown>,
  random = undefined as ReturnType<typeof createSessionRandomStreamsState> | undefined,
  params: Record<string, unknown> = {}
) {
  return executeMechanicsTransaction({
    mechanics,
    plan: mechanics.plans.lifecycle,
    state,
    params,
    actorContext: { sessionRole: "facilitator" },
    ...(random ? { random } : {})
  });
}

function readDeck(state: Record<string, unknown>, deckId = "sample") {
  return (
    state.secret as {
      decks: Record<string, {
          order: Array<string>;
          discard: Array<string>;
          held: Array<string>;
          stream?: string;
        }>;
    }
  ).decks[deckId];
}

/** Build a published action whose immutable identity binds it to one plan. */
function bindDeckAction(
  mechanics: CubicaMechanicsIRV1Alpha1,
  actionId: string,
  parameterSchema: Record<string, unknown>,
  required = true
) {
  const definition = {
    invocation: "external",
    allowedSessionRoles: ["facilitator"],
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: { deckId: parameterSchema },
      required: required ? ["deckId"] : []
    },
    binding: { kind: "mechanics-plan", planRef: "lifecycle" }
  };
  return {
    ...definition,
    definitionHash: mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      actionId,
      definition,
      planHash: mechanics.plans.lifecycle.planHash
    })
  };
}

const literal = (value: string) => ({ op: "value.literal" as const, value });

/** One reusable dynamic operation proves the bounded reference end to end. */
function createParameterizedDeckMechanics(): CubicaMechanicsIRV1Alpha1 {
  return createDeckMechanics([
    {
      id: "extractSelectedDeck",
      kind: "command",
      op: "deck.extract",
      deckId: { op: "value.param", name: "deckId" },
      source: "order",
      target: { endpoint: "selectedCard" }
    }
  ]);
}

test("schema admits only literal or parameter deck references", () => {
  const mechanics = createParameterizedDeckMechanics();
  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));

  for (const forbiddenReference of [
    { op: "value.literal", value: "sample" },
    { op: "value.state", ref: { endpoint: "selectedCard" } },
    { op: "value.result", stepId: "prior", path: ["deckId"] }
  ]) {
    const malformed = structuredClone(mechanics) as unknown as {
      plans: { lifecycle: { transaction: { steps: Array<Record<string, unknown>> } } };
    };
    malformed.plans.lifecycle.transaction.steps[0].deckId = forbiddenReference;
    assert.equal(
      validateMechanicsSchema(malformed).valid,
      false,
      `${forbiddenReference.op} must not become an indirect deck selector`
    );
  }

  const dynamicShuffle = structuredClone(mechanics) as unknown as {
    plans: { declarations: { transaction: { steps: Array<Record<string, unknown>> } } };
  };
  dynamicShuffle.plans.declarations.transaction.steps[0].deckId = {
    op: "value.param",
    name: "deckId"
  };
  assert.equal(
    validateMechanicsSchema(dynamicShuffle).valid,
    false,
    "deck.shuffle must remain the literal package declaration"
  );
});

test("checker proves every action deck parameter is finite and package-declared", () => {
  const mechanics = createParameterizedDeckMechanics();
  const actions = {
    "fixture.deck.choose-one": bindDeckAction(
      mechanics,
      "fixture.deck.choose-one",
      { type: "string", const: "sample" }
    ),
    "fixture.deck.choose-several": bindDeckAction(
      mechanics,
      "fixture.deck.choose-several",
      { type: "string", enum: ["alternate", "sample"] }
    )
  };
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics, { actions }));

  const unboundedAction = bindDeckAction(
    mechanics,
    "fixture.deck.unbounded",
    { type: "string", minLength: 1, maxLength: 128 }
  );
  assert.throws(
    () => checkMechanicsBundle(mechanics, {
      actions: { ...actions, "fixture.deck.unbounded": unboundedAction }
    }),
    (error) => isSemanticError(error, "MECHANICS_DECK_PARAM_UNBOUNDED"),
    "one broad schema must invalidate a plan even when its other actions are finite"
  );

  assert.throws(
    () => checkMechanicsBundle(mechanics, {
      actions: {
        "fixture.deck.optional": bindDeckAction(
          mechanics,
          "fixture.deck.optional",
          { type: "string", enum: ["sample"] },
          false
        )
      }
    }),
    (error) => isSemanticError(error, "MECHANICS_DECK_PARAM_UNBOUNDED")
  );
  assert.throws(
    () => checkMechanicsBundle(mechanics, {
      actions: {
        "fixture.deck.wrong-type": bindDeckAction(
          mechanics,
          "fixture.deck.wrong-type",
          { type: "integer", const: 1 }
        )
      }
    }),
    (error) => isSemanticError(error, "MECHANICS_DECK_PARAM_TYPE_INVALID")
  );
  assert.throws(
    () => checkMechanicsBundle(mechanics, {
      actions: {
        "fixture.deck.unsafe": bindDeckAction(
          mechanics,
          "fixture.deck.unsafe",
          { type: "string", enum: ["../sample"] }
        )
      }
    }),
    (error) => isSemanticError(error, "MECHANICS_DECK_ID_INVALID")
  );
  assert.throws(
    () => checkMechanicsBundle(mechanics, {
      actions: {
        "fixture.deck.undeclared": bindDeckAction(
          mechanics,
          "fixture.deck.undeclared",
          { type: "string", enum: ["missing"] }
        )
      }
    }),
    (error) => isSemanticError(error, "MECHANICS_DECK_UNDECLARED")
  );

  const literalMissing = createDeckMechanics([
    {
      id: "drawMissing",
      kind: "command",
      op: "deck.draw",
      deckId: "missing",
      target: { endpoint: "selectedCard" },
      onEmpty: "fail"
    }
  ]);
  assert.throws(
    () => checkMechanicsBundle(literalMissing),
    (error) => isSemanticError(error, "MECHANICS_DECK_UNDECLARED")
  );
});

test("runtime resolves a parameter to one existing own deck property", () => {
  const mechanics = createParameterizedDeckMechanics();
  const initial = createState(
    { order: ["a"], discard: [], held: [] },
    { alternate: { order: ["b"], discard: [], held: [] } }
  );
  const output = execute(mechanics, initial, undefined, { deckId: "alternate" });

  assert.deepEqual(readDeck(output.candidateState, "sample"), {
    order: ["a"],
    discard: [],
    held: []
  });
  assert.deepEqual(readDeck(output.candidateState, "alternate"), {
    order: [],
    discard: [],
    held: ["b"]
  });
  assert.equal(
    (output.candidateState.public as { selectedCard: string }).selectedCard,
    "b"
  );

  for (const [deckId, errorCode] of [
    // Prototype-sensitive names are invalid Mechanics identifiers and must be
    // rejected before the own-property lookup of protected deck state.
    ["constructor", "MECHANICS_DECK_ID_INVALID"],
    ["missing", "MECHANICS_DECK_UNKNOWN"],
    ["../sample", "MECHANICS_DECK_ID_INVALID"]
  ] as const) {
    assertExecutionError(
      () => execute(mechanics, initial, undefined, { deckId }),
      errorCode
    );
  }
  assertExecutionError(
    () => execute(mechanics, initial, undefined, { deckId: 1 }),
    "MECHANICS_DECK_ID_INVALID"
  );
});

test("schema and checker admit the closed extract/return/insert contract", () => {
  const mechanics = createDeckMechanics([
    {
      id: "extractTop",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order",
      target: { endpoint: "selectedCard" }
    },
    {
      id: "returnExtracted",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: { op: "value.result", stepId: "extractTop", path: ["cardId"] },
      destination: "discard"
    },
    {
      id: "insertNew",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("h"),
      destination: "held"
    }
  ]);

  const schema = validateMechanicsSchema(mechanics);
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));
  assert.doesNotThrow(() => checkMechanicsBundle(mechanics));

  const malformed = structuredClone(mechanics) as unknown as {
    plans: { lifecycle: { transaction: { steps: Array<Record<string, unknown>> } } };
  };
  malformed.plans.lifecycle.transaction.steps[0].unexpectedZone = "held";
  assert.equal(
    validateMechanicsSchema(malformed).valid,
    false,
    "each operation branch must stay closed to undeclared properties"
  );
});

test("checker rejects an incompatible disclosure target and secret control-flow leak", () => {
  const wrongTarget = createDeckMechanics([
    {
      id: "extractTop",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order",
      target: { endpoint: "numericTarget" }
    }
  ]);
  assert.throws(
    () => checkMechanicsBundle(wrongTarget),
    (error) => isSemanticError(error, "MECHANICS_ENDPOINT_TYPE_MISMATCH")
  );

  const secretControl = createDeckMechanics([
    {
      id: "extractTop",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order",
      target: { endpoint: "selectedCard" },
      when: {
        op: "predicate.compare",
        operator: "eq",
        left: { op: "value.state", ref: { endpoint: "secretFlag" } },
        right: { op: "value.literal", value: true }
      }
    }
  ]);
  assert.throws(
    () => checkMechanicsBundle(secretControl),
    (error) => isSemanticError(error, "MECHANICS_INFORMATION_FLOW_VIOLATION")
  );
});

test("checker keeps return and insert acknowledgements server-only", () => {
  const protectedSteps: Array<Step> = [
    {
      id: "protectedMembership",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: literal("a"),
      destination: "discard"
    },
    {
      id: "protectedMembership",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("h"),
      destination: "held"
    }
  ];
  for (const protectedStep of protectedSteps) {
    const mechanics = createDeckMechanics([
      protectedStep,
      {
        id: "publishMembership",
        kind: "command",
        op: "core.state.patch",
        patches: [{
          operation: "set",
          target: { endpoint: "selectedCard" },
          value: {
            op: "value.result",
            stepId: "protectedMembership",
            path: ["cardId"]
          }
        }]
      }
    ]);
    assert.throws(
      () => checkMechanicsBundle(mechanics),
      (error) => isSemanticError(error, "MECHANICS_INFORMATION_FLOW_VIOLATION"),
      `${protectedStep.op} result must not become an undeclared public membership oracle`
    );
  }
});

test("extract uses the declared top convention and supports an explicit item", () => {
  const mechanics = createDeckMechanics([
    {
      id: "discardTop",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "discard"
    },
    {
      id: "namedOrderItem",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order",
      card: literal("b"),
      target: { endpoint: "selectedCard" }
    }
  ]);
  const input = createState({ order: ["a", "b"], discard: ["c", "d"] });
  const output = execute(mechanics, input);

  assert.deepEqual(
    readDeck(output.candidateState),
    { order: ["a"], discard: ["c"], held: ["d", "b"] },
    "legacy fixtures without held are normalized on the first write"
  );
  assert.equal((output.candidateState.public as { selectedCard: string }).selectedCard, "b");
  assert.deepEqual(
    output.audit.map(({ result }) => result),
    [
      { deckId: "sample", cardId: "d", source: "discard" },
      { deckId: "sample", cardId: "b", source: "order" }
    ],
    "audit may contain one selected id and neutral metadata, but never hidden zone contents"
  );
});

test("return and insert honor every declared destination while preserving exclusivity", () => {
  const returnMechanics = createDeckMechanics([
    {
      id: "returnDiscard",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: literal("a"),
      destination: "discard"
    },
    {
      id: "returnTop",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: literal("b"),
      destination: "order-top"
    },
    {
      id: "returnBottom",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: literal("c"),
      destination: "order-bottom"
    }
  ]);
  const returned = execute(
    returnMechanics,
    createState({ order: ["d"], discard: ["e"], held: ["a", "b", "c"] })
  );
  assert.deepEqual(
    readDeck(returned.candidateState),
    { order: ["b", "d", "c"], discard: ["e", "a"], held: [] }
  );

  const insertMechanics = createDeckMechanics([
    {
      id: "insertHeld",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("d"),
      destination: "held"
    },
    {
      id: "insertDiscard",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("e"),
      destination: "discard"
    },
    {
      id: "insertTop",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("f"),
      destination: "order-top"
    },
    {
      id: "insertBottom",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("g"),
      destination: "order-bottom"
    }
  ]);
  const inserted = execute(
    insertMechanics,
    createState({ order: ["a"], discard: ["b"], held: ["c"] })
  );
  const deck = readDeck(inserted.candidateState);
  assert.deepEqual(deck, {
    order: ["f", "a", "g"],
    discard: ["b", "e"],
    held: ["c", "d"]
  });
  const allIds = [...deck.order, ...deck.discard, ...deck.held];
  assert.equal(new Set(allIds).size, allIds.length);
});

test("held items never participate in shuffle or draw rotation", () => {
  const shuffle = createDeckMechanics([
    {
      id: "shuffleExisting",
      kind: "command",
      op: "deck.shuffle",
      deckId: "sample",
      sourceCollection: "cards",
      stream: "fixture.deck"
    }
  ]);
  const shuffled = execute(
    shuffle,
    createState({
      order: ["a", "b"],
      discard: ["c"],
      held: ["d"],
      stream: "fixture.deck"
    }),
    createSessionRandomStreamsState("0123456789abcdeffedcba9876543210")
  );
  const shuffledDeck = readDeck(shuffled.candidateState);
  assert.deepEqual(shuffledDeck.held, ["d"]);
  assert.deepEqual([...shuffledDeck.order].sort(), ["a", "b", "c"]);
  assert.deepEqual(shuffledDeck.discard, []);

  const draw = createDeckMechanics([
    {
      id: "drawOne",
      kind: "command",
      op: "deck.draw",
      deckId: "sample",
      target: { endpoint: "selectedCard" },
      onEmpty: "fail"
    }
  ]);
  const drawn = execute(
    draw,
    createState({ order: ["a"], discard: [], held: ["d"], stream: "fixture.deck" })
  );
  assert.deepEqual(readDeck(drawn.candidateState), {
    order: [],
    discard: ["a"],
    held: ["d"],
    stream: "fixture.deck"
  });
});

test("publication and runtime enforce the shared protected-deck work bound", () => {
  const tooManyWorstCaseDraws = createDeckMechanics(
    Array.from({ length: 6 }, (_, index) => ({
      id: `draw${index}`,
      kind: "command" as const,
      op: "deck.draw" as const,
      deckId: "sample",
      target: { endpoint: "selectedCard" },
      onEmpty: "reshuffle-discard" as const
    })) as [Step, ...Array<Step>]
  );
  assert.throws(
    () => checkMechanicsBundle(tooManyWorstCaseDraws),
    (error) => isSemanticError(error, "MECHANICS_STATIC_BUDGET_EXCEEDED")
  );

  const extract = createDeckMechanics([
    {
      id: "boundedRead",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order"
    }
  ]);
  const oversized = createState({
    order: Array.from({ length: MAX_DECK_ITEMS + 1 }, (_, index) => `item-${index}`),
    discard: [],
    held: []
  });
  assertExecutionError(
    () => execute(extract, oversized),
    "MECHANICS_DECK_CAPACITY_EXCEEDED"
  );
});

test("wrong-zone, duplicate, unknown and later-step errors roll back the whole transaction", () => {
  const duplicateInsert = createDeckMechanics([
    {
      id: "duplicate",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("a"),
      destination: "held"
    }
  ]);
  assertExecutionError(
    () => execute(duplicateInsert, createState({ order: ["a"], discard: [], held: [] })),
    "MECHANICS_DECK_CARD_ALREADY_MEMBER"
  );

  const unknownInsert = createDeckMechanics([
    {
      id: "unknown",
      kind: "command",
      op: "deck.insert",
      deckId: "sample",
      sourceCollection: "cards",
      card: literal("unknown"),
      destination: "discard"
    }
  ]);
  assertExecutionError(
    () => execute(unknownInsert, createState({ order: ["a"], discard: [], held: [] })),
    "MECHANICS_DECK_CARD_UNKNOWN"
  );

  const wrongZoneReturn = createDeckMechanics([
    {
      id: "wrongZone",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: literal("a"),
      destination: "discard"
    }
  ]);
  assertExecutionError(
    () => execute(wrongZoneReturn, createState({ order: ["a"], discard: [], held: [] })),
    "MECHANICS_DECK_CARD_NOT_HELD"
  );

  const rollback = createDeckMechanics([
    {
      id: "extractFirst",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order",
      target: { endpoint: "selectedCard" }
    },
    {
      id: "failLater",
      kind: "command",
      op: "deck.return",
      deckId: "sample",
      card: literal("h"),
      destination: "discard"
    }
  ]);
  const original = createState({ order: ["a"], discard: ["b"], held: [] });
  const snapshot = structuredClone(original);
  assertExecutionError(
    () => execute(rollback, original),
    "MECHANICS_DECK_CARD_NOT_HELD"
  );
  assert.deepEqual(original, snapshot, "candidate deck and target writes must not escape a failed transaction");

  const duplicateZones = createDeckMechanics([
    {
      id: "readInvalid",
      kind: "command",
      op: "deck.extract",
      deckId: "sample",
      source: "order"
    }
  ]);
  assertExecutionError(
    () => execute(duplicateZones, createState({ order: ["a"], discard: [], held: ["a"] })),
    "MECHANICS_DECK_STATE_INVALID"
  );
});

function assertExecutionError(run: () => unknown, code: string): void {
  assert.throws(
    run,
    (error) => error instanceof MechanicsExecutionError && error.code === code
  );
}

function isSemanticError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
