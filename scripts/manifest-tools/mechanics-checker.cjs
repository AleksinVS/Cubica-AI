/**
 * Semantic checker for schema-valid Mechanics IR.
 *
 * JSON Schema owns every structural rule. This checker only validates facts
 * that cross JSON-object boundaries: module identity, symbol references,
 * result ordering, declared read/write access, basic value compatibility, and
 * a conservative static execution budget.
 */

const {
  MAX_SESSION_RANDOM_STREAMS,
  MODULE_REGISTRY,
  OPERATION_MODULES,
  moduleIdsForOperations
} = require("./mechanics-modules.cjs");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");

const BUDGET_PROFILES = Object.freeze({
  "turn-based-standard-v1": Object.freeze({
    maxSteps: 512,
    maxExpressionNodes: 32_768,
    maxScannedEntities: 65_536,
    maxResultEntities: 16_384,
    maxWrites: 65_536,
    maxWeightedCost: 300_000,
    maxJsonDepth: 32,
    maxJsonNodes: 32_768,
    maxLiteralValueNodes: 16_384,
    maxInputParamNodes: 32_768,
    maxCandidateStateNodes: 1_000_000,
    maxEventNodes: 65_536,
    maxTypeReferences: 65_536,
    maxStringUtf8Bytes: 16 * 1024,
    maxLiteralValueBytes: 256 * 1024,
    maxLiteralPlanBytes: 512 * 1024,
    maxLiteralPlanNodes: 32_768,
    maxInputParamsBytes: 256 * 1024,
    maxIntermediateBytes: 2 * 1024 * 1024,
    maxCandidateStateBytes: 8 * 1024 * 1024,
    maxSingleEventBytes: 256 * 1024,
    maxEventBytes: 2 * 1024 * 1024,
    maxAuditBytes: 2 * 1024 * 1024
  }),
  "turn-based-large-v1": Object.freeze({
    maxSteps: 512,
    maxExpressionNodes: 131_072,
    maxScannedEntities: 262_144,
    maxResultEntities: 65_536,
    maxWrites: 262_144,
    maxWeightedCost: 1_200_000,
    maxJsonDepth: 32,
    maxJsonNodes: 131_072,
    maxLiteralValueNodes: 65_536,
    maxInputParamNodes: 131_072,
    maxCandidateStateNodes: 4_000_000,
    maxEventNodes: 262_144,
    maxTypeReferences: 262_144,
    maxStringUtf8Bytes: 64 * 1024,
    maxLiteralValueBytes: 1024 * 1024,
    maxLiteralPlanBytes: 2 * 1024 * 1024,
    maxLiteralPlanNodes: 131_072,
    maxInputParamsBytes: 1024 * 1024,
    maxIntermediateBytes: 8 * 1024 * 1024,
    maxCandidateStateBytes: 32 * 1024 * 1024,
    maxSingleEventBytes: 1024 * 1024,
    maxEventBytes: 8 * 1024 * 1024,
    maxAuditBytes: 8 * 1024 * 1024
  })
});

class MechanicsSemanticError extends Error {
  constructor(code, pointer, message) {
    super(`${code} at ${pointer || "/"}: ${message}`);
    this.name = "MechanicsSemanticError";
    this.code = code;
    this.pointer = pointer || "";
  }
}

const fail = (code, pointer, message) => {
  throw new MechanicsSemanticError(code, pointer, message);
};

const child = (pointer, segment) => `${pointer}/${String(segment).replace(/~/g, "~0").replace(/\//g, "~1")}`;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SAFE_IDENTIFIER = /^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SYSTEM_SCHEDULE_ID_PATTERN = /^[A-Za-z0-9_-]{22,128}$/u;
const isSafeMechanicsIdentifier = (value) => typeof value === "string" && SAFE_IDENTIFIER.test(value);

/**
 * Confidentiality is an ordered lattice: a value may flow only to a sink
 * that is at least as restrictive as the value. Integrity is tracked beside
 * it so publication diagnostics retain whether data came from immutable game
 * content, authenticated server context, a checked platform module, or an
 * untrusted command parameter. Integrity does not form a confidentiality
 * escape hatch: only an operation explicitly listed as a trusted disclosure
 * may lower the audience label of its own result.
 */
const AUDIENCE_RANK = Object.freeze({ public: 0, actor: 1, server: 2 });
const INTEGRITY_RANK = Object.freeze({ manifest: 0, server: 1, module: 2, untrusted: 3 });
const PUBLIC_MANIFEST_FLOW = Object.freeze({ audience: "public", integrity: "manifest" });
// Keep this publication ceiling equal to runtime budget.ts. Static rejection
// prevents a structurally valid bundle from reaching runtime with a recursive
// tree that the executor is guaranteed to reject.
const MAX_EXPRESSION_PREDICATE_DEPTH = 64;

/**
 * Derive the platform-owned turn bootstrap contract from a schema-valid game.
 *
 * Both authoring compilation and runtime manifest loading call this helper so
 * publication cannot accept a package that the runtime loader later rejects,
 * or vice versa. Structural validity remains owned by the manifest schemas.
 */
function turnSessionInitializationForManifest(manifest) {
  if (!isRecord(manifest)) return undefined;
  const state = isRecord(manifest.state) ? manifest.state : undefined;
  const config = isRecord(manifest.config) ? manifest.config : undefined;
  const players = config && isRecord(config.players) ? config.players : undefined;
  const turnModel = config && isRecord(config.turnModel) ? config.turnModel : undefined;
  const phases = turnModel && Array.isArray(turnModel.phases) ? turnModel.phases : undefined;
  if (!state || !isRecord(state.playersTemplate) || !players || !phases || phases.length === 0) {
    return undefined;
  }
  return {
    minimumPlayers: players.min,
    maximumPlayers: players.max,
    phases
  };
}

function joinFlows(...flows) {
  const present = flows.filter(Boolean);
  return {
    audience: present.reduce(
      (strictest, flow) => AUDIENCE_RANK[flow.audience] > AUDIENCE_RANK[strictest] ? flow.audience : strictest,
      "public"
    ),
    integrity: present.reduce(
      (weakest, flow) => INTEGRITY_RANK[flow.integrity] > INTEGRITY_RANK[weakest] ? flow.integrity : weakest,
      "manifest"
    )
  };
}

function checkMechanicsBundle(mechanics, options = {}) {
  const lockedModules = checkModuleLock(mechanics.moduleLock);
  const model = createModel(mechanics.stateModel);
  const profile = BUDGET_PROFILES[mechanics.budgetProfile];
  if (!profile) fail("MECHANICS_BUDGET_PROFILE_UNKNOWN", "/budgetProfile", "unknown platform budget profile");
  if (options.initialState !== undefined) {
    checkInitialState(
      options.initialState,
      model,
      options.networkModels || {},
      profile,
      options.turnSessionInitialization
    );
  }
  checkNetworkBindings(options.networkModels || {}, model);
  checkStaticResourceBudgets(mechanics, profile);
  checkDeclaredRandomStreams(mechanics.plans);

  const actions = options.actions || {};
  const actionContexts = checkActionsAndBuildPlanParameterContexts(
    mechanics,
    actions,
    model,
    options.parameterActions || {}
  );
  checkExactModuleLockUsage(mechanics.plans, lockedModules);

  const costs = {};
  const scheduleRegistrations = [];
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    const expectedPlanHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      budgetProfile: mechanics.budgetProfile,
      moduleLock: mechanics.moduleLock,
      stateModel: mechanics.stateModel,
      objectModels: options.objectModels || {},
      networkModels: options.networkModels || {},
      planId,
      transaction: plan.transaction
    });
    if (plan.planHash !== expectedPlanHash) {
      fail(
        "MECHANICS_PLAN_HASH_MISMATCH",
        `/plans/${escapePointer(planId)}/planHash`,
        "declared plan hash does not match its canonical compiler-owned content"
      );
    }
    costs[planId] = checkPlan(
      planId,
      plan,
      model,
      lockedModules,
      profile,
      options.networkModels || {},
      actionContexts.parameters.get(planId) || new Map(),
      actionContexts.planInvocations.get(planId) || "unbound",
      actions,
      scheduleRegistrations
    );
  }
  checkCombinedSystemScheduleBudgets(scheduleRegistrations, actions, costs, profile);
  return { costs, lockedModules };
}

/**
 * Bind every value.param use to the closed schema of every action that can
 * execute its plan. A reusable plan is admitted only when those schemas give
 * each referenced name the same scalar type and optionality.
 */
function checkActionsAndBuildPlanParameterContexts(mechanics, actions, model, parameterActions) {
  const actionsByPlan = new Map();
  for (const [actionId, action] of Object.entries(actions)) {
    checkActionInvocation(actionId, action);
    checkActionReferenceBindings(actionId, action, model);
    const planRef = action && action.binding && action.binding.planRef;
    if (typeof planRef !== "string" || mechanics.plans[planRef] === undefined) {
      fail(
        "MECHANICS_PLAN_REF_UNKNOWN",
        `/actions/${escapePointer(actionId)}/binding/planRef`,
        `action references unknown plan "${String(planRef)}"`
      );
    }
    const { definitionHash, ...definition } = action;
    const expectedDefinitionHash = mechanicsSha256({
      apiVersion: mechanics.apiVersion,
      actionId,
      definition,
      planHash: mechanics.plans[planRef].planHash
    });
    if (definitionHash !== expectedDefinitionHash) {
      fail(
        "MECHANICS_ACTION_HASH_MISMATCH",
        `/actions/${escapePointer(actionId)}/definitionHash`,
        "declared action hash does not match its canonical compiler-owned definition"
      );
    }
    actionsByPlan.set(planRef, [...(actionsByPlan.get(planRef) || []), { actionId, action }]);
  }
  for (const [actionId, action] of Object.entries(parameterActions)) {
    if (Object.prototype.hasOwnProperty.call(actions, actionId)) {
      fail("MECHANICS_ACTION_ID_DUPLICATE", `/parameterActions/${escapePointer(actionId)}`, "pending action duplicates a published action id");
    }
    checkActionReferenceBindings(actionId, action, model);
    checkActionInvocation(actionId, action);
    const planRef = action && action.binding && action.binding.planRef;
    if (typeof planRef !== "string" || mechanics.plans[planRef] === undefined) {
      fail(
        "MECHANICS_PLAN_REF_UNKNOWN",
        `/parameterActions/${escapePointer(actionId)}/binding/planRef`,
        `pending action references unknown plan "${String(planRef)}"`
      );
    }
    actionsByPlan.set(planRef, [...(actionsByPlan.get(planRef) || []), { actionId: `pending:${actionId}`, action }]);
  }

  const contexts = new Map();
  const planInvocations = new Map();
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    const names = collectPlanParameterNames(plan.transaction);
    const boundActions = actionsByPlan.get(planId) || [];
    const invocationSet = new Set(boundActions.map(({ action }) => action.invocation));
    if (invocationSet.size > 1) {
      fail(
        "MECHANICS_PLAN_INVOCATION_INCOMPATIBLE",
        `/plans/${escapePointer(planId)}`,
        "one plan cannot be shared by external and system intents"
      );
    }
    planInvocations.set(planId, invocationSet.values().next().value || "unbound");
    const parameters = new Map();
    for (const name of names) {
      if (boundActions.length === 0) {
        // An unbound plan is not a published Game Intent and cannot execute.
        // The compiler supplies authoring-only pending actions when it needs
        // to prove such a future plan; runtime admission may safely retain the
        // immutable, unreachable plan without inventing a public parameter
        // contract for it.
        parameters.set(name, { kind: "unknown" });
        continue;
      }
      let expected;
      for (const { actionId, action } of boundActions) {
        const properties = isRecord(action.paramsSchema?.properties) ? action.paramsSchema.properties : {};
        const property = properties[name];
        if (!isRecord(property)) {
          fail(
            "MECHANICS_PARAM_UNDECLARED",
            `/actions/${escapePointer(actionId)}/paramsSchema/properties`,
            `plan parameter "${name}" is not declared by the bound action`
          );
        }
        const required = Array.isArray(action.paramsSchema?.required) && action.paramsSchema.required.includes(name);
        const actual = parameterTypeFromSchema(property, required);
        if (expected && (expected.value !== actual.value || expected.optional !== actual.optional)) {
          fail(
            "MECHANICS_PLAN_PARAM_SCHEMA_INCOMPATIBLE",
            `/actions/${escapePointer(actionId)}/paramsSchema/properties/${escapePointer(name)}`,
            `shared plan "${planId}" gives parameter "${name}" incompatible action schemas`
          );
        }
        expected = actual;
      }
      parameters.set(name, expected);
    }
    contexts.set(planId, parameters);
  }
  return { parameters: contexts, planInvocations };
}

function checkActionInvocation(actionId, action) {
  const pointer = `/actions/${escapePointer(actionId)}/invocation`;
  if (action.invocation !== "external" && action.invocation !== "system") {
    fail("MECHANICS_ACTION_INVOCATION_INVALID", pointer, "published action requires external or system invocation");
  }
  if (action.invocation === "system" && Array.isArray(action.allowedSessionRoles) &&
      !action.allowedSessionRoles.includes("assistant")) {
    fail(
      "MECHANICS_SYSTEM_ACTION_ROLE_MISMATCH",
      `/actions/${escapePointer(actionId)}/allowedSessionRoles`,
      "system action role restriction must include assistant"
    );
  }
}

function collectPlanParameterNames(value, result = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPlanParameterNames(item, result));
  } else if (isRecord(value)) {
    if (value.op === "system.schedule.register") {
      collectPlanParameterNames(value.params, result);
      if (value.when !== undefined) collectPlanParameterNames(value.when, result);
      return result;
    }
    if (value.op === "value.param" && typeof value.name === "string") result.add(value.name);
    Object.values(value).forEach((item) => collectPlanParameterNames(item, result));
  }
  return result;
}

function parameterTypeFromSchema(property, required) {
  const value = property.type === "integer" ? "integer"
    : property.type === "number" ? "decimal"
      : property.type === "string" ? "string"
        : property.type === "boolean" ? "boolean"
          : undefined;
  if (!value) fail("MECHANICS_PARAM_SCHEMA_UNSUPPORTED", "/actions", "action parameter must use one bounded scalar schema");
  return { kind: "parameter", value, optional: !required };
}

/** Module locks are an exact executable closure: neither missing nor idle. */
function checkExactModuleLockUsage(plans, lockedModules) {
  const operations = Object.values(plans).flatMap((plan) =>
    plan.transaction.steps.map((step) => step.op));
  const required = new Set(moduleIdsForOperations(operations));
  for (const moduleId of required) {
    if (!lockedModules.has(moduleId)) {
      fail("MECHANICS_MODULE_NOT_LOCKED", "/moduleLock", `required module "${moduleId}" is not locked`);
    }
  }
  for (const moduleId of lockedModules.keys()) {
    if (!required.has(moduleId)) {
      fail("MECHANICS_MODULE_LOCK_UNUSED", "/moduleLock", `locked module "${moduleId}" is not in the executable dependency closure`);
    }
  }
}

/**
 * Reject a bundle that can name more persisted random streams than runtime
 * can ever store. The limit applies to the union across all plans: distinct
 * actions execute in the same session and therefore share one counter map.
 */
function checkDeclaredRandomStreams(plans) {
  const streams = new Set();
  for (const planId of Object.keys(plans).sort()) {
    const steps = plans[planId].transaction.steps;
    for (const [stepIndex, step] of steps.entries()) {
      if ((step.op !== "random.dice.roll" && step.op !== "deck.shuffle") || streams.has(step.stream)) {
        continue;
      }
      streams.add(step.stream);
      if (streams.size > MAX_SESSION_RANDOM_STREAMS) {
        fail(
          "MECHANICS_RANDOM_STREAM_LIMIT_EXCEEDED",
          `/plans/${escapePointer(planId)}/transaction/steps/${stepIndex}/stream`,
          `declared random streams exceed the runtime limit of ${MAX_SESSION_RANDOM_STREAMS}`
        );
      }
    }
  }
}

/**
 * Parameter references are opaque ids, but runtime resolves them through the
 * same closed collection model as Mechanics. Checking that join at publication
 * prevents a command from reaching runtime with an otherwise valid reference
 * to a collection the executor cannot inspect safely.
 */
function checkActionReferenceBindings(actionId, action, model) {
  const properties = isRecord(action?.paramsSchema?.properties)
    ? action.paramsSchema.properties
    : {};
  for (const [index, name] of (action?.paramsSchema?.required || []).entries()) {
    if (!Object.prototype.hasOwnProperty.call(properties, name)) {
      fail(
        "MECHANICS_ACTION_PARAM_REQUIRED_UNDECLARED",
        `/actions/${escapePointer(actionId)}/paramsSchema/required/${index}`,
        `required parameter "${name}" is not declared in properties`
      );
    }
  }
  for (const [paramId, property] of Object.entries(properties)) {
    const reference = isRecord(property) && isRecord(property["x-cubica-ref"])
      ? property["x-cubica-ref"]
      : undefined;
    if (!reference) continue;
    const pointer = `/actions/${escapePointer(actionId)}/paramsSchema/properties/${escapePointer(paramId)}/x-cubica-ref`;
    const collection = requireCollection(model, reference.collection, `${pointer}/collection`);
    if (action.invocation === "system" && storageUsesActorContext(collection.storage)) {
      fail(
        "MECHANICS_SYSTEM_CONTEXT_INVALID",
        `${pointer}/collection`,
        "system intent parameters cannot resolve through an actor-scoped collection"
      );
    }
    const expectedAudience = reference.visibility === "secret" ? "server" : "public";
    if (collection.audienceRef !== expectedAudience) {
      fail("MECHANICS_ACTION_REF_AUDIENCE_MISMATCH", `${pointer}/visibility`, "parameter visibility differs from its collection audience");
    }
    for (const [index, objectType] of (reference.allowedTypes || []).entries()) {
      if (!collection.itemTypes.includes(objectType)) {
        fail(
          "MECHANICS_ACTION_REF_TYPE_MISMATCH",
          `${pointer}/allowedTypes/${index}`,
          `parameter allows object type outside collection "${String(reference.collection)}"`
        );
      }
    }
  }
}

/**
 * Validate authored endpoint and collection contents before publication.
 * Runtime repeats these checks when values are read or mutated, but failing
 * while compiling gives authors a precise diagnostic and prevents a package
 * whose very first action must fail from being published at all.
 */
function checkInitialState(initialState, model, networkModels, profile, turnSessionInitialization) {
  if (!isRecord(initialState)) {
    fail("MECHANICS_INITIAL_STATE_SHAPE_INVALID", "/state", "initial game state must be a JSON object");
  }
  const runtimeInitializedEndpoints = checkTurnSessionInitialization(
    initialState,
    model,
    profile,
    turnSessionInitialization
  );
  checkInitialEndpointState(initialState, model, profile, runtimeInitializedEndpoints);
  checkInitialCollectionState(initialState, model, profile);
  checkInitialNetworkState(initialState, model, networkModels);
}

function checkInitialEndpointState(initialState, model, profile, runtimeInitializedEndpoints) {
  for (const [endpointId, endpoint] of Object.entries(model.endpoints)) {
    const endpointPointer = `/stateModel/endpoints/${escapePointer(endpointId)}/storage`;
    for (const location of resolveInitialStorageLocations(initialState, endpoint.storage, endpointPointer)) {
      // Turn fields are mandatory in a live session but intentionally absent
      // from the reusable authoring template. Their exact platform-owned
      // values and declared types were proved by checkTurnSessionInitialization.
      if (location.value === undefined && runtimeInitializedEndpoints.has(endpointId)) continue;
      // Projection-only symbols can point at runtime-materialized convenience
      // branches such as participant order. They are never executable rule
      // inputs; when absent in authoring state there is nothing to validate.
      if (location.value === undefined && endpoint.usage === "projection-only") continue;
      if (!literalMatchesDeclaredType(model, location.value, endpoint.valueType, new Set(), profile)) {
        fail(
          "MECHANICS_INITIAL_STATE_TYPE_MISMATCH",
          location.pointer,
          `initial endpoint does not match declared type "${endpoint.valueType}"`
        );
      }
    }
  }
}

/**
 * Prove the strict live-session shape of the platform-owned turn structure.
 *
 * The authoring document contains one reusable player template, not concrete
 * participant identities. Runtime expands that template and creates
 * state.public.turn before persisting a session. Publication therefore accepts
 * those four absent template values only after proving that the declared
 * executable endpoints can hold every value produced by that initialization.
 */
function checkTurnSessionInitialization(initialState, model, profile, initialization) {
  const initializedEndpointIds = new Set();
  if (initialization === undefined) return initializedEndpointIds;

  const { minimumPlayers, maximumPlayers, phases } = initialization;
  if (
    !Number.isSafeInteger(minimumPlayers) ||
    !Number.isSafeInteger(maximumPlayers) ||
    minimumPlayers < 1 ||
    maximumPlayers < minimumPlayers ||
    !Array.isArray(phases) ||
    phases.length === 0
  ) {
    fail(
      "MECHANICS_TURN_INITIALIZATION_INVALID",
      "/config",
      "turn session initialization requires valid player bounds and at least one phase"
    );
  }

  const participantOrder = (count) =>
    Array.from({ length: count }, (_, index) => `p${index + 1}`);
  const expectedFields = [
    {
      name: "order",
      values: [participantOrder(minimumPlayers), participantOrder(maximumPlayers)]
    },
    { name: "activePlayerId", values: ["p1"] },
    { name: "turnNumber", values: [1] },
    { name: "phase", values: [phases[0]] }
  ];

  for (const expected of expectedFields) {
    const path = ["turn", expected.name];
    const matches = Object.entries(model.endpoints).filter(([, endpoint]) =>
      endpoint.storage.root === "public" &&
      endpoint.storage.segments.length === path.length &&
      endpoint.storage.segments.every((segment, index) => segment === path[index])
    );
    if (matches.length !== 1) {
      fail(
        "MECHANICS_TURN_ENDPOINT_MISSING",
        "/stateModel/endpoints",
        `platform turn field "public.turn.${expected.name}" requires exactly one declared endpoint`
      );
    }

    const [endpointId, endpoint] = matches[0];
    const pointer = `/stateModel/endpoints/${escapePointer(endpointId)}`;
    const declaredType = model.types[endpoint.valueType];
    if (endpoint.usage === "projection-only") {
      fail(
        "MECHANICS_TURN_ENDPOINT_NOT_EXECUTABLE",
        child(pointer, "usage"),
        `platform turn field "public.turn.${expected.name}" must be executable`
      );
    }
    if (declaredType?.kind === "option") {
      fail(
        "MECHANICS_TURN_ENDPOINT_OPTIONAL",
        child(pointer, "valueType"),
        `live-session turn field "public.turn.${expected.name}" cannot be optional`
      );
    }
    for (const value of expected.values) {
      if (!literalMatchesDeclaredType(model, value, endpoint.valueType, new Set(), profile)) {
        fail(
          "MECHANICS_TURN_ENDPOINT_TYPE_MISMATCH",
          child(pointer, "valueType"),
          `declared type cannot hold the platform-initialized value for "public.turn.${expected.name}"`
        );
      }
    }

    const [location] = resolveInitialStorageLocations(initialState, endpoint.storage, child(pointer, "storage"));
    if (location?.value !== undefined) {
      fail(
        "MECHANICS_TURN_STATE_SOURCE_CONFLICT",
        location.pointer,
        `platform-owned field "public.turn.${expected.name}" must not be authored in the reusable state template`
      );
    }
    initializedEndpointIds.add(endpointId);
  }

  return initializedEndpointIds;
}

function checkInitialCollectionState(initialState, model, profile) {
  for (const [collectionId, collection] of Object.entries(model.collections)) {
    const collectionPointer = `/stateModel/collections/${escapePointer(collectionId)}/storage`;
    for (const location of resolveInitialStorageLocations(initialState, collection.storage, collectionPointer)) {
      if (location.value === undefined) continue;
      const entries = initialCollectionEntries(location.value, collection, location.pointer);
      if (entries.length > collection.capacity) {
        fail("MECHANICS_INITIAL_COLLECTION_CAPACITY_EXCEEDED", location.pointer, `initial collection exceeds capacity ${collection.capacity}`);
      }
      if (collection.itemShape === "record") {
        for (const [entityId, item] of entries) {
          checkInitialRecordCollectionItem(item, collection, model, child(location.pointer, entityId), profile);
        }
        continue;
      }
      const facetNames = new Map();
      const attributeNames = new Map();
      for (const [fieldId, field] of Object.entries(collection.fields)) {
        (field.storage.kind === "facet" ? facetNames : attributeNames).set(field.storage.name, { fieldId, field });
      }
      for (const [entityId, entity] of entries) {
        const entityPointer = child(location.pointer, entityId);
        if (!isRecord(entity)) {
          fail("MECHANICS_INITIAL_ENTITY_SHAPE_INVALID", entityPointer, "collection entity must be an object");
        }
        if (typeof entity.objectType !== "string" || !collection.itemTypes.includes(entity.objectType)) {
          fail("MECHANICS_ENTITY_TYPE_MISMATCH", child(entityPointer, "objectType"), "initial entity uses an undeclared object type");
        }
        checkInitialEntityArea(entity.facets, facetNames, model, child(entityPointer, "facets"), "facet", profile);
        checkInitialEntityArea(entity.attributes, attributeNames, model, child(entityPointer, "attributes"), "attribute", profile);
      }
    }
  }
}

/** Validate one closed record-map item through its declared physical paths. */
function checkInitialRecordCollectionItem(item, collection, model, pointer, profile) {
  if (!isRecord(item)) fail("MECHANICS_INITIAL_ENTITY_SHAPE_INVALID", pointer, "record collection item must be an object");
  const root = { children: new Map(), fieldId: undefined };
  for (const [fieldId, field] of Object.entries(collection.fields)) {
    let node = root;
    for (const segment of field.storage.path) {
      if (node.fieldId !== undefined) {
        fail("MECHANICS_RECORD_FIELD_PATH_OVERLAP", `/stateModel/collections/${escapePointer(fieldId)}`, "record field path extends another field");
      }
      if (!node.children.has(segment)) node.children.set(segment, { children: new Map(), fieldId: undefined });
      node = node.children.get(segment);
    }
    if (node.fieldId !== undefined || node.children.size > 0) {
      fail("MECHANICS_RECORD_FIELD_PATH_OVERLAP", `/stateModel/collections/${escapePointer(fieldId)}`, "record field paths overlap");
    }
    node.fieldId = fieldId;
  }
  const visit = (value, node, valuePointer, atRoot) => {
    if (node.fieldId !== undefined) {
      const field = collection.fields[node.fieldId];
      if (!literalMatchesDeclaredType(model, value, field.valueType, new Set(), profile)) {
        fail("MECHANICS_INITIAL_STATE_TYPE_MISMATCH", valuePointer, `record field does not match declared type "${field.valueType}"`);
      }
      return;
    }
    if (!isRecord(value)) fail("MECHANICS_INITIAL_ENTITY_SHAPE_INVALID", valuePointer, "record field parent must be an object");
    for (const [key, childValue] of Object.entries(value)) {
      if (atRoot && collection.stableKey === "id-field" && key === "id") continue;
      const childNode = node.children.get(key);
      if (!childNode) fail("MECHANICS_ENTITY_FIELD_UNDECLARED", child(valuePointer, key), "record collection contains an undeclared path");
      visit(childValue, childNode, child(valuePointer, key), false);
    }
  };
  visit(item, root, pointer, true);
}

function initialCollectionEntries(value, collection, pointer) {
  if (collection.stableKey === "map-key") {
    if (!isRecord(value)) {
      fail("MECHANICS_INITIAL_COLLECTION_SHAPE_INVALID", pointer, "map-key collection must be an object map");
    }
    return Object.entries(value).map(([id, entity]) => {
      if (!isSafeMechanicsIdentifier(id)) {
        fail("MECHANICS_IDENTIFIER_INVALID", child(pointer, id), "initial collection key is not a safe Mechanics identifier");
      }
      return [id, entity];
    });
  }
  if (!Array.isArray(value)) {
    fail("MECHANICS_INITIAL_COLLECTION_SHAPE_INVALID", pointer, "id-field collection must be an array");
  }
  const entries = value.map((entity, index) => {
    if (!isRecord(entity) || !isSafeMechanicsIdentifier(entity.id)) {
      fail("MECHANICS_IDENTIFIER_INVALID", `${pointer}/${index}/id`, "initial collection item requires a safe stable id");
    }
    return [entity.id, entity];
  });
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    fail("MECHANICS_IDENTIFIER_DUPLICATE", pointer, "id-field collection contains duplicate stable ids");
  }
  return entries;
}

function checkInitialEntityArea(value, declared, model, pointer, area, profile) {
  if (value === undefined) return;
  if (!isRecord(value)) fail("MECHANICS_INITIAL_ENTITY_SHAPE_INVALID", pointer, `${area} fields must be an object`);
  for (const [storageName, fieldValue] of Object.entries(value)) {
    const binding = declared.get(storageName);
    if (!binding) {
      fail("MECHANICS_ENTITY_FIELD_UNDECLARED", child(pointer, storageName), `initial entity contains an undeclared ${area} field`);
    }
    if (!literalMatchesDeclaredType(model, fieldValue, binding.field.valueType, new Set(), profile)) {
      fail(
        "MECHANICS_INITIAL_STATE_TYPE_MISMATCH",
        child(pointer, storageName),
        `initial ${area} field does not match declared type "${binding.field.valueType}"`
      );
    }
  }
}

/** Expand the actor placeholder over every authored participant. */
function resolveInitialStorageLocations(initialState, storage, pointer) {
  let locations = [{ value: initialState[storage.root], pointer: `/state/${escapePointer(storage.root)}` }];
  for (const segment of storage.segments) {
    if (typeof segment === "string") {
      locations = locations.map((location) => ({
        value: isRecord(location.value) ? location.value[segment] : undefined,
        pointer: child(location.pointer, segment)
      }));
      continue;
    }
    if (isRecord(segment) && segment.context === "actor") {
      locations = locations.flatMap((location) => isRecord(location.value)
        ? Object.entries(location.value).map(([actorId, value]) => ({ value, pointer: child(location.pointer, actorId) }))
        : []);
      continue;
    }
    // Parameter-derived paths have no canonical value in authored state. The
    // runtime validates the resolved target under the authenticated command.
    return [];
  }
  return locations;
}

/** Capacity facets are mandatory on every initially stored object they govern. */
function checkInitialNetworkState(initialState, model, networkModels) {
  for (const [networkId, network] of Object.entries(networkModels)) {
    const movement = network.movement;
    if (!movement?.capacityStateFacet || !movement.capacityOccupyingStates) continue;
    const collection = model.collections[movement.capacityCollection];
    if (!collection) continue; // The cross-contract binding reports the precise missing collection.
    const pointer = `/networkModels/${escapePointer(networkId)}/movement/capacityStateFacet`;
    for (const location of resolveInitialStorageLocations(initialState, collection.storage, pointer)) {
      if (location.value === undefined) continue;
      for (const [entityId, entity] of initialCollectionEntries(location.value, collection, location.pointer)) {
        if (!isRecord(entity) || !movement.capacityObjectTypes.includes(entity.objectType)) continue;
        const entityPointer = child(location.pointer, entityId);
        if (!isRecord(entity.attributes) || typeof entity.attributes.networkId !== "string") {
          fail(
            "MECHANICS_GRAPH_CAPACITY_NETWORK_MISSING",
            child(child(entityPointer, "attributes"), "networkId"),
            "capacity object must declare its network identity"
          );
        }
        if (entity.attributes.networkId !== networkId) continue;
        if (!isRecord(entity.facets) || entity.facets[movement.capacityStateFacet] === undefined) {
          fail(
            "MECHANICS_GRAPH_CAPACITY_STATE_MISSING",
            child(entityPointer, "facets"),
            `capacity object must declare facet "${movement.capacityStateFacet}"`
          );
        }
      }
    }
  }
}

/**
 * Prove that graph modules use typed state-model symbols, never raw paths.
 * Network declarations remain game content; these cross-contract references
 * are therefore semantic checks that JSON Schema cannot express on its own.
 */
function checkNetworkBindings(networkModels, model) {
  for (const [networkId, network] of Object.entries(networkModels)) {
    const pointer = `/networkModels/${escapePointer(networkId)}`;
    const audience = network.visibility === "public" ? "public" : "server";
    checkNetworkCollectionAudiences(network, audience, model, pointer);
    const nodeCollection = requireCollection(model, network.nodeCollection, `${pointer}/nodeCollection`);
    const edgeCollection = requireCollection(model, network.edgeCollection, `${pointer}/edgeCollection`);
    requireCollectionStorageField(model, nodeCollection, "networkId", "attribute", `${pointer}/nodeCollection`, ["string", "enum"]);
    requireCollectionStorageField(model, edgeCollection, "networkId", "attribute", `${pointer}/edgeCollection`, ["string", "enum"]);
    requireBoundEndpoint(
      model,
      network.sequenceEndpoint,
      `${pointer}/sequenceEndpoint`,
      { audience, writable: true, typeKinds: ["integer"] }
    );
    if (network.roadPlanning?.excludedRegionIdsEndpoint !== undefined) {
      const endpoint = requireBoundEndpoint(
        model,
        network.roadPlanning.excludedRegionIdsEndpoint,
        `${pointer}/roadPlanning/excludedRegionIdsEndpoint`,
        { audience, typeKinds: ["list", "set"] }
      );
      const type = model.types[endpoint.valueType];
      const itemType = type && (type.kind === "list" || type.kind === "set")
        ? model.types[type.itemType]
        : undefined;
      if (!itemType || itemType.kind !== "string") {
        fail(
          "MECHANICS_ENDPOINT_TYPE_MISMATCH",
          `${pointer}/roadPlanning/excludedRegionIdsEndpoint`,
          "excluded regions endpoint must contain strings"
        );
      }
    }
    if (network.movement) checkMovementCapacityBinding(networkId, network.movement, model, pointer);
  }
}

function checkMovementCapacityBinding(networkId, movement, model, networkPointer) {
  const pointer = `${networkPointer}/movement`;
  const vehicleCollection = requireCollection(model, movement.vehicleCollection, `${pointer}/vehicleCollection`);
  checkCollectionObjectTypes(vehicleCollection, movement.vehicleObjectTypes, `${pointer}/vehicleObjectTypes`);
  requireCollectionStorageField(model, vehicleCollection, "networkId", "attribute", `${pointer}/vehicleCollection`, ["string", "enum"]);
  requireCollectionStorageField(model, vehicleCollection, movement.locationAttribute, "attribute", `${pointer}/locationAttribute`, ["string", "enum"], true);
  if (movement.vehicleStateFacet && movement.movableVehicleStates) {
    const vehicleState = requireCollectionStorageField(
      model,
      vehicleCollection,
      movement.vehicleStateFacet,
      "facet",
      `${pointer}/vehicleStateFacet`
    );
    checkDeclaredFacetValues(model, movement.movableVehicleStates, vehicleState, `${pointer}/movableVehicleStates`, networkId);
  }

  const collection = requireCollection(model, movement.capacityCollection, `${pointer}/capacityCollection`);
  for (const [index, objectType] of movement.capacityObjectTypes.entries()) {
    if (!collection.itemTypes.includes(objectType)) {
      fail(
        "MECHANICS_GRAPH_CAPACITY_TYPE_MISMATCH",
        `${pointer}/capacityObjectTypes/${index}`,
        `capacity object type is outside collection "${movement.capacityCollection}"`
      );
    }
  }
  requireCollectionStorageField(model, collection, "networkId", "attribute", `${pointer}/capacityCollection`, ["string", "enum"]);
  requireCollectionStorageField(
    model,
    collection,
    movement.capacityLocationAttribute,
    "attribute",
    `${pointer}/capacityLocationAttribute`,
    ["string", "enum"]
  );
  if (movement.capacityStateFacet && movement.capacityOccupyingStates) {
    const field = requireCollectionStorageField(
      model,
      collection,
      movement.capacityStateFacet,
      "facet",
      `${pointer}/capacityStateFacet`
    );
    checkDeclaredFacetValues(model, movement.capacityOccupyingStates, field, `${pointer}/capacityOccupyingStates`, networkId);
  }

  const coupledCollection = requireCollection(model, movement.coupledCollection, `${pointer}/coupledCollection`);
  checkCollectionObjectTypes(coupledCollection, movement.coupledObjectTypes, `${pointer}/coupledObjectTypes`);
  requireCollectionStorageField(model, coupledCollection, "networkId", "attribute", `${pointer}/coupledCollection`, ["string", "enum"]);
  requireCollectionStorageField(
    model,
    coupledCollection,
    movement.coupledVehicleAttribute,
    "attribute",
    `${pointer}/coupledVehicleAttribute`,
    ["string", "enum"],
    true
  );
  requireCollectionStorageField(
    model,
    coupledCollection,
    movement.coupledLocationAttribute,
    "attribute",
    `${pointer}/coupledLocationAttribute`,
    ["string", "enum"],
    true
  );
  if (movement.coupledStateFacet && movement.couplableVehicleStates) {
    const coupledState = requireCollectionStorageField(
      model,
      coupledCollection,
      movement.coupledStateFacet,
      "facet",
      `${pointer}/coupledStateFacet`
    );
    checkDeclaredFacetValues(model, movement.couplableVehicleStates, coupledState, `${pointer}/couplableVehicleStates`, networkId);
  }
}

/** All collections used by one graph share its declared confidentiality. */
function checkNetworkCollectionAudiences(network, audience, model, pointer) {
  const visit = (value, key = "", valuePointer = pointer) => {
    if (typeof value === "string" && /Collection$/u.test(key)) {
      const collection = requireCollection(model, value, valuePointer);
      if (collection.audienceRef !== audience) {
        fail(
          "MECHANICS_GRAPH_COLLECTION_AUDIENCE_MISMATCH",
          valuePointer,
          `network collection must use ${audience} audience`
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, key, `${valuePointer}/${index}`));
    } else if (isRecord(value)) {
      Object.entries(value).forEach(([childKey, childValue]) =>
        visit(childValue, childKey, child(valuePointer, childKey)));
    }
  };
  visit(network);
}

function checkCollectionObjectTypes(collection, objectTypes, pointer) {
  if (collection.itemShape === "record") {
    fail("MECHANICS_COLLECTION_ITEM_SHAPE_MISMATCH", pointer, "network bindings require an entity collection");
  }
  for (const [index, objectType] of objectTypes.entries()) {
    if (!collection.itemTypes.includes(objectType)) {
      fail(
        "MECHANICS_GRAPH_COLLECTION_TYPE_MISMATCH",
        `${pointer}/${index}`,
        "network object type is outside its declared Mechanics collection"
      );
    }
  }
}

/** Resolve a network model's physical facet/attribute name to a typed field. */
function requireCollectionStorageField(model, collection, storageName, storageKind, pointer, expectedKinds, writable = false) {
  const field = Object.values(collection.fields).find((candidate) =>
    candidate.storage.kind === storageKind && candidate.storage.name === storageName);
  if (!field) {
    fail(
      storageKind === "facet" ? "MECHANICS_GRAPH_CAPACITY_FACET_UNKNOWN" : "MECHANICS_GRAPH_ATTRIBUTE_UNKNOWN",
      pointer,
      `field "${String(storageName)}" is not declared by the bound collection`
    );
  }
  if (writable && field.access !== "read-write") {
    fail("MECHANICS_GRAPH_FIELD_READ_ONLY", pointer, `field "${String(storageName)}" must be writable`);
  }
  if (expectedKinds) {
    const kinds = declaredTypeKinds(model, field.valueType);
    if (!expectedKinds.some((kind) => kinds.includes(kind))) {
      fail(
        "MECHANICS_GRAPH_ATTRIBUTE_TYPE_MISMATCH",
        pointer,
        `field "${String(storageName)}" must use ${expectedKinds.join(" or ")}`
      );
    }
  }
  return field;
}

function declaredTypeKinds(model, typeRef) {
  const type = model.types[typeRef];
  if (!type) return [];
  return type.kind === "option"
    ? ["option", ...declaredTypeKinds(model, type.itemType)]
    : [type.kind];
}

function checkDeclaredFacetValues(model, values, field, pointer, networkId) {
  for (const [index, state] of values.entries()) {
    if (!literalMatchesDeclaredType(model, state, field.valueType, new Set())) {
      fail(
        "MECHANICS_GRAPH_CAPACITY_STATE_TYPE_MISMATCH",
        `${pointer}/${index}`,
        `state does not match facet type "${field.valueType}" for graph "${networkId}"`
      );
    }
  }
}

function requireBoundEndpoint(model, endpointId, pointer, options) {
  const endpoint = requireEndpoint(model, endpointId, pointer, Boolean(options.writable));
  if (endpoint.storage.segments.some((segment) => isRecord(segment) && segment.binding !== undefined)) {
    fail(
      "MECHANICS_STATE_BINDING_MISSING",
      pointer,
      "network endpoint references cannot target dynamically bound storage"
    );
  }
  if (endpoint.audienceRef !== options.audience) {
    fail("MECHANICS_ENDPOINT_AUDIENCE_MISMATCH", pointer, `endpoint must use ${options.audience} audience`);
  }
  const type = model.types[endpoint.valueType];
  if (!type || !options.typeKinds.includes(type.kind)) {
    fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", pointer, `endpoint must use type kind ${options.typeKinds.join(" or ")}`);
  }
  return endpoint;
}

function checkModuleLock(moduleLock) {
  const identities = new Map();
  const locked = new Map();
  for (const [alias, lock] of Object.entries(moduleLock)) {
    const pointer = `/moduleLock/${escapePointer(alias)}`;
    const previous = identities.get(lock.moduleId);
    if (previous) {
      fail("MECHANICS_MODULE_DUPLICATE", pointer, `moduleId "${lock.moduleId}" is already locked as "${previous}"`);
    }
    identities.set(lock.moduleId, alias);
    const descriptor = MODULE_REGISTRY.get(lock.moduleId);
    if (!descriptor) fail("MECHANICS_MODULE_UNKNOWN", child(pointer, "moduleId"), `unknown module "${lock.moduleId}"`);
    if (lock.moduleVersion !== descriptor.moduleVersion) {
      fail("MECHANICS_MODULE_VERSION_MISMATCH", child(pointer, "moduleVersion"), `expected ${descriptor.moduleVersion}`);
    }
    if (lock.artifactHash !== descriptor.artifactHash) {
      fail("MECHANICS_MODULE_HASH_MISMATCH", child(pointer, "artifactHash"), `artifact does not match the platform registry`);
    }
    const actualAlgorithms = lock.algorithmVersions || {};
    const expectedAlgorithms = descriptor.algorithmVersions;
    if (JSON.stringify(sortedEntries(actualAlgorithms)) !== JSON.stringify(sortedEntries(expectedAlgorithms))) {
      fail(
        "MECHANICS_MODULE_ALGORITHM_MISMATCH",
        child(pointer, "algorithmVersions"),
        `algorithm versions must exactly match the registered module descriptor`
      );
    }
    locked.set(lock.moduleId, descriptor);
  }
  return locked;
}

function createModel(stateModel) {
  const typeIds = new Set(Object.keys(stateModel.types));
  for (const [typeId, type] of Object.entries(stateModel.types)) {
    const pointer = `/stateModel/types/${escapePointer(typeId)}`;
    for (const ref of referencedTypes(type)) {
      if (!typeIds.has(ref)) fail("MECHANICS_TYPE_REF_UNKNOWN", pointer, `unknown type "${ref}"`);
    }
    if (type.kind === "integer" && type.minimum > type.maximum) {
      fail("MECHANICS_TYPE_RANGE_INVALID", pointer, "integer minimum exceeds maximum");
    }
    if (type.kind === "decimal" && compareDecimal(type.minimum, type.maximum) > 0) {
      fail("MECHANICS_TYPE_RANGE_INVALID", pointer, "decimal minimum exceeds maximum");
    }
  }
  for (const [endpointId, endpoint] of Object.entries(stateModel.endpoints)) {
    const pointer = `/stateModel/endpoints/${escapePointer(endpointId)}`;
    requireType(typeIds, endpoint.valueType, child(pointer, "valueType"));
    checkAudienceStorage(endpoint.audienceRef, endpoint.storage, child(pointer, "storage"));
  }
  for (const [collectionId, collection] of Object.entries(stateModel.collections)) {
    const pointer = `/stateModel/collections/${escapePointer(collectionId)}`;
    checkAudienceStorage(collection.audienceRef, collection.storage, child(pointer, "storage"));
    if (collection.storage.segments.some((segment) => isRecord(segment) && segment.binding !== undefined)) {
      fail(
        "MECHANICS_COLLECTION_STORAGE_BINDING_UNSUPPORTED",
        child(pointer, "storage"),
        "collection storage cannot use a dynamic binding because collection references have no binding carrier"
      );
    }
    for (const [fieldId, field] of Object.entries(collection.fields)) {
      requireType(typeIds, field.valueType, child(child(pointer, "fields"), fieldId));
    }
    if (collection.itemShape === "record") checkRecordCollectionFieldPaths(collection, pointer);
  }
  for (const [eventId, event] of Object.entries(stateModel.events)) {
    const pointer = `/stateModel/events/${escapePointer(eventId)}`;
    requireType(typeIds, event.payloadType, `${pointer}/payloadType`);
    if (stateModel.types[event.payloadType]?.kind !== "record") {
      fail("MECHANICS_EVENT_PAYLOAD_TYPE_MISMATCH", `${pointer}/payloadType`, "event payload must be a record type");
    }
    if (event.journalEndpoint !== undefined) {
      const endpointId = event.journalEndpoint.endpoint;
      const endpoint = stateModel.endpoints[endpointId];
      if (!endpoint) fail("MECHANICS_ENDPOINT_REF_UNKNOWN", `${pointer}/journalEndpoint/endpoint`, `unknown endpoint "${endpointId}"`);
      if (endpoint.access !== "read-write") fail("MECHANICS_ENDPOINT_READ_ONLY", `${pointer}/journalEndpoint/endpoint`, "event journal must be writable");
      if (endpoint.audienceRef !== event.audienceRef) {
        fail("MECHANICS_EVENT_JOURNAL_AUDIENCE_MISMATCH", `${pointer}/journalEndpoint/endpoint`, "event journal audience differs from its event declaration");
      }
      const endpointType = stateModel.types[endpoint.valueType];
      if (!endpointType || endpointType.kind !== "list") {
        fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/journalEndpoint/endpoint`, "event journal endpoint must have a list type");
      }
      if (endpointType && stateModel.types[endpointType.itemType]?.kind !== "record") {
        fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/journalEndpoint/endpoint`, "event journal items must use a record type");
      }
    }
  }
  checkStorageAudienceOverlaps(stateModel);
  return {
    types: stateModel.types,
    endpoints: stateModel.endpoints,
    collections: stateModel.collections,
    events: stateModel.events
  };
}

function checkRecordCollectionFieldPaths(collection, pointer) {
  const paths = Object.entries(collection.fields).map(([fieldId, field]) => ({ fieldId, path: field.storage.path }));
  for (let leftIndex = 0; leftIndex < paths.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < paths.length; rightIndex += 1) {
      const left = paths[leftIndex];
      const right = paths[rightIndex];
      const minimum = Math.min(left.path.length, right.path.length);
      if (left.path.slice(0, minimum).every((segment, index) => segment === right.path[index])) {
        fail(
          "MECHANICS_RECORD_FIELD_PATH_OVERLAP",
          `${pointer}/fields/${escapePointer(right.fieldId)}/storage/path`,
          `record field path overlaps field "${left.fieldId}"`
        );
      }
    }
  }
}

function referencedTypes(type) {
  if (type.kind === "record") return Object.values(type.fields).map((field) => field.typeRef);
  if (type.kind === "list" || type.kind === "set" || type.kind === "option") return [type.itemType];
  if (type.kind === "map") return [type.valueType];
  return [];
}

function requireType(typeIds, typeRef, pointer) {
  if (!typeIds.has(typeRef)) fail("MECHANICS_TYPE_REF_UNKNOWN", pointer, `unknown type "${typeRef}"`);
}

function checkAudienceStorage(audience, storage, pointer) {
  const compatible = audience === "public"
    // Visibility is a logical contract, not an accidental property of the
    // physical JSON root. Public per-participant scoreboards may be stored in
    // `players/{actor}` for efficient mutation while remaining public by
    // declaration and projection.
    ? storage.root === "public" || (storage.root === "players" && storage.segments.some(
      (segment) => isRecord(segment) && (segment.context === "actor" || typeof segment.binding === "string")
    ))
    : audience === "actor"
      ? storage.root === "players" && storage.segments.some((segment) => isRecord(segment) && segment.context === "actor")
      : storage.root === "secret";
  if (!compatible) {
    fail("MECHANICS_AUDIENCE_STORAGE_MISMATCH", pointer, `storage root does not match ${audience} audience`);
  }
}

/**
 * A broad executable symbol must not contain a more restrictive symbol.
 * Projection can remove a known child, but reading the broad parent inside a
 * Mechanics expression would already have imported that child into a less
 * restrictive value. Sibling paths remain valid and support public scores
 * beside actor-private hands.
 */
function checkStorageAudienceOverlaps(stateModel) {
  const symbols = [
    ...Object.entries(stateModel.endpoints)
      .filter(([, value]) => value.usage !== "projection-only")
      .map(([id, value]) => ({ kind: "endpoints", id, ...value })),
    ...Object.entries(stateModel.collections).map(([id, value]) => ({ kind: "collections", id, ...value }))
  ];
  for (let leftIndex = 0; leftIndex < symbols.length; leftIndex += 1) {
    const left = symbols[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < symbols.length; rightIndex += 1) {
      const right = symbols[rightIndex];
      if (left.audienceRef === right.audienceRef) continue;
      if (!storagePathsOverlapByContainment(left.storage, right.storage)) continue;
      fail(
        "MECHANICS_STORAGE_AUDIENCE_OVERLAP",
        `/stateModel/${left.kind}/${escapePointer(left.id)}/storage`,
        `storage overlaps ${right.kind} "${right.id}" with ${right.audienceRef} audience`
      );
    }
  }
}

function storagePathsOverlapByContainment(left, right) {
  if (left.root !== right.root) return false;
  const shorter = left.segments.length <= right.segments.length ? left.segments : right.segments;
  const longer = shorter === left.segments ? right.segments : left.segments;
  return shorter.every((segment, index) => storageSegmentsMayMatch(segment, longer[index]));
}

function storageSegmentsMayMatch(left, right) {
  if (typeof left === "string" && typeof right === "string") return left === right;
  // Actor- and parameter-derived segments are both dynamic path positions.
  // Treating their possible values as overlapping is the safe publication
  // rule; a game that needs a join declares separate typed endpoints instead.
  return isRecord(left) || isRecord(right);
}

function storageUsesActorContext(storage) {
  return storage.segments.some((segment) => isRecord(segment) && segment.context === "actor");
}

/**
 * An internal principal is deliberately not impersonated as a game
 * participant. Reject every actor-dependent state symbol up front, including
 * collections reached indirectly through a network declaration.
 */
function assertSystemPlanHasNoActorContext(value, model, networkModels, pointer) {
  const seenNetworks = new Set();
  const visit = (current, currentPointer, key) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPointer}/${index}`, String(index)));
      return;
    }
    if (!isRecord(current)) {
      if (typeof current === "string" && model.collections[current] &&
          storageUsesActorContext(model.collections[current].storage) &&
          /(?:^collection$|Collection$|^sourceCollection$)/u.test(key)) {
        fail(
          "MECHANICS_SYSTEM_CONTEXT_INVALID",
          currentPointer,
          `system intent cannot access actor-scoped collection "${current}"`
        );
      }
      if (key === "networkId" && typeof current === "string" && networkModels[current] && !seenNetworks.has(current)) {
        seenNetworks.add(current);
        visit(networkModels[current], currentPointer, "network");
      }
      return;
    }
    if (current.op === "value.actor" || current.op === "predicate.actor.active") {
      fail(
        "MECHANICS_SYSTEM_CONTEXT_INVALID",
        currentPointer,
        "system intent cannot use game participant actor context"
      );
    }
    if (typeof current.endpoint === "string") {
      const endpoint = model.endpoints[current.endpoint];
      if (endpoint && storageUsesActorContext(endpoint.storage)) {
        fail(
          "MECHANICS_SYSTEM_CONTEXT_INVALID",
          `${currentPointer}/endpoint`,
          `system intent cannot access actor-scoped endpoint "${current.endpoint}"`
        );
      }
    }
    if (typeof current.collection === "string") {
      const collection = model.collections[current.collection];
      if (collection && storageUsesActorContext(collection.storage)) {
        fail(
          "MECHANICS_SYSTEM_CONTEXT_INVALID",
          `${currentPointer}/collection`,
          `system intent cannot access actor-scoped collection "${current.collection}"`
        );
      }
    }
    Object.entries(current).forEach(([childKey, childValue]) =>
      visit(childValue, child(currentPointer, childKey), childKey));
  };
  visit(value, pointer, "");
}

function checkPlan(
  planId,
  plan,
  model,
  lockedModules,
  profile,
  networkModels,
  parameters,
  planInvocation,
  actions,
  scheduleRegistrations
) {
  const planPointer = `/plans/${escapePointer(planId)}`;
  if (planInvocation === "system") {
    assertSystemPlanHasNoActorContext(plan.transaction, model, networkModels, `${planPointer}/transaction`);
  }
  const results = new Map();
  const cost = { steps: 0, expressionNodes: 0, scannedEntities: 0, resultEntities: 0, writes: 0, weightedCost: 0 };
  for (const [index, step] of plan.transaction.steps.entries()) {
    const pointer = `${planPointer}/transaction/steps/${index}`;
    if (results.has(step.id)) fail("MECHANICS_STEP_ID_DUPLICATE", child(pointer, "id"), `duplicate step id "${step.id}"`);
    const moduleId = OPERATION_MODULES.get(step.op);
    if (!moduleId) fail("MECHANICS_OPERATION_UNKNOWN", child(pointer, "op"), `operation "${step.op}" is not registered`);
    if (!lockedModules.has(moduleId)) {
      fail("MECHANICS_MODULE_NOT_LOCKED", child(pointer, "op"), `operation requires locked module "${moduleId}"`);
    }
    const context = {
      model,
      results,
      pointer,
      currentCollection: undefined,
      cost,
      parameters,
      planInvocation,
      actions,
      scheduleRegistrations,
      evaluationDepth: 0,
      networkModels,
      controlFlow: step.when
        ? checkPredicate(step.when, {
            model,
            results,
            pointer,
            currentCollection: undefined,
            cost,
            parameters,
            planInvocation,
            actions,
            scheduleRegistrations,
            evaluationDepth: 0,
            networkModels
          }, child(pointer, "when"))
        : PUBLIC_MANIFEST_FLOW
    };
    const result = checkStep(step, context);
    results.set(step.id, result);
    cost.steps += 1;
  }
  cost.weightedCost = cost.steps + cost.expressionNodes + cost.scannedEntities * 2 + cost.resultEntities + cost.writes * 3;
  assertCostWithinProfile(cost, profile, planPointer);
  return cost;
}

function assertCostWithinProfile(cost, profile, pointer, code = "MECHANICS_STATIC_BUDGET_EXCEEDED") {
  for (const [field, limitField] of [
    ["steps", "maxSteps"],
    ["expressionNodes", "maxExpressionNodes"],
    ["scannedEntities", "maxScannedEntities"],
    ["resultEntities", "maxResultEntities"],
    ["writes", "maxWrites"],
    ["weightedCost", "maxWeightedCost"]
  ]) {
    if (cost[field] > profile[limitField]) {
      fail(code, pointer, `${field} ${cost[field]} exceeds ${profile[limitField]}`);
    }
  }
}

/**
 * Runtime executes the replayed trigger as one synthetic core.assert directly
 * before the system target in one executor context. Publication therefore
 * proves the sum, not merely two independently valid plans.
 */
function checkCombinedSystemScheduleBudgets(registrations, actions, costs, profile) {
  for (const registration of registrations) {
    const targetPlanId = actions[registration.actionId]?.binding?.planRef;
    const target = costs[targetPlanId];
    if (!target) {
      fail(
        "MECHANICS_SCHEDULE_ACTION_INVALID",
        `${registration.pointer}/actionId`,
        "scheduled system intent has no checked target plan"
      );
    }
    const combined = {
      steps: target.steps + 1,
      expressionNodes: target.expressionNodes + registration.triggerCost.expressionNodes,
      scannedEntities: target.scannedEntities + registration.triggerCost.scannedEntities,
      resultEntities: target.resultEntities + registration.triggerCost.resultEntities,
      writes: target.writes + registration.triggerCost.writes
    };
    combined.weightedCost = combined.steps + combined.expressionNodes +
      combined.scannedEntities * 2 + combined.resultEntities + combined.writes * 3;
    assertCostWithinProfile(
      combined,
      profile,
      registration.pointer,
      "MECHANICS_SCHEDULE_COMBINED_BUDGET_EXCEEDED"
    );
  }
}

function assertExternalScheduleMutation(context, pointer) {
  if (context.planInvocation !== "external") {
    fail(
      "MECHANICS_SCHEDULE_INVOCATION_INVALID",
      pointer,
      "schedule mutations are allowed only in plans bound to external intents"
    );
  }
}

/**
 * A persisted trigger is replayed without its originating transaction. It
 * may use only its own captured scalar parameters and authoritative state.
 */
function assertReplaySafeScheduleTrigger(value, pointer) {
  const visit = (current, currentPointer) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${currentPointer}/${index}`));
      return;
    }
    if (!isRecord(current)) return;
    if (["value.actor", "value.item", "value.result", "predicate.actor.active"].includes(current.op)) {
      fail(
        "MECHANICS_SCHEDULE_TRIGGER_CONTEXT_INVALID",
        currentPointer,
        `persisted trigger cannot use replay-unsafe expression "${current.op}"`
      );
    }
    Object.entries(current).forEach(([key, childValue]) =>
      visit(childValue, child(currentPointer, key)));
  };
  visit(value, pointer);
}

function assertExpressionFitsActionParamSchema(model, actual, expression, schema, pointer) {
  const expected = parameterTypeFromSchema(schema, true).value;
  const kinds = expressionTypeKinds(model, actual);
  const compatible = expected === "decimal"
    ? kinds.includes("integer") || kinds.includes("decimal")
    : kinds.includes(expected);
  if (!kinds.includes("unknown") && !compatible) {
    fail(
      "MECHANICS_SCHEDULE_PARAM_TYPE_MISMATCH",
      pointer,
      `scheduled parameter must match action schema type "${schema.type}"`
    );
  }
  if (expression.op === "value.literal" && !literalMatchesActionParamSchema(expression.value, schema)) {
    fail(
      "MECHANICS_SCHEDULE_PARAM_VALUE_INVALID",
      pointer,
      "scheduled literal violates the target action parameter schema"
    );
  }
}

function literalMatchesActionParamSchema(value, schema) {
  if (schema.type === "integer" && !Number.isSafeInteger(value)) return false;
  if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return false;
  if (schema.type === "string" && typeof value !== "string") return false;
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !Object.is(schema.const, value)) return false;
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) return false;
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) return false;
    if (typeof schema.multipleOf === "number" &&
        Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) > Number.EPSILON * 8) return false;
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && [...value].length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && [...value].length > schema.maxLength) return false;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return false;
  }
  return true;
}

function checkStep(step, context) {
  const { model, results, pointer, cost } = context;
  switch (step.op) {
    case "core.assert":
      checkPredicate(step.predicate, context, child(pointer, "predicate"));
      return { kind: "assert", max: 0 };
    case "core.entities.select": {
      const collection = requireCollection(model, step.selector.collection, `${pointer}/selector/collection`);
      if (step.selector.within) {
        const prior = requireResult(results, step.selector.within.stepId, `${pointer}/selector/within/stepId`);
        if (prior.kind !== "entities" || prior.collection !== step.selector.collection) {
          fail("MECHANICS_RESULT_TYPE_MISMATCH", `${pointer}/selector/within`, "within must reference an entity selection from the same collection");
        }
      }
      const selectorFlow = checkSelector(
        step.selector,
        collection,
        { ...context, currentCollection: collection },
        `${pointer}/selector`
      );
      const sourceMax = step.selector.within
        ? results.get(step.selector.within.stepId).max
        : collection.capacity;
      const max = Math.min(sourceMax, step.selector.cardinality.max);
      if (step.selector.cardinality.min > max) {
        fail("MECHANICS_CARDINALITY_IMPOSSIBLE", `${pointer}/selector/cardinality`, "minimum exceeds statically possible result size");
      }
      cost.scannedEntities += sourceMax;
      cost.resultEntities += max;
      return {
        kind: "entities",
        collection: step.selector.collection,
        max,
        type: { kind: "entities", collection: step.selector.collection },
        flow: joinFlows({ audience: collection.audienceRef, integrity: "server" }, selectorFlow)
      };
    }
    case "core.collection.id.allocate": {
      const collection = requireCollection(model, step.collection, `${pointer}/collection`);
      const sequence = requireNumericStateReference(step.sequence, context, `${pointer}/sequence`, true);
      if (model.types[sequence.valueType]?.kind !== "integer") {
        fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/sequence`, "collection id sequence must be an integer endpoint");
      }
      assertFlowToAudience(
        joinFlows(context.controlFlow, { audience: collection.audienceRef, integrity: "server" }),
        sequence.audienceRef,
        pointer
      );
      cost.scannedEntities += collection.capacity;
      cost.writes += 1;
      return {
        kind: "allocated-id",
        max: 1,
        paths: new Map([
          ["id", { kind: "primitive", value: "string" }],
          ["sequence", { kind: "primitive", value: "integer" }]
        ]),
        flow: joinFlows(
          { audience: collection.audienceRef, integrity: "server" },
          sequence.bindingFlow,
          { audience: sequence.audienceRef, integrity: "server" }
        )
      };
    }
    case "core.sequence.next": {
      const items = checkExpression(step.items, context, `${pointer}/items`);
      assertExpressionFitsKinds(model, items.type, ["list", "set"], `${pointer}/items`);
      const current = checkExpression(step.current, context, `${pointer}/current`);
      assertExpressionFitsKinds(model, current.type, ["string", "enum"], `${pointer}/current`);
      const flows = [items.flow, current.flow];
      if (step.exclude) {
        const collection = requireCollection(model, step.exclude.collection, `${pointer}/exclude/collection`);
        const field = requireCollectionField(collection, step.exclude.field, `${pointer}/exclude/field`);
        for (const [index, value] of step.exclude.values.entries()) {
          const checked = checkExpression(value, context, `${pointer}/exclude/values/${index}`);
          assertExpressionFitsType(model, checked.type, field.valueType, `${pointer}/exclude/values/${index}`);
          flows.push(checked.flow);
        }
        flows.push({ audience: collection.audienceRef, integrity: "server" });
        cost.scannedEntities += collection.capacity;
      }
      return {
        kind: "sequence-item",
        max: 1,
        type: { kind: "primitive", value: "string" },
        flow: joinFlows(...flows)
      };
    }
    case "core.state.patch":
      for (const [index, patch] of step.patches.entries()) {
        const endpoint = checkStateReference(patch.target, context, `${pointer}/patches/${index}/target`, true).endpoint;
        const endpointType = model.types[endpoint.valueType];
        if (patch.operation === "remove" && endpointType?.kind !== "option") {
          fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/patches/${index}/target/endpoint`, "remove requires an optional endpoint");
        }
        if (patch.operation === "increment" && endpointType?.kind !== "integer" && endpointType?.kind !== "decimal") {
          fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/patches/${index}/target/endpoint`, "increment requires a numeric endpoint");
        }
        if (patch.operation === "append" && endpointType?.kind !== "list") {
          fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/patches/${index}/target/endpoint`, "append requires a list endpoint");
        }
        const value = patch.value
          ? checkExpression(patch.value, context, `${pointer}/patches/${index}/value`)
          : undefined;
        if (value) {
          const expectedType = patch.operation === "append" && endpointType?.kind === "list"
            ? endpointType.itemType
            : endpoint.valueType;
          assertExpressionFitsType(model, value.type, expectedType, `${pointer}/patches/${index}/value`);
        }
        assertFlowToAudience(
          joinFlows(context.controlFlow, endpoint.bindingFlow, value?.flow),
          endpoint.audienceRef,
          `${pointer}/patches/${index}`
        );
        if ((patch.operation === "increment" || patch.operation === "append") && endpoint.access !== "read-write") {
          fail("MECHANICS_ENDPOINT_READ_ONLY", `${pointer}/patches/${index}/target`, "target is not writable");
        }
        cost.writes += 1;
      }
      return { kind: "command", max: 0 };
    case "core.number.add":
      {
        const endpoint = requireNumericStateReference(step.target, context, `${pointer}/target`, true);
        const delta = checkExpression(step.delta, context, `${pointer}/delta`);
        assertExpressionFitsKinds(model, delta.type, ["integer", "decimal"], `${pointer}/delta`);
        assertFlowToAudience(joinFlows(context.controlFlow, endpoint.bindingFlow, delta.flow), endpoint.audienceRef, pointer);
      }
      cost.writes += 1;
      return { kind: "command", max: 0 };
    case "core.resource.transfer":
      {
        const sinkAudiences = [];
        const sourceFlows = [];
        for (const [name, endpointRef] of [["from", step.from], ["to", step.to]]) {
          if (endpointRef.kind === "state") {
            const endpoint = requireNumericStateReference(endpointRef.target, context, `${pointer}/${name}/target`, true);
            sinkAudiences.push(endpoint.audienceRef);
            sourceFlows.push(endpoint.bindingFlow, { audience: endpoint.audienceRef, integrity: "server" });
          }
          if (endpointRef.kind === "entity-field") {
            const collection = requireEntityRef(endpointRef.entity, context, `${pointer}/${name}/entity`);
            const field = requireCollectionField(collection, endpointRef.field, `${pointer}/${name}/field`, true);
            if (!declaredTypeKinds(model, field.valueType).some((kind) => kind === "integer" || kind === "decimal")) {
              fail("MECHANICS_FIELD_TYPE_MISMATCH", `${pointer}/${name}/field`, "resource field must be numeric");
            }
            sourceFlows.push(
              { audience: collection.audienceRef, integrity: "server" },
              checkEntityRefFlow(endpointRef.entity, context, `${pointer}/${name}/entity`)
            );
            sinkAudiences.push(collection.audienceRef);
          }
        }
        const amount = checkExpression(step.amount, context, `${pointer}/amount`);
        assertExpressionFitsKinds(model, amount.type, ["integer", "decimal"], `${pointer}/amount`);
        for (const audience of sinkAudiences) {
          assertFlowToAudience(joinFlows(context.controlFlow, amount.flow, ...sourceFlows), audience, pointer);
        }
      }
      cost.writes += Number(step.from.kind !== "bank") + Number(step.to.kind !== "bank");
      return { kind: "command", max: 0 };
    case "core.collection.append":
      {
        const endpoint = requireStateReferenceKind(step.target, context, `${pointer}/target`, ["list"], true);
        const value = checkExpression(step.value, context, `${pointer}/value`);
        const listType = model.types[endpoint.valueType];
        assertExpressionFitsType(model, value.type, listType.itemType, `${pointer}/value`);
        assertFlowToAudience(joinFlows(context.controlFlow, endpoint.bindingFlow, value.flow), endpoint.audienceRef, pointer);
      }
      cost.writes += 1;
      return { kind: "command", max: 0 };
    case "core.entity.create": {
      const collection = requireCollection(model, step.collection, `${pointer}/collection`);
      if (collection.itemShape === "record") {
        fail("MECHANICS_COLLECTION_ITEM_SHAPE_MISMATCH", `${pointer}/collection`, "entity.create requires an entity collection");
      }
      if (!collection.itemTypes.includes(step.objectType)) {
        fail("MECHANICS_ENTITY_TYPE_MISMATCH", `${pointer}/objectType`, `type is not declared by collection "${step.collection}"`);
      }
      const entityId = checkExpression(step.entityId, context, `${pointer}/entityId`);
      assertExpressionFitsKinds(model, entityId.type, ["string", "enum"], `${pointer}/entityId`);
      assertFlowToAudience(joinFlows(context.controlFlow, entityId.flow), collection.audienceRef, pointer);
      // Creation initializes a detached entity before insertion. A declared
      // read-only field may therefore receive its immutable initial value, but
      // it remains protected from every later mutation operation. The final
      // boolean keeps the ordinary sink information-flow check enabled.
      checkFieldExpressions(step.facets, "facet", collection, context, `${pointer}/facets`, false, undefined, true);
      checkFieldExpressions(step.attributes, "attribute", collection, context, `${pointer}/attributes`, false, undefined, true);
      cost.writes += 1;
      return { kind: "entity", collection: step.collection, max: 1 };
    }
    case "core.entity.facet.set": {
      const collection = requireEntityRef(step.entity, context, `${pointer}/entity`);
      const field = requireField(collection, step.facet, "facet", `${pointer}/facet`, true);
      const entityFlow = checkEntityRefFlow(step.entity, context, `${pointer}/entity`);
      const value = checkExpression(step.value, { ...context, currentCollection: collection }, `${pointer}/value`);
      assertExpressionFitsType(model, value.type, field.valueType, `${pointer}/value`);
      assertFlowToAudience(joinFlows(context.controlFlow, entityFlow, value.flow), collection.audienceRef, pointer);
      cost.writes += 1;
      return { kind: "command", max: 0 };
    }
    case "core.entity.attributes.patch": {
      const collection = requireEntityRef(step.entity, context, `${pointer}/entity`);
      for (const [index, patch] of step.patches.entries()) {
        const field = requireField(collection, patch.path[0], "attribute", `${pointer}/patches/${index}/path/0`, true);
        const value = patch.value
          ? checkExpression(patch.value, { ...context, currentCollection: collection }, `${pointer}/patches/${index}/value`)
          : undefined;
        if (value) assertExpressionFitsType(model, value.type, field.valueType, `${pointer}/patches/${index}/value`);
        assertFlowToAudience(
          joinFlows(context.controlFlow, checkEntityRefFlow(step.entity, context, `${pointer}/entity`), value?.flow),
          collection.audienceRef,
          `${pointer}/patches/${index}`
        );
      }
      cost.writes += step.patches.length;
      return { kind: "command", max: 0 };
    }
    case "core.entities.update": {
      const selection = requireResult(results, step.selection.stepId, `${pointer}/selection/stepId`);
      if (selection.kind !== "entities") fail("MECHANICS_RESULT_TYPE_MISMATCH", `${pointer}/selection`, "selection must reference a query result");
      const collection = requireCollection(model, selection.collection, `${pointer}/selection`);
      const updateContext = {
        ...context,
        currentCollection: collection,
        controlFlow: joinFlows(context.controlFlow, selection.flow)
      };
      checkFieldExpressions(step.facetValues, "facet", collection, updateContext, `${pointer}/facetValues`, true);
      checkFieldExpressions(step.attributeValues, "attribute", collection, updateContext, `${pointer}/attributeValues`, true);
      checkFieldExpressions(step.attributeSetRemovals, "attribute", collection, updateContext, `${pointer}/attributeSetRemovals`, true, "set");
      const changeCount = Object.keys(step.facetValues || {}).length + Object.keys(step.attributeValues || {}).length +
        Object.keys(step.attributeSetRemovals || {}).length;
      cost.writes += selection.max * changeCount;
      return { kind: "command", max: 0 };
    }
    case "core.event.emit": {
      const event = model.events[step.eventType];
      if (!event) fail("MECHANICS_EVENT_REF_UNKNOWN", `${pointer}/eventType`, `unknown event "${step.eventType}"`);
      if (event.audienceRef !== step.audience) fail("MECHANICS_EVENT_AUDIENCE_MISMATCH", `${pointer}/audience`, "event audience differs from its declaration");
      const summary = checkExpression(step.summary, context, `${pointer}/summary`);
      assertExpressionFitsKinds(model, summary.type, ["string"], `${pointer}/summary`);
      const payloadType = model.types[event.payloadType];
      const payloadFlows = [];
      for (const [name, expression] of Object.entries(step.data || {})) {
        const field = payloadType.fields[name];
        if (!field) fail("MECHANICS_EVENT_PAYLOAD_FIELD_UNKNOWN", `${pointer}/data/${escapePointer(name)}`, `event payload does not declare field "${name}"`);
        const checked = checkExpression(expression, context, `${pointer}/data/${escapePointer(name)}`);
        assertExpressionFitsType(model, checked.type, field.typeRef, `${pointer}/data/${escapePointer(name)}`);
        payloadFlows.push(checked.flow);
      }
      for (const [fieldId, field] of Object.entries(payloadType.fields)) {
        if (!field.optional && step.data?.[fieldId] === undefined) {
          fail("MECHANICS_EVENT_PAYLOAD_FIELD_MISSING", `${pointer}/data`, `event payload requires field "${fieldId}"`);
        }
      }
      assertFlowToAudience(
        joinFlows(context.controlFlow, summary.flow, ...payloadFlows),
        event.audienceRef,
        pointer
      );
      if (event.journalEndpoint !== undefined) {
        checkStateReference(event.journalEndpoint, context, `${pointer}/eventType/journalEndpoint`, true);
      }
      cost.writes += event.journalEndpoint === undefined ? 1 : 2;
      return { kind: "event", max: 1 };
    }
    case "random.dice.roll": {
        const endpoint = checkStateReference(step.target, context, `${pointer}/target`, true).endpoint;
        const targetType = model.types[endpoint.valueType];
        const resultTypeRef = targetType?.kind === "option" ? targetType.itemType : endpoint.valueType;
        const resultType = model.types[resultTypeRef];
        if (!resultType || resultType.kind !== "record") {
          fail(
            "MECHANICS_ENDPOINT_TYPE_MISMATCH",
            `${pointer}/target/endpoint`,
            "dice result target must be a record or optional record endpoint (dice, rolls, total)"
          );
        }
        // random.dice.roll is a registered trusted disclosure: it may expose
        // the roll result while the server-only generator state remains
        // hidden. A secret `when` still may not leak through whether it ran.
        assertFlowToAudience(joinFlows(context.controlFlow, endpoint.bindingFlow), endpoint.audienceRef, pointer);
      cost.writes += 2;
      return {
        kind: "random",
        max: 1,
        type: {
          kind: "type-ref",
          ref: model.types[model.endpoints[step.target.endpoint].valueType]?.kind === "option"
            ? model.types[model.endpoints[step.target.endpoint].valueType].itemType
            : model.endpoints[step.target.endpoint].valueType
        },
        flow: joinFlows(
          { audience: model.endpoints[step.target.endpoint].audienceRef, integrity: "module" },
          endpoint.bindingFlow
        )
      };
    }
    case "deck.shuffle": {
      const collection = requireCollection(model, step.sourceCollection, `${pointer}/sourceCollection`);
      // A card catalogue may be public while the generated order remains in
      // server-only deck state. `deck.shuffle` is the trusted boundary that
      // separates those two labels; it never publishes the future order.
      cost.scannedEntities += collection.capacity;
      cost.writes += 1;
      return { kind: "deck", max: 1 };
    }
    case "deck.draw": {
        const endpoint = checkStateReference(step.target, context, `${pointer}/target`, true).endpoint;
        const type = model.types[endpoint.valueType];
        const itemType = type?.kind === "option" ? model.types[type.itemType] : type;
        if (!itemType || itemType.kind !== "string") {
          fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", `${pointer}/target/endpoint`, "deck draw target must be string or optional string");
        }
        // deck.draw is another exact registered disclosure: one allowed card
        // identifier becomes visible, never the remaining deck order.
        assertFlowToAudience(joinFlows(context.controlFlow, endpoint.bindingFlow), endpoint.audienceRef, pointer);
      cost.writes += 2;
      return {
        kind: "deck",
        max: 1,
        type: { kind: "type-ref", ref: model.endpoints[step.target.endpoint].valueType },
        flow: joinFlows(
          { audience: model.endpoints[step.target.endpoint].audienceRef, integrity: "module" },
          endpoint.bindingFlow
        )
      };
    }
    case "turn.phase.select": {
      const phase = checkExpression(step.phase, context, `${pointer}/phase`);
      assertExpressionFitsKinds(model, phase.type, ["string", "enum"], `${pointer}/phase`);
      assertFlowToAudience(joinFlows(context.controlFlow, phase.flow), "public", pointer);
      cost.writes += 1;
      return { kind: "command", max: 0 };
    }
    case "system.schedule.register": {
      assertExternalScheduleMutation(context, pointer);
      const target = context.actions[step.actionId];
      if (!target || target.invocation !== "system") {
        fail(
          "MECHANICS_SCHEDULE_ACTION_INVALID",
          `${pointer}/actionId`,
          `schedule target "${step.actionId}" must be a published system intent`
        );
      }
      const properties = isRecord(target.paramsSchema?.properties) ? target.paramsSchema.properties : {};
      const required = new Set(Array.isArray(target.paramsSchema?.required) ? target.paramsSchema.required : []);
      const parameterFlows = [];
      for (const name of required) {
        if (!Object.prototype.hasOwnProperty.call(step.params, name)) {
          fail(
            "MECHANICS_SCHEDULE_PARAM_MISSING",
            `${pointer}/params`,
            `scheduled system intent requires parameter "${name}"`
          );
        }
      }
      for (const [name, expression] of Object.entries(step.params)) {
        const property = properties[name];
        if (!isRecord(property)) {
          fail(
            "MECHANICS_SCHEDULE_PARAM_UNDECLARED",
            `${pointer}/params/${escapePointer(name)}`,
            `scheduled system intent does not declare parameter "${name}"`
          );
        }
        const checked = checkExpression(expression, context, `${pointer}/params/${escapePointer(name)}`);
        assertExpressionFitsActionParamSchema(
          model,
          checked.type,
          expression,
          property,
          `${pointer}/params/${escapePointer(name)}`
        );
        parameterFlows.push(checked.flow);
      }
      assertReplaySafeScheduleTrigger(step.trigger, `${pointer}/trigger`);
      assertSystemPlanHasNoActorContext(
        step.trigger,
        model,
        context.networkModels,
        `${pointer}/trigger`
      );
      const triggerCostBefore = snapshotStaticCost(cost);
      const triggerParameters = new Map(Object.entries(properties).map(([name, property]) => [
        name,
        parameterTypeFromSchema(property, required.has(name))
      ]));
      const triggerFlow = checkPredicate(step.trigger, {
        ...context,
        parameters: triggerParameters,
        results: new Map(),
        currentCollection: undefined,
        planInvocation: "system",
        evaluationDepth: 0,
        controlFlow: PUBLIC_MANIFEST_FLOW
      }, `${pointer}/trigger`);
      context.scheduleRegistrations.push({
        actionId: step.actionId,
        pointer,
        triggerCost: subtractStaticCost(snapshotStaticCost(cost), triggerCostBefore)
      });
      cost.writes += 1;
      return {
        kind: "schedule-registration",
        max: 1,
        type: { kind: "result", value: "schedule-registration" },
        paths: new Map([["scheduleId", { kind: "primitive", value: "string" }]]),
        flow: joinFlows({ audience: "server", integrity: "module" }, ...parameterFlows, triggerFlow)
      };
    }
    case "system.schedule.cancel": {
      assertExternalScheduleMutation(context, pointer);
      const scheduleId = checkExpression(step.scheduleId, context, `${pointer}/scheduleId`);
      assertExpressionFitsKinds(model, scheduleId.type, ["string", "enum"], `${pointer}/scheduleId`);
      if (step.scheduleId.op === "value.literal" &&
          (typeof step.scheduleId.value !== "string" ||
            !SYSTEM_SCHEDULE_ID_PATTERN.test(step.scheduleId.value))) {
        fail(
          "MECHANICS_SYSTEM_SCHEDULE_ID_INVALID",
          `${pointer}/scheduleId`,
          "literal schedule id must be a 22..128 character base64url value"
        );
      }
      cost.writes += 1;
      return {
        kind: "schedule-cancellation",
        max: 1,
        flow: joinFlows({ audience: "server", integrity: "module" }, scheduleId.flow)
      };
    }
    case "graph.regions.route.plan":
    case "graph.edge.split":
    case "graph.entity.traverse":
    case "graph.shortestPath":
    case "relation.attach":
    case "relation.detach":
      {
        const expressionFlows = checkAllExpressions(step, context, pointer);
        const stateAudiences = domainOperationStateAudiences(step, context);
        const stateFlows = stateAudiences.map((audience) => ({ audience, integrity: "server" }));
        for (const audience of stateAudiences) {
          assertFlowToAudience(
            joinFlows(context.controlFlow, ...expressionFlows, ...stateFlows),
            audience,
            pointer
          );
        }
      }
      cost.scannedEntities += domainCollectionScanUpperBound(step, context);
      cost.writes += domainOperationWriteUpperBound(step);
      return domainOperationResult(step, context);
    case "core.entities.score": {
      const entities = requireStateReferenceKind(step.entities, context, `${pointer}/entities`, ["record"]);
      const entityType = model.types[entities.valueType];
      const flows = [entities.bindingFlow, { audience: entities.audienceRef, integrity: "server" }];
      for (const [index, entityId] of step.entityIds.entries()) {
        const checked = checkExpression(entityId, context, `${pointer}/entityIds/${index}`);
        assertExpressionFitsKinds(model, checked.type, ["string", "enum"], `${pointer}/entityIds/${index}`);
        if (entityId.op !== "value.literal" || typeof entityId.value !== "string") {
          fail(
            "MECHANICS_SCORE_ENTITY_TYPE_UNPROVEN",
            `${pointer}/entityIds/${index}`,
            "score entity id must be a static string so its child record type can be proven"
          );
        }
        const child = entityType.fields[entityId.value];
        const childType = child && model.types[child.typeRef];
        const base = childType?.kind === "record" ? childType.fields[step.baseField] : undefined;
        if (!base || model.types[base.typeRef]?.kind !== "integer") {
          fail(
            "MECHANICS_FIELD_TYPE_MISMATCH",
            `${pointer}/baseField`,
            `score entity "${entityId.value}" must expose base field "${step.baseField}" as a non-optional integer`
          );
        }
        flows.push(checked.flow);
      }
      for (const [index, source] of step.relatedSources.entries()) {
        const sourcePointer = `${pointer}/relatedSources/${index}`;
        const collection = requireCollection(model, source.collection, `${sourcePointer}/collection`);
        const owner = requireCollectionField(collection, source.ownerField, `${sourcePointer}/ownerField`);
        const value = requireCollectionField(collection, source.valueField, `${sourcePointer}/valueField`);
        if (!declaredTypeKinds(model, owner.valueType).some((kind) => kind === "string" || kind === "enum")) {
          fail("MECHANICS_FIELD_TYPE_MISMATCH", `${sourcePointer}/ownerField`, "score owner field must be string or enum");
        }
        if (model.types[value.valueType]?.kind !== "integer") {
          fail("MECHANICS_FIELD_TYPE_MISMATCH", `${sourcePointer}/valueField`, "score value field must be a non-optional integer");
        }
        flows.push({ audience: collection.audienceRef, integrity: "server" });
        cost.scannedEntities += collection.capacity;
      }
      cost.resultEntities += step.entityIds.length;
      return {
        kind: "scores",
        max: step.entityIds.length,
        type: {
          kind: "result",
          value: "scores",
          maxEntries: step.entityIds.length,
          maxRelatedItems: step.relatedSources.reduce(
            (total, source) => total + requireCollection(model, source.collection, `${pointer}/relatedSources`).capacity,
            0
          )
        },
        paths: new Map([["entries", { kind: "list-of", itemKind: "record" }]]),
        flow: joinFlows(...flows)
      };
    }
    case "core.ranking.stable": {
      const scores = checkExpression(step.scores, context, `${pointer}/scores`);
      if (scores.type.kind !== "result" || scores.type.value !== "scores") {
        fail("MECHANICS_RESULT_TYPE_MISMATCH", `${pointer}/scores`, "stable ranking requires a core.entities.score result");
      }
      const flows = [scores.flow];
      let members = 0;
      for (const [groupIndex, group] of step.groups.entries()) {
        for (const [entityIndex, entityId] of group.entityIds.entries()) {
          const checked = checkExpression(entityId, context, `${pointer}/groups/${groupIndex}/entityIds/${entityIndex}`);
          assertExpressionFitsKinds(model, checked.type, ["string", "enum"], `${pointer}/groups/${groupIndex}/entityIds/${entityIndex}`);
          flows.push(checked.flow);
          members += 1;
        }
      }
      cost.resultEntities += members;
      const maxStandings = Math.max(...step.groups.map((group) => group.entityIds.length));
      const relatedItemsMax = scores.type.maxRelatedItems || 0;
      const relatedItemShape = {
        kind: "record",
        fields: {
          entityId: { kind: "string" },
          value: { kind: "integer" }
        }
      };
      const standingShape = {
        kind: "record",
        fields: {
          entityId: { kind: "string" },
          baseValue: { kind: "integer" },
          relatedValue: { kind: "integer" },
          score: { kind: "integer" },
          relatedItems: { kind: "list", item: relatedItemShape, maxItems: relatedItemsMax },
          rank: { kind: "integer" }
        }
      };
      const groupShape = {
        kind: "record",
        fields: {
          standings: { kind: "list", item: standingShape, maxItems: maxStandings },
          winners: { kind: "list", item: { kind: "string" }, maxItems: maxStandings },
          tiedForFirst: { kind: "boolean" }
        }
      };
      const groupsShape = {
        kind: "map",
        value: groupShape,
        maxProperties: step.groups.length
      };
      return {
        kind: "ranking",
        max: members,
        type: {
          kind: "structural",
          shape: {
            kind: "record",
            fields: { groups: groupsShape }
          }
        },
        paths: new Map([["groups", { kind: "structural", shape: groupsShape }]]),
        flow: joinFlows(...flows)
      };
    }
    default:
      fail("MECHANICS_OPERATION_UNKNOWN", `${pointer}/op`, `unsupported operation "${step.op}"`);
  }
}

function snapshotStaticCost(cost) {
  return {
    expressionNodes: cost.expressionNodes,
    scannedEntities: cost.scannedEntities,
    resultEntities: cost.resultEntities,
    writes: cost.writes
  };
}

function subtractStaticCost(after, before) {
  return Object.fromEntries(Object.keys(after).map((field) => [field, after[field] - before[field]]));
}

/**
 * Conservative upper bound for every explicit state-collection traversal in
 * a domain operation. Immutable region geometry is guarded by the road
 * planner's own hard work bounds and is deliberately not called an entity
 * scan here.
 */
function domainCollectionScanUpperBound(step, context) {
  const network = context.networkModels[step.networkId];
  if (!network) {
    fail(
      "MECHANICS_GRAPH_UNKNOWN",
      `${context.pointer}/networkId`,
      `network model "${String(step.networkId)}" is not declared`
    );
  }
  const capacity = (collectionId, segment) =>
    requireCollection(context.model, collectionId, `${context.pointer}/${segment}`).capacity;

  switch (step.op) {
    case "graph.regions.route.plan":
      return capacity(network.edgeCollection, "networkId");
    case "graph.edge.split":
      return capacity(network.nodeCollection, "networkId") + capacity(network.edgeCollection, "networkId");
    case "graph.entity.traverse":
      if (!network.movement) {
        fail("MECHANICS_GRAPH_MOVEMENT_UNDECLARED", `${context.pointer}/networkId`, "network movement is not declared");
      }
      return capacity(network.movement.capacityCollection, "networkId") +
        capacity(network.movement.coupledCollection, "networkId");
    case "relation.attach":
      if (!network.movement) {
        fail("MECHANICS_RELATION_UNDECLARED", `${context.pointer}/networkId`, "network relations are not declared");
      }
      return capacity(network.movement.coupledCollection, "networkId");
    case "relation.detach":
      return 0;
    case "graph.shortestPath":
      return capacity(network.nodeCollection, "networkId") + capacity(network.edgeCollection, "networkId");
    default:
      return 0;
  }
}

function domainOperationWriteUpperBound(step) {
  if (step.op === "graph.regions.route.plan" || step.op === "graph.shortestPath") return 0;
  if (step.op === "graph.edge.split") return 7;
  if (step.op === "graph.entity.traverse") return 65;
  if (step.op === "relation.attach" || step.op === "relation.detach") return step.related.length;
  return 0;
}

function domainOperationResult(step, context) {
  const network = context.networkModels[step.networkId];
  const flow = { audience: network.visibility === "public" ? "public" : "server", integrity: "module" };
  if (step.op === "graph.regions.route.plan") {
    return {
      kind: "graph-route-plan",
      max: 1,
      paths: new Map([
        ["fromNodeId", { kind: "primitive", value: "string" }],
        ["toNodeId", { kind: "primitive", value: "string" }],
        ["geometry", { kind: "json-object" }],
        ["regionSegments", { kind: "primitive", value: "integer" }],
        ["routePlan", { kind: "json-object" }]
      ]),
      flow
    };
  }
  if (step.op === "graph.edge.split") {
    return {
      kind: "graph-edge-split",
      max: 1,
      paths: new Map([
        ["nodeId", { kind: "primitive", value: "string" }],
        ["edgeIds", {
          kind: "tuple",
          items: [
            { kind: "primitive", value: "string" },
            { kind: "primitive", value: "string" }
          ]
        }],
        ["replacedEdgeId", { kind: "primitive", value: "string" }]
      ]),
      flow
    };
  }
  if (step.op === "graph.entity.traverse") {
    return {
      kind: "graph-traversal",
      max: 1,
      paths: new Map([
        ["entityId", { kind: "primitive", value: "string" }],
        ["edgeId", { kind: "primitive", value: "string" }],
        ["fromNodeId", { kind: "primitive", value: "string" }],
        ["toNodeId", { kind: "primitive", value: "string" }],
        ["relatedIds", { kind: "list-of", itemKind: "string" }]
      ]),
      flow
    };
  }
  if (step.op === "graph.shortestPath") {
    return {
      kind: "graph-shortest-path",
      max: 1,
      paths: new Map([
        ["edgeIds", { kind: "list-of", itemKind: "string" }],
        ["nodeIds", { kind: "list-of", itemKind: "string" }],
        ["length", { kind: "primitive", value: "integer" }]
      ]),
      flow
    };
  }
  return {
    kind: "relation",
    max: step.related.length,
    paths: new Map([
      ["primaryId", { kind: "primitive", value: "string" }],
      ["relatedIds", { kind: "list-of", itemKind: "string" }]
    ]),
    flow
  };
}

/**
 * Domain modules declare their state bindings through a network model. The
 * checker derives sink audiences from those bindings instead of embedding
 * game or network identifiers in platform code.
 */
function domainOperationStateAudiences(step, context) {
  const network = context.networkModels[step.networkId];
  if (!network) {
    fail("MECHANICS_GRAPH_UNKNOWN", `${context.pointer}/networkId`, `network model "${String(step.networkId)}" is not declared`);
  }
  const audiences = new Set([network.visibility === "public" ? "public" : "server"]);
  const visit = (value, key = "") => {
    if (typeof value === "string" && /Collection$/u.test(key)) {
      const collection = context.model.collections[value];
      if (collection) audiences.add(collection.audienceRef);
      return;
    }
    if (typeof value === "string" && /Endpoint$/u.test(key)) {
      const endpoint = context.model.endpoints[value];
      if (endpoint) audiences.add(endpoint.audienceRef);
      return;
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, key));
    else if (isRecord(value)) Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
  };
  visit(network);
  return [...audiences];
}

function checkSelector(selector, collection, context, pointer) {
  if (collection.itemShape === "record") {
    fail("MECHANICS_COLLECTION_ITEM_SHAPE_MISMATCH", `${pointer}/collection`, "entity selector requires an entity collection");
  }
  const flows = [{ audience: collection.audienceRef, integrity: "server" }];
  if (selector.objectTypes) {
    for (const objectType of selector.objectTypes) {
      if (!collection.itemTypes.includes(objectType)) fail("MECHANICS_ENTITY_TYPE_MISMATCH", `${pointer}/objectTypes`, `undeclared collection item type "${objectType}"`);
    }
  }
  flows.push(...checkFieldExpressions(selector.facets, "facet", collection, context, `${pointer}/facets`, false));
  for (const [fieldId, condition] of Object.entries(selector.attributes || {})) {
    const field = requireField(collection, fieldId, "attribute", `${pointer}/attributes/${escapePointer(fieldId)}`);
    const expression = isRecord(condition) && typeof condition.operator === "string" ? condition.value : condition;
    const checked = checkExpression(expression, context, `${pointer}/attributes/${escapePointer(fieldId)}`);
    flows.push(checked.flow);
    if (isRecord(condition) && ["contains", "notContains", "isEmpty", "notEmpty"].includes(condition.operator)) {
      const type = context.model.types[field.valueType];
      if (!type || (type.kind !== "set" && type.kind !== "list")) {
        fail("MECHANICS_FIELD_TYPE_MISMATCH", `${pointer}/attributes/${escapePointer(fieldId)}`, `${condition.operator} requires a set or list field`);
      }
      if (!["isEmpty", "notEmpty"].includes(condition.operator)) {
        assertExpressionFitsType(
          context.model,
          checked.type,
          type.itemType,
          `${pointer}/attributes/${escapePointer(fieldId)}`
        );
      }
    } else {
      assertExpressionFitsType(
        context.model,
        checked.type,
        field.valueType,
        `${pointer}/attributes/${escapePointer(fieldId)}`
      );
    }
  }
  return joinFlows(...flows);
}

function checkFieldExpressions(
  values,
  storageKind,
  collection,
  context,
  pointer,
  writable,
  requiredTypeKind,
  initializesState = false
) {
  const flows = [];
  for (const [fieldId, expression] of Object.entries(values || {})) {
    const field = requireField(collection, fieldId, storageKind, `${pointer}/${escapePointer(fieldId)}`, writable);
    if (requiredTypeKind && context.model.types[field.valueType]?.kind !== requiredTypeKind) {
      fail("MECHANICS_FIELD_TYPE_MISMATCH", `${pointer}/${escapePointer(fieldId)}`, `field must have type kind ${requiredTypeKind}`);
    }
    const checked = checkExpression(expression, context, `${pointer}/${escapePointer(fieldId)}`);
    const expectedType = requiredTypeKind === "set"
      ? context.model.types[field.valueType]?.itemType
      : field.valueType;
    if (expectedType) {
      assertExpressionFitsType(context.model, checked.type, expectedType, `${pointer}/${escapePointer(fieldId)}`);
    }
    if (writable || initializesState) {
      assertFlowToAudience(
        joinFlows(context.controlFlow, checked.flow),
        collection.audienceRef,
        `${pointer}/${escapePointer(fieldId)}`
      );
    }
    flows.push(checked.flow);
  }
  return flows;
}

function checkPredicate(predicate, context, pointer) {
  context = enterEvaluationContext(context, pointer);
  context.cost.expressionNodes += 1;
  switch (predicate.op) {
    case "predicate.constant": return PUBLIC_MANIFEST_FLOW;
    case "predicate.all":
    case "predicate.any":
      return joinFlows(...predicate.items.map(
        (item, index) => checkPredicate(item, context, `${pointer}/items/${index}`)
      ));
    case "predicate.not": return checkPredicate(predicate.item, context, `${pointer}/item`);
    case "predicate.compare": {
      const left = checkExpression(predicate.left, context, `${pointer}/left`);
      const right = checkExpression(predicate.right, context, `${pointer}/right`);
      assertComparableTypes(context.model, left.type, right.type, predicate.operator, pointer);
      return joinFlows(left.flow, right.flow);
    }
    case "predicate.exists": return checkExpression(predicate.value, context, `${pointer}/value`).flow;
    case "predicate.actor.active":
      if (context.planInvocation === "system") {
        fail(
          "MECHANICS_SYSTEM_CONTEXT_INVALID",
          pointer,
          "system intents cannot depend on the active command actor"
        );
      }
      return { audience: "public", integrity: "server" };
    case "predicate.turn.phase": {
      const phase = checkExpression(predicate.phase, context, `${pointer}/phase`);
      assertExpressionFitsKinds(context.model, phase.type, ["string", "enum"], `${pointer}/phase`);
      return phase.flow;
    }
    case "predicate.entity.matches": {
      const collection = requireEntityRef(predicate.entity, context, `${pointer}/entity`);
      if (predicate.objectType && !collection.itemTypes.includes(predicate.objectType)) {
        fail("MECHANICS_ENTITY_TYPE_MISMATCH", `${pointer}/objectType`, "object type is outside the referenced collection");
      }
      const scoped = { ...context, currentCollection: collection };
      const flows = [
        { audience: collection.audienceRef, integrity: "server" },
        checkEntityRefFlow(predicate.entity, scoped, `${pointer}/entity`),
        ...checkFieldExpressions(predicate.facets, "facet", collection, scoped, `${pointer}/facets`, false),
        ...checkFieldExpressions(predicate.attributes, "attribute", collection, scoped, `${pointer}/attributes`, false)
      ];
      return joinFlows(...flows);
    }
    case "predicate.collection.count":
      {
        const collection = requireCollection(context.model, predicate.collection, `${pointer}/collection`);
        context.cost.scannedEntities += collection.capacity;
        const ids = predicate.ids.map((item, index) => checkExpression(item, context, `${pointer}/ids/${index}`));
        for (const [index, id] of ids.entries()) {
          assertExpressionFitsKinds(context.model, id.type, ["string", "enum"], `${pointer}/ids/${index}`);
        }
        const expected = checkExpression(predicate.equals, context, `${pointer}/equals`);
        const fieldType = collectionPathTypeRef(collection, predicate.field, `${pointer}/field`);
        if (fieldType) assertExpressionFitsType(context.model, expected.type, fieldType, `${pointer}/equals`);
        else assertExpressionFitsKinds(context.model, expected.type, ["string"], `${pointer}/equals`);
        const minimum = checkExpression(predicate.countAtLeast, context, `${pointer}/countAtLeast`);
        assertExpressionFitsKinds(context.model, minimum.type, ["integer"], `${pointer}/countAtLeast`);
        const values = [...ids, expected, minimum];
        return joinFlows(
          { audience: collection.audienceRef, integrity: "server" },
          ...values.map((value) => value.flow)
        );
      }
    default: fail("MECHANICS_PREDICATE_UNKNOWN", `${pointer}/op`, `unsupported predicate "${predicate.op}"`);
  }
}

function collectionPathTypeRef(collection, fieldPath, pointer) {
  if (collection.itemShape === "record") {
    const field = Object.values(collection.fields).find((candidate) =>
      candidate.storage.kind === "path" &&
      JSON.stringify(candidate.storage.path) === JSON.stringify(fieldPath));
    if (!field) fail("MECHANICS_FIELD_REF_UNKNOWN", pointer, `record collection does not declare path "${fieldPath.join(".")}"`);
    return field.valueType;
  }
  if (fieldPath.length === 1 && fieldPath[0] === "objectType") return undefined;
  if (fieldPath.length !== 2 || !["facets", "attributes"].includes(fieldPath[0])) {
    fail("MECHANICS_COLLECTION_FIELD_PATH_INVALID", pointer, "collection count field must name objectType or one declared facet/attribute");
  }
  const storageKind = fieldPath[0] === "facets" ? "facet" : "attribute";
  const field = Object.values(collection.fields).find(
    (candidate) => candidate.storage.kind === storageKind && candidate.storage.name === fieldPath[1]
  );
  if (!field) fail("MECHANICS_FIELD_REF_UNKNOWN", pointer, `collection does not declare stored field "${fieldPath.join(".")}"`);
  return field.valueType;
}

function checkExpression(expression, context, pointer) {
  if (!isRecord(expression)) fail("MECHANICS_EXPRESSION_INVALID", pointer, "expression must be an object");
  context = enterEvaluationContext(context, pointer);
  context.cost.expressionNodes += 1;
  switch (expression.op) {
    case "value.literal": return {
      type: { kind: "literal", value: expression.value },
      flow: PUBLIC_MANIFEST_FLOW
    };
    case "value.param": {
      const type = context.parameters.get(expression.name);
      if (!type) fail("MECHANICS_PARAM_UNDECLARED", `${pointer}/name`, `parameter "${expression.name}" is not declared by a bound action`);
      return {
        // Parameters are shape-validated by the published Game Intent schema
        // but remain untrusted command input for information-flow purposes.
        type,
        flow: { audience: "public", integrity: "untrusted" }
      };
    }
    case "value.actor":
      if (context.planInvocation === "system") {
        fail(
          "MECHANICS_SYSTEM_CONTEXT_INVALID",
          pointer,
          "system intents do not have a game participant actor"
        );
      }
      return {
      // The server authenticates this identifier. Identity is not treated as
      // private state, which allows audited ownership fields to publish it.
      type: { kind: "actor-id" },
      flow: { audience: "public", integrity: "server" }
    };
    case "value.state": {
      const checked = checkStateReference(expression.ref, context, `${pointer}/ref`);
      const endpoint = checked.endpoint;
      return {
        type: { kind: "type-ref", ref: endpoint.valueType },
        flow: joinFlows({ audience: endpoint.audienceRef, integrity: "server" }, checked.flow)
      };
    }
    case "value.entity": {
      const collection = requireEntityRef(expression.entity, context, `${pointer}/entity`);
      const field = requireCollectionField(collection, expression.field, `${pointer}/field`);
      return {
        type: { kind: "type-ref", ref: field.valueType },
        flow: joinFlows(
          { audience: collection.audienceRef, integrity: "server" },
          checkEntityRefFlow(expression.entity, context, `${pointer}/entity`)
        )
      };
    }
    case "value.result": {
      const result = requireResult(context.results, expression.stepId, `${pointer}/stepId`);
      const path = expression.path || [];
      let type = result.type || { kind: "result", value: result.kind };
      if (path.length > 0) {
        type = result.kind === "entities" && path[0] === "ids"
          ? { kind: "list-of", itemKind: "string" }
          : result.paths?.get(path[0]);
        if (!type) {
          fail("MECHANICS_RESULT_PATH_UNKNOWN", `${pointer}/path/0`, `result "${expression.stepId}" has no declared path "${path[0]}"`);
        }
        for (let index = 1; index < path.length; index += 1) {
          type = resultPathChildType(type, path[index], `${pointer}/path/${index}`);
        }
      }
      return {
        type,
        flow: result.flow || { audience: "public", integrity: "module" }
      };
    }
    case "value.item": {
      if (!context.currentCollection) fail("MECHANICS_ITEM_SCOPE_INVALID", pointer, "value.item is only valid while evaluating a collection item");
      const field = requireField(context.currentCollection, expression.field, expression.area, `${pointer}/field`);
      return {
        type: { kind: "type-ref", ref: field.valueType },
        flow: { audience: context.currentCollection.audienceRef, integrity: "server" }
      };
    }
    case "number.add":
    case "number.subtract":
    case "number.multiply":
    case "number.divide":
    case "number.modulo":
    case "number.min":
    case "number.max": {
      const items = expression.items.map((item, index) => checkExpression(item, context, `${pointer}/items/${index}`));
      for (const [index, item] of items.entries()) {
        assertExpressionFitsKinds(context.model, item.type, ["integer", "decimal"], `${pointer}/items/${index}`);
      }
      return {
        type: { kind: "primitive", value: items.every((item) => expressionTypeKinds(context.model, item.type).includes("integer")) ? "integer" : "decimal" },
        flow: joinFlows(...items.map((item) => item.flow))
      };
    }
    case "value.coalesce": {
      const items = expression.items.map((item, index) => checkExpression(item, context, `${pointer}/items/${index}`));
      return {
        type: commonExpressionType(items.map((item) => item.type)),
        flow: joinFlows(...items.map((item) => item.flow))
      };
    }
    default: fail("MECHANICS_EXPRESSION_UNKNOWN", `${pointer}/op`, `unsupported expression "${String(expression.op)}"`);
  }
}

function resultPathChildType(parent, segment, pointer) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(segment)) {
    fail("MECHANICS_RESULT_PATH_TYPE_MISMATCH", pointer, "only a bounded list result accepts a numeric child segment");
  }
  const index = Number(segment);
  if (!Number.isSafeInteger(index)) {
    fail("MECHANICS_RESULT_PATH_INDEX_INVALID", pointer, "result list index is outside the safe integer range");
  }
  if (parent.kind === "tuple") {
    if (index >= parent.items.length) {
      fail("MECHANICS_RESULT_PATH_INDEX_OUT_OF_RANGE", pointer, `result tuple has only ${parent.items.length} items`);
    }
    return parent.items[index];
  }
  if (parent.kind === "list-of") return { kind: "primitive", value: parent.itemKind };
  fail("MECHANICS_RESULT_PATH_TYPE_MISMATCH", pointer, "numeric result path segment requires a list result");
}

function enterEvaluationContext(context, pointer) {
  const depth = context.evaluationDepth ?? 0;
  if (depth > MAX_EXPRESSION_PREDICATE_DEPTH) {
    fail(
      "MECHANICS_EXPRESSION_DEPTH_LIMIT",
      pointer,
      `expression/predicate depth exceeds runtime cap ${MAX_EXPRESSION_PREDICATE_DEPTH}`
    );
  }
  return { ...context, evaluationDepth: depth + 1 };
}

function checkAllExpressions(value, context, pointer) {
  const flows = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => flows.push(...checkAllExpressions(item, context, `${pointer}/${index}`)));
  } else if (isRecord(value)) {
    if (typeof value.op === "string" && (value.op.startsWith("value.") || value.op.startsWith("number."))) {
      flows.push(checkExpression(value, context, pointer).flow);
      return flows;
    }
    for (const [key, childValue] of Object.entries(value)) {
      flows.push(...checkAllExpressions(childValue, context, `${pointer}/${escapePointer(key)}`));
    }
  }
  return flows;
}

function requireEndpoint(model, endpointId, pointer, writable = false) {
  const endpoint = model.endpoints[endpointId];
  if (!endpoint) fail("MECHANICS_ENDPOINT_REF_UNKNOWN", pointer, `unknown endpoint "${endpointId}"`);
  if (endpoint.usage === "projection-only") {
    fail(
      "MECHANICS_PROJECTION_ENDPOINT_NOT_EXECUTABLE",
      pointer,
      `endpoint "${endpointId}" exists only for the player-facing state projection`
    );
  }
  if (writable && endpoint.access !== "read-write") fail("MECHANICS_ENDPOINT_READ_ONLY", pointer, `endpoint "${endpointId}" is read-only`);
  return endpoint;
}

/** Validate the exact dynamic storage-key set carried by one StateRef. */
function checkStateReference(reference, context, pointer, writable = false) {
  const endpoint = requireEndpoint(context.model, reference.endpoint, `${pointer}/endpoint`, writable);
  if (context.planInvocation === "system" && storageUsesActorContext(endpoint.storage)) {
    fail(
      "MECHANICS_SYSTEM_CONTEXT_INVALID",
      `${pointer}/endpoint`,
      `system intent cannot access actor-scoped endpoint "${reference.endpoint}"`
    );
  }
  const required = new Set(endpoint.storage.segments
    .filter((segment) => isRecord(segment) && typeof segment.binding === "string")
    .map((segment) => segment.binding));
  const supplied = new Set(Object.keys(reference.bindings || {}));
  for (const name of required) {
    if (!supplied.has(name)) {
      fail("MECHANICS_STATE_BINDING_MISSING", `${pointer}/bindings`, `endpoint requires storage binding "${name}"`);
    }
  }
  for (const name of supplied) {
    if (!required.has(name)) {
      fail("MECHANICS_STATE_BINDING_UNDECLARED", `${pointer}/bindings/${escapePointer(name)}`, `endpoint does not declare storage binding "${name}"`);
    }
  }
  const flows = [];
  for (const [name, expression] of Object.entries(reference.bindings || {})) {
    const checked = checkExpression(expression, context, `${pointer}/bindings/${escapePointer(name)}`);
    assertExpressionFitsKinds(context.model, checked.type, ["string", "enum"], `${pointer}/bindings/${escapePointer(name)}`);
    flows.push(checked.flow);
  }
  const flow = joinFlows(...flows);
  return { endpoint: { ...endpoint, bindingFlow: flow }, flow };
}

function requireNumericEndpoint(model, endpointId, pointer, writable) {
  const endpoint = requireEndpoint(model, endpointId, pointer, writable);
  const type = model.types[endpoint.valueType];
  if (!type || (type.kind !== "integer" && type.kind !== "decimal")) {
    fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", pointer, `endpoint "${endpointId}" is not numeric`);
  }
  return endpoint;
}

function requireNumericStateReference(reference, context, pointer, writable) {
  const endpoint = checkStateReference(reference, context, pointer, writable).endpoint;
  const type = context.model.types[endpoint.valueType];
  if (!type || (type.kind !== "integer" && type.kind !== "decimal")) {
    fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", pointer, `endpoint "${reference.endpoint}" is not numeric`);
  }
  return endpoint;
}

function requireEndpointKind(model, endpointId, pointer, kinds, writable = false) {
  const endpoint = requireEndpoint(model, endpointId, pointer, writable);
  const type = model.types[endpoint.valueType];
  if (!type || !kinds.includes(type.kind)) {
    fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", pointer, `endpoint "${endpointId}" must use type kind ${kinds.join(" or ")}`);
  }
  return endpoint;
}

function requireStateReferenceKind(reference, context, pointer, kinds, writable = false) {
  const endpoint = checkStateReference(reference, context, pointer, writable).endpoint;
  const type = context.model.types[endpoint.valueType];
  if (!type || !kinds.includes(type.kind)) {
    fail("MECHANICS_ENDPOINT_TYPE_MISMATCH", pointer, `endpoint "${reference.endpoint}" must use type kind ${kinds.join(" or ")}`);
  }
  return endpoint;
}

function requireCollection(model, collectionId, pointer) {
  const collection = model.collections[collectionId];
  if (!collection) fail("MECHANICS_COLLECTION_REF_UNKNOWN", pointer, `unknown collection "${collectionId}"`);
  return collection;
}

function requireField(collection, fieldId, storageKind, pointer, writable = false) {
  if (collection.itemShape === "record") {
    fail("MECHANICS_COLLECTION_ITEM_SHAPE_MISMATCH", pointer, "facet/attribute access requires an entity collection");
  }
  const field = collection.fields[fieldId];
  if (!field) fail("MECHANICS_FIELD_REF_UNKNOWN", pointer, `unknown field "${fieldId}"`);
  if (field.storage.kind !== storageKind) fail("MECHANICS_FIELD_STORAGE_MISMATCH", pointer, `field is not stored as ${storageKind}`);
  if (writable && field.access !== "read-write") fail("MECHANICS_FIELD_READ_ONLY", pointer, `field "${fieldId}" is read-only`);
  return field;
}

function requireCollectionField(collection, fieldId, pointer, writable = false) {
  const field = collection.fields[fieldId];
  if (!field) fail("MECHANICS_FIELD_REF_UNKNOWN", pointer, `unknown field "${fieldId}"`);
  if (writable && field.access !== "read-write") fail("MECHANICS_FIELD_READ_ONLY", pointer, `field "${fieldId}" is read-only`);
  return field;
}

function requireEntityRef(entity, context, pointer) {
  const collection = requireCollection(context.model, entity.collection, `${pointer}/collection`);
  const id = checkExpression(entity.entityId, context, `${pointer}/entityId`);
  assertExpressionFitsKinds(context.model, id.type, ["string", "enum"], `${pointer}/entityId`);
  return collection;
}

function requireResult(results, stepId, pointer) {
  const result = results.get(stepId);
  if (!result) fail("MECHANICS_RESULT_REF_FORWARD_OR_UNKNOWN", pointer, `result "${stepId}" is not a preceding step`);
  return result;
}

function literalKind(value) {
  if (value === null) return "null";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "decimal";
  if (Array.isArray(value)) return "list";
  return typeof value;
}

function checkEntityRefFlow(entity, context, pointer) {
  return checkExpression(entity.entityId, context, `${pointer}/entityId`).flow;
}

function assertFlowToAudience(flow, targetAudience, pointer) {
  if (AUDIENCE_RANK[flow.audience] > AUDIENCE_RANK[targetAudience]) {
    fail(
      "MECHANICS_INFORMATION_FLOW_VIOLATION",
      pointer,
      `${flow.audience}-audience data or control flow cannot write a ${targetAudience} sink without a registered trusted disclosure`
    );
  }
}

function expressionTypeKinds(model, type) {
  if (!type || type.kind === "unknown") return ["unknown"];
  if (type.kind === "json-object") return ["json", "record", "map", "object"];
  if (type.kind === "actor-id") return ["actor", "string"];
  if (type.kind === "parameter") return [type.optional ? "option" : undefined, type.value].filter(Boolean);
  if (type.kind === "primitive") return [type.value];
  if (type.kind === "literal") return [literalKind(type.value)];
  if (type.kind === "list-of") return ["list"];
  if (type.kind === "structural") return [type.shape.kind];
  if (type.kind === "type-ref") {
    const declared = model.types[type.ref];
    if (!declared) return ["unknown"];
    if (declared.kind === "option") {
      return ["option", ...expressionTypeKinds(model, { kind: "type-ref", ref: declared.itemType })];
    }
    return [declared.kind];
  }
  return [type.kind];
}

function assertExpressionFitsKinds(model, actual, expectedKinds, pointer) {
  const kinds = expressionTypeKinds(model, actual);
  if (kinds.includes("unknown")) return;
  if (actual.kind === "parameter" && actual.optional && !expectedKinds.includes("option")) {
    fail("MECHANICS_EXPRESSION_TYPE_MISMATCH", pointer, "optional parameter requires an explicit value.coalesce before this use");
  }
  if (!expectedKinds.some((kind) => kinds.includes(kind))) {
    fail(
      "MECHANICS_EXPRESSION_TYPE_MISMATCH",
      pointer,
      `expected ${expectedKinds.join(" or ")}, got ${kinds.join("/")}`
    );
  }
}

function assertExpressionFitsType(model, actual, expectedTypeRef, pointer) {
  if (!actual || actual.kind === "unknown") return;
  const expected = model.types[expectedTypeRef];
  if (!expected) fail("MECHANICS_TYPE_REF_UNKNOWN", pointer, `unknown target type "${expectedTypeRef}"`);

  if (actual.kind === "structural") {
    if (isStructuralResultCompatible(model, actual.shape, expectedTypeRef, new Set())) return;
  } else if (actual.kind === "parameter") {
    const expectedKinds = expressionTypeKinds(model, { kind: "type-ref", ref: expectedTypeRef });
    if (actual.optional && !expectedKinds.includes("option")) {
      fail("MECHANICS_EXPRESSION_TYPE_MISMATCH", pointer, "optional parameter requires an explicit value.coalesce before this use");
    }
    if (expectedKinds.includes(actual.value) || (actual.value === "integer" && expectedKinds.includes("decimal"))) return;
  } else if (actual.kind === "actor-id") {
    const expectedKinds = expressionTypeKinds(model, { kind: "type-ref", ref: expectedTypeRef });
    if (expectedKinds.includes("string") || expectedKinds.includes("enum")) return;
  } else if (actual.kind === "type-ref") {
    if (areDeclaredTypesCompatible(model, actual.ref, expectedTypeRef, new Set())) return;
  } else if (actual.kind === "literal") {
    if (literalMatchesDeclaredType(model, actual.value, expectedTypeRef, new Set())) return;
  } else if (actual.kind === "list-of") {
    if (
      (expected.kind === "list" || expected.kind === "set") &&
      expressionTypeKinds(model, { kind: "primitive", value: actual.itemKind })
        .some((kind) => expressionTypeKinds(model, { kind: "type-ref", ref: expected.itemType }).includes(kind))
    ) return;
  } else {
    const kinds = expressionTypeKinds(model, actual);
    const expectedKinds = expressionTypeKinds(model, { kind: "type-ref", ref: expectedTypeRef });
    if (kinds.some((kind) => expectedKinds.includes(kind))) return;
    // Arithmetic may produce an integer that is safely accepted by a decimal
    // sink; the runtime still enforces the declared bounds and scale.
    if (kinds.includes("integer") && expectedKinds.includes("decimal")) return;
  }
  fail(
    "MECHANICS_EXPRESSION_TYPE_MISMATCH",
    pointer,
    `expression is incompatible with declared type "${expectedTypeRef}"`
  );
}

/**
 * Match a runtime-owned result shape against a game-declared state type.
 *
 * This preserves neutral operation output while rejecting the former broad
 * "JSON object fits any record/map" escape hatch. Bounds are directional: the
 * sink must hold the operation's complete statically possible result.
 */
function isStructuralResultCompatible(model, shape, expectedTypeRef, seen) {
  const identity = `${expectedTypeRef}:${JSON.stringify(shape)}`;
  if (seen.has(identity)) return true;
  seen.add(identity);
  const expected = model.types[expectedTypeRef];
  if (!expected) return false;
  if (expected.kind === "option") {
    return isStructuralResultCompatible(model, shape, expected.itemType, seen);
  }
  if (shape.kind === "integer") return expected.kind === "integer" || expected.kind === "decimal";
  if (shape.kind === "decimal" || shape.kind === "string" || shape.kind === "boolean") {
    return expected.kind === shape.kind;
  }
  if (shape.kind === "list") {
    return expected.kind === "list" &&
      expected.maxItems >= shape.maxItems &&
      isStructuralResultCompatible(model, shape.item, expected.itemType, seen);
  }
  if (shape.kind === "map") {
    return expected.kind === "map" &&
      expected.maxProperties >= shape.maxProperties &&
      isStructuralResultCompatible(model, shape.value, expected.valueType, seen);
  }
  if (shape.kind === "record") {
    if (expected.kind !== "record") return false;
    for (const [fieldId, fieldShape] of Object.entries(shape.fields)) {
      const field = expected.fields[fieldId];
      if (!field || !isStructuralResultCompatible(model, fieldShape, field.typeRef, seen)) return false;
    }
    return Object.entries(expected.fields).every(
      ([fieldId, field]) => Object.prototype.hasOwnProperty.call(shape.fields, fieldId) || field.optional
    );
  }
  return false;
}

function areDeclaredTypesCompatible(model, actualRef, expectedRef, seen) {
  if (actualRef === expectedRef) return true;
  const identity = `${actualRef}->${expectedRef}`;
  if (seen.has(identity)) return true;
  seen.add(identity);
  const actual = model.types[actualRef];
  const expected = model.types[expectedRef];
  if (!actual || !expected) return false;
  if (expected.kind === "option") {
    return actual.kind === "option"
      ? areDeclaredTypesCompatible(model, actual.itemType, expected.itemType, seen)
      : areDeclaredTypesCompatible(model, actualRef, expected.itemType, seen);
  }
  if (actual.kind === "option") return false;
  if (actual.kind === "integer" && expected.kind === "decimal") return true;
  if (actual.kind !== expected.kind) return false;
  switch (actual.kind) {
    case "list":
    case "set":
      return areDeclaredTypesCompatible(model, actual.itemType, expected.itemType, seen);
    case "map":
      return areDeclaredTypesCompatible(model, actual.valueType, expected.valueType, seen);
    case "record":
      return Object.entries(expected.fields).every(([fieldId, field]) => {
        const actualField = actual.fields[fieldId];
        return actualField && (field.optional || !actualField.optional) &&
          areDeclaredTypesCompatible(model, actualField.typeRef, field.typeRef, seen);
      });
    case "json":
      return actual.maxDepth <= expected.maxDepth &&
        actual.maxNodes <= expected.maxNodes &&
        actual.maxUtf8Bytes <= expected.maxUtf8Bytes;
    default:
      return true;
  }
}

function literalMatchesDeclaredType(model, value, typeRef, seen, profile) {
  const type = model.types[typeRef];
  if (!type) return false;
  const identity = `${typeRef}:${typeof value}`;
  if (seen.has(identity)) return true;
  seen.add(identity);
  switch (type.kind) {
    case "boolean": return typeof value === "boolean";
    case "string": return typeof value === "string" && (!profile ||
      Buffer.byteLength(value, "utf8") <= Math.min(type.maxUtf8Bytes ?? profile.maxStringUtf8Bytes, profile.maxStringUtf8Bytes));
    case "integer": return Number.isSafeInteger(value) && value >= type.minimum && value <= type.maximum;
    case "decimal": {
      if (typeof value !== "number" || !Number.isFinite(value) ||
        value < Number(type.minimum) || value > Number(type.maximum)) return false;
      const scaled = value * 10 ** type.scale;
      return Number(value.toFixed(type.scale)) === value && Number.isSafeInteger(Math.round(scaled));
    }
    case "enum": return type.values.some((candidate) => Object.is(candidate, value)) &&
      (!profile || typeof value !== "string" || Buffer.byteLength(value, "utf8") <= profile.maxStringUtf8Bytes);
    case "option": return value === null || value === undefined ||
      literalMatchesDeclaredType(model, value, type.itemType, seen, profile);
    case "list":
    case "set": {
      if (!Array.isArray(value) || value.length > type.maxItems ||
        !value.every((item) => literalMatchesDeclaredType(model, item, type.itemType, new Set(seen), profile))) return false;
      if (type.kind === "set") {
        const identities = value.map((item) => mechanicsSha256(item));
        if (new Set(identities).size !== identities.length) return false;
      }
      return true;
    }
    case "map": return isRecord(value) && Object.keys(value).length <= type.maxProperties &&
      Object.keys(value).every((key) => !["__proto__", "constructor", "prototype"].includes(key) &&
        (!profile || Buffer.byteLength(key, "utf8") <= profile.maxStringUtf8Bytes)) &&
      Object.values(value).every((item) => literalMatchesDeclaredType(model, item, type.valueType, new Set(seen), profile));
    case "record": return isRecord(value) &&
      Object.keys(value).every((key) => !["__proto__", "constructor", "prototype"].includes(key) && type.fields[key] !== undefined) &&
      Object.entries(type.fields).every(([fieldId, field]) =>
        value[fieldId] === undefined
          ? field.optional
          : literalMatchesDeclaredType(model, value[fieldId], field.typeRef, new Set(seen), profile)
      );
    case "json": return boundedJsonMatchesType(value, type, profile);
    default: return false;
  }
}

function boundedJsonMatchesType(value, type, profile) {
  const limits = {
    maxLiteralValueBytes: Math.min(type.maxUtf8Bytes, profile?.maxLiteralValueBytes ?? type.maxUtf8Bytes),
    maxLiteralValueNodes: Math.min(type.maxNodes, profile?.maxLiteralValueNodes ?? type.maxNodes),
    maxJsonDepth: Math.min(type.maxDepth, profile?.maxJsonDepth ?? type.maxDepth),
    maxStringUtf8Bytes: profile?.maxStringUtf8Bytes ?? 65536
  };
  try {
    measureStaticJson(value, limits, "/state");
    return true;
  } catch (error) {
    if (error instanceof MechanicsSemanticError) return false;
    throw error;
  }
}

function assertComparableTypes(model, left, right, operator, pointer) {
  if (left.kind === "unknown" || right.kind === "unknown") return;
  const leftKinds = expressionTypeKinds(model, left);
  const rightKinds = expressionTypeKinds(model, right);
  const numeric = (kinds) => kinds.includes("integer") || kinds.includes("decimal");
  const comparable = (numeric(leftKinds) && numeric(rightKinds)) ||
    leftKinds.some((kind) => rightKinds.includes(kind)) ||
    (left.kind === "literal" && right.kind === "type-ref" && literalMatchesDeclaredType(model, left.value, right.ref, new Set())) ||
    (right.kind === "literal" && left.kind === "type-ref" && literalMatchesDeclaredType(model, right.value, left.ref, new Set()));
  if (!comparable) {
    fail("MECHANICS_COMPARISON_TYPE_MISMATCH", pointer, "comparison operands use incompatible types");
  }
  if (!["eq", "ne"].includes(operator)) {
    const ordered = (numeric(leftKinds) && numeric(rightKinds)) ||
      (leftKinds.includes("string") && rightKinds.includes("string"));
    if (!ordered) fail("MECHANICS_COMPARISON_TYPE_MISMATCH", pointer, `${operator} requires numeric or string operands`);
  }
}

function commonExpressionType(types) {
  const concrete = types.filter((type) => type && type.kind !== "unknown");
  if (concrete.length === 0) return { kind: "unknown" };
  const parameterValues = concrete.map((type) => type.kind === "parameter" ? type.value : undefined);
  if (parameterValues.every(Boolean) && new Set(parameterValues).size === 1) {
    return {
      kind: "parameter",
      value: parameterValues[0],
      // Coalesce is non-optional as soon as one candidate is guaranteed to
      // produce that compatible scalar type.
      optional: concrete.every((type) => type.optional)
    };
  }
  if (concrete.length === 2) {
    const parameter = concrete.find((type) => type.kind === "parameter");
    const other = concrete.find((type) => type.kind !== "parameter");
    if (parameter && other && !parameterTypeCompatibleWithExpression(parameter, other)) return { kind: "unknown" };
    if (parameter && other) return { ...parameter, optional: false };
  }
  const first = JSON.stringify(concrete[0]);
  return concrete.every((type) => JSON.stringify(type) === first)
    ? concrete[0]
    : { kind: "unknown" };
}

function parameterTypeCompatibleWithExpression(parameter, expression) {
  if (expression.kind === "primitive") return expression.value === parameter.value;
  if (expression.kind === "literal") {
    const kind = literalKind(expression.value);
    return kind === parameter.value || (kind === "integer" && parameter.value === "decimal");
  }
  return false;
}

/**
 * Validate resource facts that JSON Schema cannot express across a recursive
 * literal or type-reference graph. This is a budget check, not a second shape
 * schema: AJV remains authoritative for allowed properties and node forms.
 */
function checkStaticResourceBudgets(mechanics, profile) {
  checkDeclaredTypeResources(mechanics.stateModel.types, profile);
  for (const [planId, plan] of Object.entries(mechanics.plans)) {
    const planPointer = `/plans/${escapePointer(planId)}/transaction`;
    let literalBytes = 0;
    let literalNodes = 0;
    visitLiteralExpressions(plan.transaction, planPointer, (value, pointer) => {
      const usage = measureStaticJson(value, profile, pointer);
      literalBytes += usage.bytes;
      literalNodes += usage.nodes;
      if (literalBytes > profile.maxLiteralPlanBytes) {
        fail(
          "MECHANICS_LITERAL_PLAN_SIZE_LIMIT",
          planPointer,
          "serialized literals exceed the selected profile's per-plan byte limit"
        );
      }
      if (literalNodes > profile.maxLiteralPlanNodes) {
        fail(
          "MECHANICS_LITERAL_PLAN_NODE_LIMIT",
          planPointer,
          "literals exceed the selected profile's per-plan node limit"
        );
      }
    });
  }
}

function checkDeclaredTypeResources(types, profile) {
  for (const [typeId, type] of Object.entries(types)) {
    const pointer = `/stateModel/types/${escapePointer(typeId)}`;
    if (type.kind === "string" && type.maxUtf8Bytes !== undefined && type.maxUtf8Bytes > profile.maxStringUtf8Bytes) {
      fail("MECHANICS_STRING_TYPE_LIMIT", `${pointer}/maxUtf8Bytes`, "string type exceeds the selected profile limit");
    }
    if (type.kind === "enum" && type.values.some(
      (value) => typeof value === "string" && Buffer.byteLength(value, "utf8") > profile.maxStringUtf8Bytes
    )) {
      fail("MECHANICS_STRING_TYPE_LIMIT", `${pointer}/values`, "enum contains a string above the selected profile limit");
    }
    if (type.kind === "json" && (
      type.maxDepth > profile.maxJsonDepth ||
      type.maxNodes > profile.maxJsonNodes ||
      type.maxUtf8Bytes > profile.maxLiteralValueBytes
    )) {
      fail("MECHANICS_JSON_TYPE_LIMIT", pointer, "bounded JSON type exceeds the selected profile limits");
    }
  }

  // A cycle would turn a finite declaration into an unbounded runtime shape.
  // Shared acyclic subgraphs remain valid and are checked independently.
  const status = new Map();
  const depthByType = new Map();
  let references = 0;
  const visitType = (typeId) => {
    const pointer = `/stateModel/types/${escapePointer(typeId)}`;
    if (status.get(typeId) === "visiting") {
      fail("MECHANICS_TYPE_RECURSION", pointer, "recursive state value types are not allowed");
    }
    if (status.get(typeId) === "done") return depthByType.get(typeId);
    status.set(typeId, "visiting");
    let depth = 0;
    const refs = referencedTypes(types[typeId]);
    references += refs.length;
    if (references > profile.maxTypeReferences) {
      fail("MECHANICS_TYPE_REFERENCE_LIMIT", pointer, "state type graph exceeds the selected profile reference limit");
    }
    for (const ref of refs) depth = Math.max(depth, visitType(ref) + 1);
    if (depth > profile.maxJsonDepth) {
      fail("MECHANICS_TYPE_DEPTH_LIMIT", pointer, "declared type graph exceeds the selected profile depth");
    }
    status.set(typeId, "done");
    depthByType.set(typeId, depth);
    return depth;
  };
  for (const typeId of Object.keys(types)) visitType(typeId);
}

function visitLiteralExpressions(value, pointer, onLiteral) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitLiteralExpressions(item, `${pointer}/${index}`, onLiteral));
    return;
  }
  if (!isRecord(value)) return;
  if (value.op === "value.literal") {
    onLiteral(value.value, `${pointer}/value`);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    visitLiteralExpressions(item, `${pointer}/${escapePointer(key)}`, onLiteral);
  }
}

/** Exact UTF-8 JSON size without allocating the complete serialization. */
function measureStaticJson(value, profile, pointer) {
  const ancestors = new Set();
  let bytes = 0;
  let nodes = 0;

  const addBytes = (amount) => {
    bytes += amount;
    if (bytes > profile.maxLiteralValueBytes) {
      fail("MECHANICS_LITERAL_SIZE_LIMIT", pointer, "serialized literal exceeds the selected profile byte limit");
    }
  };
  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > profile.maxLiteralValueNodes) {
      fail("MECHANICS_LITERAL_NODE_LIMIT", pointer, "literal exceeds the selected profile node limit");
    }
    if (depth > profile.maxJsonDepth) {
      fail("MECHANICS_LITERAL_DEPTH_LIMIT", pointer, "literal exceeds the selected profile depth limit");
    }
    if (current === null || typeof current === "boolean") {
      addBytes(current === null ? 4 : current ? 4 : 5);
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Math.abs(current) > Number.MAX_SAFE_INTEGER) {
        fail("MECHANICS_LITERAL_JSON_INVALID", pointer, "literal number is outside the deterministic JSON range");
      }
      addBytes(Buffer.byteLength(JSON.stringify(current), "utf8"));
      return;
    }
    if (typeof current === "string") {
      if (Buffer.byteLength(current, "utf8") > profile.maxStringUtf8Bytes) {
        fail("MECHANICS_LITERAL_STRING_LIMIT", pointer, "literal string exceeds the selected profile UTF-8 byte limit");
      }
      addBytes(Buffer.byteLength(JSON.stringify(current), "utf8"));
      return;
    }
    if (Array.isArray(current)) {
      if (ancestors.has(current)) fail("MECHANICS_LITERAL_JSON_INVALID", pointer, "cyclic literal is not allowed");
      ancestors.add(current);
      addBytes(2 + Math.max(0, current.length - 1));
      current.forEach((item) => visit(item, depth + 1));
      ancestors.delete(current);
      return;
    }
    if (isRecord(current)) {
      if (ancestors.has(current)) fail("MECHANICS_LITERAL_JSON_INVALID", pointer, "cyclic literal is not allowed");
      ancestors.add(current);
      const keys = Object.keys(current).sort();
      addBytes(2 + Math.max(0, keys.length - 1));
      for (const key of keys) {
        if (Buffer.byteLength(key, "utf8") > profile.maxStringUtf8Bytes) {
          fail("MECHANICS_LITERAL_STRING_LIMIT", pointer, "literal key exceeds the selected profile UTF-8 byte limit");
        }
        addBytes(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        visit(current[key], depth + 1);
      }
      ancestors.delete(current);
      return;
    }
    fail("MECHANICS_LITERAL_JSON_INVALID", pointer, "literal must be ordinary JSON");
  };

  visit(value, 0);
  return { bytes, nodes };
}

function compareDecimal(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

function escapePointer(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

module.exports = {
  BUDGET_PROFILES,
  MechanicsSemanticError,
  checkMechanicsBundle,
  turnSessionInitializationForManifest
};
