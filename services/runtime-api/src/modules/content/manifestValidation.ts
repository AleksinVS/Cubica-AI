import type {
  GameManifest,
  GameManifestActionDefinition,
  GameManifestConfig,
  GameManifestContent,
  GameManifestEngineConfig,
  GameManifestMeta,
  GameManifestState
} from "@cubica/contracts-manifest";
import { ManifestValidationError } from "../errors.ts";

type RecordLike = Record<string, unknown>;

const isObjectRecord = (value: unknown): value is RecordLike =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertObjectRecord: (value: unknown, path: string) => asserts value is RecordLike = (value, path) => {
  if (!isObjectRecord(value)) {
    throw new ManifestValidationError(`Manifest field "${path}" must be an object`);
  }
};

const assertString: (value: unknown, path: string) => asserts value is string = (value, path) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ManifestValidationError(`Manifest field "${path}" must be a non-empty string`);
  }
};

const assertNumber: (value: unknown, path: string) => asserts value is number = (value, path) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ManifestValidationError(`Manifest field "${path}" must be a number`);
  }
};

const assertBoolean: (value: unknown, path: string) => asserts value is boolean = (value, path) => {
  if (typeof value !== "boolean") {
    throw new ManifestValidationError(`Manifest field "${path}" must be a boolean`);
  }
};

const assertArray: (value: unknown, path: string) => asserts value is Array<unknown> = (value, path) => {
  if (!Array.isArray(value)) {
    throw new ManifestValidationError(`Manifest field "${path}" must be an array`);
  }
};

const validateMeta = (meta: unknown): GameManifestMeta => {
  assertObjectRecord(meta, "meta");
  assertString(meta.id, "meta.id");
  assertString(meta.version, "meta.version");
  assertString(meta.name, "meta.name");
  assertString(meta.description, "meta.description");
  assertString(meta.schemaVersion, "meta.schemaVersion");

  if (meta.author !== undefined) {
    assertString(meta.author, "meta.author");
  }

  if (meta.minEngineVersion !== undefined) {
    assertString(meta.minEngineVersion, "meta.minEngineVersion");
  }

  if (meta.tags !== undefined) {
    assertArray(meta.tags, "meta.tags");
  }

  if (meta.references !== undefined) {
    assertArray(meta.references, "meta.references");
  }

  return meta as unknown as GameManifestMeta;
};

const validateConfig = (config: unknown): GameManifestConfig => {
  assertObjectRecord(config, "config");
  assertObjectRecord(config.players, "config.players");
  assertNumber(config.players.min, "config.players.min");
  assertNumber(config.players.max, "config.players.max");
  assertObjectRecord(config.settings, "config.settings");
  assertString(config.settings.mode, "config.settings.mode");
  assertString(config.settings.locale, "config.settings.locale");

  return config as unknown as GameManifestConfig;
};

const validateContent = (content: unknown): GameManifestContent | undefined => {
  if (content === undefined) {
    return undefined;
  }

  assertObjectRecord(content, "content");

  if (content.scenario !== undefined) {
    assertObjectRecord(content.scenario, "content.scenario");
    assertString(content.scenario.path, "content.scenario.path");
  }

  if (content.scripts !== undefined) {
    assertArray(content.scripts, "content.scripts");
  }

  if (content.design !== undefined) {
    assertObjectRecord(content.design, "content.design");
    if (content.design.mockups !== undefined) {
      assertArray(content.design.mockups, "content.design.mockups");
    }
  }

  if (content.methodology !== undefined) {
    assertObjectRecord(content.methodology, "content.methodology");
  }

  return content as unknown as GameManifestContent;
};

const validateEngine = (engine: unknown): GameManifestEngineConfig | undefined => {
  if (engine === undefined) {
    return undefined;
  }

  assertObjectRecord(engine, "engine");
  assertString(engine.systemPrompt, "engine.systemPrompt");

  if (engine.modelConfig !== undefined) {
    assertObjectRecord(engine.modelConfig, "engine.modelConfig");
  }

  return engine as unknown as GameManifestEngineConfig;
};

const validateState = (state: unknown): GameManifestState => {
  assertObjectRecord(state, "state");
  assertObjectRecord(state.public, "state.public");
  assertObjectRecord(state.public.timeline, "state.public.timeline");
  assertString(state.public.timeline.line, "state.public.timeline.line");
  assertNumber(state.public.timeline.stepIndex, "state.public.timeline.stepIndex");
  assertString(state.public.timeline.stageId, "state.public.timeline.stageId");
  assertString(state.public.timeline.screenId, "state.public.timeline.screenId");
  if (state.public.timeline.canAdvance !== undefined) {
    assertBoolean(state.public.timeline.canAdvance, "state.public.timeline.canAdvance");
  }
  assertArray(state.public.log, "state.public.log");
  assertObjectRecord(state.public.flags, "state.public.flags");
  assertObjectRecord(state.public.flags.cards, "state.public.flags.cards");
  for (const [cardId, cardState] of Object.entries(state.public.flags.cards)) {
    assertObjectRecord(cardState, `state.public.flags.cards.${cardId}`);
    if (cardState.selected !== undefined) {
      assertBoolean(cardState.selected, `state.public.flags.cards.${cardId}.selected`);
    }
    if (cardState.resolved !== undefined) {
      assertBoolean(cardState.resolved, `state.public.flags.cards.${cardId}.resolved`);
    }
  }

  if (state.secret !== undefined) {
    assertObjectRecord(state.secret, "state.secret");
    if (state.secret.opening !== undefined) {
      assertObjectRecord(state.secret.opening, "state.secret.opening");
      if (state.secret.opening.selectedCardId !== undefined) {
        assertString(state.secret.opening.selectedCardId, "state.secret.opening.selectedCardId");
      }
    }
  }

  return state as unknown as GameManifestState;
};

const validateDeterministicActionMetadata = (deterministic: unknown, actionPath: string) => {
  assertObjectRecord(deterministic, `${actionPath}.deterministic`);
  assertArray(deterministic.provenance, `${actionPath}.deterministic.provenance`);
  if (deterministic.provenance.length === 0) {
    throw new ManifestValidationError(`Manifest field "${actionPath}.deterministic.provenance" must not be empty`);
  }

  deterministic.provenance.forEach((item, index) => {
    const path = `${actionPath}.deterministic.provenance[${index}]`;
    assertObjectRecord(item, path);
    assertString(item.sourceKind, `${path}.sourceKind`);
    assertString(item.sourceFile, `${path}.sourceFile`);
    assertString(item.legacyCardId, `${path}.legacyCardId`);
    if (item.lineIndex !== undefined) {
      assertNumber(item.lineIndex, `${path}.lineIndex`);
    }
    if (item.stepIndex !== undefined) {
      assertNumber(item.stepIndex, `${path}.stepIndex`);
    }
  });

  assertObjectRecord(deterministic.guard, `${actionPath}.deterministic.guard`);

  if (deterministic.guard.timeline !== undefined) {
    assertObjectRecord(deterministic.guard.timeline, `${actionPath}.deterministic.guard.timeline`);
    if (deterministic.guard.timeline.line !== undefined) {
      assertString(deterministic.guard.timeline.line, `${actionPath}.deterministic.guard.timeline.line`);
    }
    if (deterministic.guard.timeline.stepIndex !== undefined) {
      assertNumber(deterministic.guard.timeline.stepIndex, `${actionPath}.deterministic.guard.timeline.stepIndex`);
    }
    if (deterministic.guard.timeline.canAdvance !== undefined) {
      assertBoolean(deterministic.guard.timeline.canAdvance, `${actionPath}.deterministic.guard.timeline.canAdvance`);
    }
  }

  if (deterministic.guard.opening !== undefined) {
    assertObjectRecord(deterministic.guard.opening, `${actionPath}.deterministic.guard.opening`);
    if (deterministic.guard.opening.selectedCardIdAbsent !== undefined) {
      assertBoolean(
        deterministic.guard.opening.selectedCardIdAbsent,
        `${actionPath}.deterministic.guard.opening.selectedCardIdAbsent`
      );
    }
    if (deterministic.guard.opening.selectedCardIdEquals !== undefined) {
      assertString(
        deterministic.guard.opening.selectedCardIdEquals,
        `${actionPath}.deterministic.guard.opening.selectedCardIdEquals`
      );
    }
  }

  if (deterministic.guard.card !== undefined) {
    assertObjectRecord(deterministic.guard.card, `${actionPath}.deterministic.guard.card`);
    assertString(deterministic.guard.card.id, `${actionPath}.deterministic.guard.card.id`);
    if (deterministic.guard.card.selected !== undefined) {
      assertBoolean(deterministic.guard.card.selected, `${actionPath}.deterministic.guard.card.selected`);
    }
    if (deterministic.guard.card.resolved !== undefined) {
      assertBoolean(deterministic.guard.card.resolved, `${actionPath}.deterministic.guard.card.resolved`);
    }
  }

  assertArray(deterministic.metricDeltas, `${actionPath}.deterministic.metricDeltas`);
  if (deterministic.metricDeltas.length === 0) {
    throw new ManifestValidationError(`Manifest field "${actionPath}.deterministic.metricDeltas" must not be empty`);
  }

  deterministic.metricDeltas.forEach((delta, index) => {
    const path = `${actionPath}.deterministic.metricDeltas[${index}]`;
    assertObjectRecord(delta, path);
    assertString(delta.metricId, `${path}.metricId`);
    assertNumber(delta.delta, `${path}.delta`);
  });

  assertObjectRecord(deterministic.log, `${actionPath}.deterministic.log`);
  assertString(deterministic.log.kind, `${actionPath}.deterministic.log.kind`);
  assertString(deterministic.log.summary, `${actionPath}.deterministic.log.summary`);
  if (deterministic.log.stageId !== undefined) {
    assertString(deterministic.log.stageId, `${actionPath}.deterministic.log.stageId`);
  }
  if (deterministic.log.cardId !== undefined) {
    assertString(deterministic.log.cardId, `${actionPath}.deterministic.log.cardId`);
  }

  assertObjectRecord(deterministic.stateUpdate, `${actionPath}.deterministic.stateUpdate`);
  if (deterministic.stateUpdate.timelineCanAdvance !== undefined) {
    assertBoolean(deterministic.stateUpdate.timelineCanAdvance, `${actionPath}.deterministic.stateUpdate.timelineCanAdvance`);
  }
  if (deterministic.stateUpdate.selectedCardId !== undefined) {
    assertString(deterministic.stateUpdate.selectedCardId, `${actionPath}.deterministic.stateUpdate.selectedCardId`);
  }
  if (deterministic.stateUpdate.cardFlags !== undefined) {
    assertObjectRecord(deterministic.stateUpdate.cardFlags, `${actionPath}.deterministic.stateUpdate.cardFlags`);
    assertString(deterministic.stateUpdate.cardFlags.cardId, `${actionPath}.deterministic.stateUpdate.cardFlags.cardId`);
    if (deterministic.stateUpdate.cardFlags.selected !== undefined) {
      assertBoolean(deterministic.stateUpdate.cardFlags.selected, `${actionPath}.deterministic.stateUpdate.cardFlags.selected`);
    }
    if (deterministic.stateUpdate.cardFlags.resolved !== undefined) {
      assertBoolean(deterministic.stateUpdate.cardFlags.resolved, `${actionPath}.deterministic.stateUpdate.cardFlags.resolved`);
    }
  }
};

const validateActions = (actions: unknown): Record<string, GameManifestActionDefinition> => {
  assertObjectRecord(actions, "actions");

  for (const [actionId, action] of Object.entries(actions)) {
    const actionPath = `actions.${actionId}`;
    assertObjectRecord(action, `actions.${actionId}`);
    if (action.handlerType !== undefined) {
      assertString(action.handlerType, `actions.${actionId}.handlerType`);
    } else if (action.handler_type !== undefined) {
      assertString(action.handler_type, `actions.${actionId}.handler_type`);
    } else {
      throw new ManifestValidationError(`Manifest action "${actionId}" must define "handlerType"`);
    }

    if (action.capabilityFamily !== undefined) {
      assertString(action.capabilityFamily, `actions.${actionId}.capabilityFamily`);
    } else {
      throw new ManifestValidationError(`Manifest action "${actionId}" must define "capabilityFamily"`);
    }

    if (action.capability !== undefined) {
      assertString(action.capability, `actions.${actionId}.capability`);
    } else {
      throw new ManifestValidationError(`Manifest action "${actionId}" must define "capability"`);
    }

    if (action.function !== undefined) {
      assertString(action.function, `actions.${actionId}.function`);
    }

    if (action.displayName !== undefined) {
      assertString(action.displayName, `actions.${actionId}.displayName`);
    }

    if (action.deterministic !== undefined) {
      validateDeterministicActionMetadata(action.deterministic, actionPath);
    }
  }

  return actions as unknown as Record<string, GameManifestActionDefinition>;
};

export function validateGameManifest(manifest: unknown): GameManifest {
  assertObjectRecord(manifest, "manifest");

  const validatedManifest = {
    meta: validateMeta(manifest.meta),
    config: validateConfig(manifest.config),
    content: validateContent(manifest.content),
    engine: validateEngine(manifest.engine),
    state: validateState(manifest.state),
    actions: validateActions(manifest.actions)
  };

  return validatedManifest as GameManifest;
}
