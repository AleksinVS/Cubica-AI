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

const assertStringArray = (value: unknown, path: string) => {
  assertArray(value, path);
  value.forEach((item, index) => assertString(item, `${path}[${index}]`));
};

const assertMetricComparisonOperator = (value: unknown, path: string) => {
  if (value !== ">" && value !== "<" && value !== "==") {
    throw new ManifestValidationError(`Manifest field "${path}" must be one of ">", "<", "=="`);
  }
};

const validateMetricCondition = (condition: unknown, path: string) => {
  assertObjectRecord(condition, path);
  assertString(condition.metricId, `${path}.metricId`);
  assertMetricComparisonOperator(condition.operator, `${path}.operator`);
  assertNumber(condition.threshold, `${path}.threshold`);
};

const validateMetricDeltaList = (value: unknown, path: string): Array<RecordLike> => {
  assertArray(value, path);
  value.forEach((delta, index) => {
    const deltaPath = `${path}[${index}]`;
    assertObjectRecord(delta, deltaPath);
    assertString(delta.metricId, `${deltaPath}.metricId`);
    assertNumber(delta.delta, `${deltaPath}.delta`);
  });
  return value as Array<RecordLike>;
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
    if (cardState.locked !== undefined) {
      assertBoolean(cardState.locked, `state.public.flags.cards.${cardId}.locked`);
    }
    if (cardState.available !== undefined) {
      assertBoolean(cardState.available, `state.public.flags.cards.${cardId}.available`);
    }
  }

  if (state.public.flags.team !== undefined) {
    assertObjectRecord(state.public.flags.team, "state.public.flags.team");
    for (const [memberId, memberState] of Object.entries(state.public.flags.team)) {
      assertObjectRecord(memberState, `state.public.flags.team.${memberId}`);
      if (memberState.selected !== undefined) {
        assertBoolean(memberState.selected, `state.public.flags.team.${memberId}.selected`);
      }
    }
  }

  if (state.public.teamSelection !== undefined) {
    assertObjectRecord(state.public.teamSelection, "state.public.teamSelection");
    if (state.public.teamSelection.pickCount !== undefined) {
      assertNumber(state.public.teamSelection.pickCount, "state.public.teamSelection.pickCount");
    }
    if (state.public.teamSelection.selectedMemberIds !== undefined) {
      assertStringArray(state.public.teamSelection.selectedMemberIds, "state.public.teamSelection.selectedMemberIds");
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
    if (deterministic.guard.card.locked !== undefined) {
      assertBoolean(deterministic.guard.card.locked, `${actionPath}.deterministic.guard.card.locked`);
    }
    if (deterministic.guard.card.available !== undefined) {
      assertBoolean(deterministic.guard.card.available, `${actionPath}.deterministic.guard.card.available`);
    }
  }

  if (deterministic.guard.teamSelection !== undefined) {
    assertObjectRecord(deterministic.guard.teamSelection, `${actionPath}.deterministic.guard.teamSelection`);
    if (deterministic.guard.teamSelection.pickCountLessThan !== undefined) {
      assertNumber(
        deterministic.guard.teamSelection.pickCountLessThan,
        `${actionPath}.deterministic.guard.teamSelection.pickCountLessThan`
      );
    }
    if (deterministic.guard.teamSelection.pickCountEquals !== undefined) {
      assertNumber(
        deterministic.guard.teamSelection.pickCountEquals,
        `${actionPath}.deterministic.guard.teamSelection.pickCountEquals`
      );
    }
  }

  if (deterministic.guard.team !== undefined) {
    assertObjectRecord(deterministic.guard.team, `${actionPath}.deterministic.guard.team`);
    assertString(deterministic.guard.team.memberId, `${actionPath}.deterministic.guard.team.memberId`);
    if (deterministic.guard.team.selected !== undefined) {
      assertBoolean(deterministic.guard.team.selected, `${actionPath}.deterministic.guard.team.selected`);
    }
  }

  if (deterministic.guard.board !== undefined) {
    assertObjectRecord(deterministic.guard.board, `${actionPath}.deterministic.guard.board`);
    assertArray(deterministic.guard.board.cardIds, `${actionPath}.deterministic.guard.board.cardIds`);
    if (deterministic.guard.board.cardIds.length === 0) {
      throw new ManifestValidationError(
        `Manifest field "${actionPath}.deterministic.guard.board.cardIds" must not be empty`
      );
    }
    deterministic.guard.board.cardIds.forEach((cardId, index) => {
      assertString(cardId, `${actionPath}.deterministic.guard.board.cardIds[${index}]`);
    });
    if (deterministic.guard.board.resolvedCountAtLeast !== undefined) {
      assertNumber(
        deterministic.guard.board.resolvedCountAtLeast,
        `${actionPath}.deterministic.guard.board.resolvedCountAtLeast`
      );
    }
  }

  validateMetricDeltaList(deterministic.metricDeltas, `${actionPath}.deterministic.metricDeltas`);

  if (deterministic.conditionalMetricBonuses !== undefined) {
    assertArray(
      deterministic.conditionalMetricBonuses,
      `${actionPath}.deterministic.conditionalMetricBonuses`
    );
    if (deterministic.conditionalMetricBonuses.length === 0) {
      throw new ManifestValidationError(
        `Manifest field "${actionPath}.deterministic.conditionalMetricBonuses" must not be empty`
      );
    }

    deterministic.conditionalMetricBonuses.forEach((bonus, index) => {
      const bonusPath = `${actionPath}.deterministic.conditionalMetricBonuses[${index}]`;
      assertObjectRecord(bonus, bonusPath);
      validateMetricCondition(bonus.when, `${bonusPath}.when`);
      const bonusMetricDeltas = validateMetricDeltaList(bonus.metricDeltas, `${bonusPath}.metricDeltas`);
      if (bonusMetricDeltas.length === 0) {
        throw new ManifestValidationError(`Manifest field "${bonusPath}.metricDeltas" must not be empty`);
      }
    });
  }

  if (deterministic.conditionalCardBonuses !== undefined) {
    assertArray(
      deterministic.conditionalCardBonuses,
      `${actionPath}.deterministic.conditionalCardBonuses`
    );
    if (deterministic.conditionalCardBonuses.length === 0) {
      throw new ManifestValidationError(
        `Manifest field "${actionPath}.deterministic.conditionalCardBonuses" must not be empty`
      );
    }

    deterministic.conditionalCardBonuses.forEach((bonus, index) => {
      const bonusPath = `${actionPath}.deterministic.conditionalCardBonuses[${index}]`;
      assertObjectRecord(bonus, bonusPath);
      assertObjectRecord(bonus.whenCard, `${bonusPath}.whenCard`);
      assertString(bonus.whenCard.cardId, `${bonusPath}.whenCard.cardId`);
      if (bonus.whenCard.selected !== undefined) {
        assertBoolean(bonus.whenCard.selected, `${bonusPath}.whenCard.selected`);
      }
      if (bonus.whenCard.resolved !== undefined) {
        assertBoolean(bonus.whenCard.resolved, `${bonusPath}.whenCard.resolved`);
      }
      if (bonus.whenCard.locked !== undefined) {
        assertBoolean(bonus.whenCard.locked, `${bonusPath}.whenCard.locked`);
      }
      if (bonus.whenCard.available !== undefined) {
        assertBoolean(bonus.whenCard.available, `${bonusPath}.whenCard.available`);
      }
      const bonusMetricDeltas = validateMetricDeltaList(bonus.metricDeltas, `${bonusPath}.metricDeltas`);
      if (bonusMetricDeltas.length === 0) {
        throw new ManifestValidationError(`Manifest field "${bonusPath}.metricDeltas" must not be empty`);
      }
    });
  }

  if (deterministic.conditionalLineSwitch !== undefined) {
    assertObjectRecord(deterministic.conditionalLineSwitch, `${actionPath}.deterministic.conditionalLineSwitch`);
    validateMetricCondition(
      deterministic.conditionalLineSwitch.when,
      `${actionPath}.deterministic.conditionalLineSwitch.when`
    );
    assertString(
      deterministic.conditionalLineSwitch.targetLine,
      `${actionPath}.deterministic.conditionalLineSwitch.targetLine`
    );
    assertNumber(
      deterministic.conditionalLineSwitch.targetStepIndex,
      `${actionPath}.deterministic.conditionalLineSwitch.targetStepIndex`
    );
    if (deterministic.conditionalLineSwitch.targetStageId !== undefined) {
      assertString(
        deterministic.conditionalLineSwitch.targetStageId,
        `${actionPath}.deterministic.conditionalLineSwitch.targetStageId`
      );
    }
    if (deterministic.conditionalLineSwitch.targetScreenId !== undefined) {
      assertString(
        deterministic.conditionalLineSwitch.targetScreenId,
        `${actionPath}.deterministic.conditionalLineSwitch.targetScreenId`
      );
    }
    if (deterministic.conditionalLineSwitch.targetInfoId !== undefined) {
      assertString(
        deterministic.conditionalLineSwitch.targetInfoId,
        `${actionPath}.deterministic.conditionalLineSwitch.targetInfoId`
      );
    }
    if (deterministic.conditionalLineSwitch.timelineCanAdvance !== undefined) {
      assertBoolean(
        deterministic.conditionalLineSwitch.timelineCanAdvance,
        `${actionPath}.deterministic.conditionalLineSwitch.timelineCanAdvance`
      );
    }
  }

  if (deterministic.conditionalInfoVariant !== undefined) {
    assertObjectRecord(deterministic.conditionalInfoVariant, `${actionPath}.deterministic.conditionalInfoVariant`);
    validateMetricCondition(
      deterministic.conditionalInfoVariant.when,
      `${actionPath}.deterministic.conditionalInfoVariant.when`
    );
    assertString(
      deterministic.conditionalInfoVariant.activeInfoId,
      `${actionPath}.deterministic.conditionalInfoVariant.activeInfoId`
    );
  }

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
  if (deterministic.stateUpdate.timelineStepIndex !== undefined) {
    assertNumber(deterministic.stateUpdate.timelineStepIndex, `${actionPath}.deterministic.stateUpdate.timelineStepIndex`);
  }
  if (deterministic.stateUpdate.timelineStageId !== undefined) {
    assertString(deterministic.stateUpdate.timelineStageId, `${actionPath}.deterministic.stateUpdate.timelineStageId`);
  }
  if (deterministic.stateUpdate.timelineScreenId !== undefined) {
    assertString(deterministic.stateUpdate.timelineScreenId, `${actionPath}.deterministic.stateUpdate.timelineScreenId`);
  }
  if (deterministic.stateUpdate.activeInfoId !== undefined) {
    assertString(deterministic.stateUpdate.activeInfoId, `${actionPath}.deterministic.stateUpdate.activeInfoId`);
  }
  if (deterministic.stateUpdate.selectedCardId !== undefined) {
    assertString(deterministic.stateUpdate.selectedCardId, `${actionPath}.deterministic.stateUpdate.selectedCardId`);
  }
  if (deterministic.stateUpdate.boardThreshold !== undefined) {
    assertObjectRecord(deterministic.stateUpdate.boardThreshold, `${actionPath}.deterministic.stateUpdate.boardThreshold`);
    assertArray(
      deterministic.stateUpdate.boardThreshold.cardIds,
      `${actionPath}.deterministic.stateUpdate.boardThreshold.cardIds`
    );
    if (deterministic.stateUpdate.boardThreshold.cardIds.length === 0) {
      throw new ManifestValidationError(
        `Manifest field "${actionPath}.deterministic.stateUpdate.boardThreshold.cardIds" must not be empty`
      );
    }
    deterministic.stateUpdate.boardThreshold.cardIds.forEach((cardId, index) => {
      assertString(cardId, `${actionPath}.deterministic.stateUpdate.boardThreshold.cardIds[${index}]`);
    });
    assertNumber(
      deterministic.stateUpdate.boardThreshold.resolvedCountAtLeast,
      `${actionPath}.deterministic.stateUpdate.boardThreshold.resolvedCountAtLeast`
    );
    if (deterministic.stateUpdate.boardThreshold.timelineCanAdvance !== undefined) {
      assertBoolean(
        deterministic.stateUpdate.boardThreshold.timelineCanAdvance,
        `${actionPath}.deterministic.stateUpdate.boardThreshold.timelineCanAdvance`
      );
    }
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
    if (deterministic.stateUpdate.cardFlags.locked !== undefined) {
      assertBoolean(deterministic.stateUpdate.cardFlags.locked, `${actionPath}.deterministic.stateUpdate.cardFlags.locked`);
    }
    if (deterministic.stateUpdate.cardFlags.available !== undefined) {
      assertBoolean(deterministic.stateUpdate.cardFlags.available, `${actionPath}.deterministic.stateUpdate.cardFlags.available`);
    }
  }

  if (deterministic.stateUpdate.boardCardUnlock !== undefined) {
    assertObjectRecord(deterministic.stateUpdate.boardCardUnlock, `${actionPath}.deterministic.stateUpdate.boardCardUnlock`);
    assertArray(
      deterministic.stateUpdate.boardCardUnlock.cardIds,
      `${actionPath}.deterministic.stateUpdate.boardCardUnlock.cardIds`
    );
    if (deterministic.stateUpdate.boardCardUnlock.cardIds.length === 0) {
      throw new ManifestValidationError(
        `Manifest field "${actionPath}.deterministic.stateUpdate.boardCardUnlock.cardIds" must not be empty`
      );
    }
    deterministic.stateUpdate.boardCardUnlock.cardIds.forEach((cardId, index) => {
      assertString(cardId, `${actionPath}.deterministic.stateUpdate.boardCardUnlock.cardIds[${index}]`);
    });
    assertNumber(
      deterministic.stateUpdate.boardCardUnlock.resolvedCountAtLeast,
      `${actionPath}.deterministic.stateUpdate.boardCardUnlock.resolvedCountAtLeast`
    );
    assertString(
      deterministic.stateUpdate.boardCardUnlock.unlockCardId,
      `${actionPath}.deterministic.stateUpdate.boardCardUnlock.unlockCardId`
    );
  }

  if (deterministic.stateUpdate.boardEntryAltCardSwap !== undefined) {
    assertObjectRecord(
      deterministic.stateUpdate.boardEntryAltCardSwap,
      `${actionPath}.deterministic.stateUpdate.boardEntryAltCardSwap`
    );
    validateMetricCondition(
      deterministic.stateUpdate.boardEntryAltCardSwap.when,
      `${actionPath}.deterministic.stateUpdate.boardEntryAltCardSwap.when`
    );
    assertString(
      deterministic.stateUpdate.boardEntryAltCardSwap.baseCardId,
      `${actionPath}.deterministic.stateUpdate.boardEntryAltCardSwap.baseCardId`
    );
    assertString(
      deterministic.stateUpdate.boardEntryAltCardSwap.altCardId,
      `${actionPath}.deterministic.stateUpdate.boardEntryAltCardSwap.altCardId`
    );
  }

  if (deterministic.stateUpdate.teamFlags !== undefined) {
    assertObjectRecord(deterministic.stateUpdate.teamFlags, `${actionPath}.deterministic.stateUpdate.teamFlags`);
    assertString(deterministic.stateUpdate.teamFlags.memberId, `${actionPath}.deterministic.stateUpdate.teamFlags.memberId`);
    if (deterministic.stateUpdate.teamFlags.selected !== undefined) {
      assertBoolean(
        deterministic.stateUpdate.teamFlags.selected,
        `${actionPath}.deterministic.stateUpdate.teamFlags.selected`
      );
    }
  }

  if (deterministic.stateUpdate.teamSelection !== undefined) {
    assertObjectRecord(deterministic.stateUpdate.teamSelection, `${actionPath}.deterministic.stateUpdate.teamSelection`);
    if (deterministic.stateUpdate.teamSelection.pickCountDelta !== undefined) {
      assertNumber(
        deterministic.stateUpdate.teamSelection.pickCountDelta,
        `${actionPath}.deterministic.stateUpdate.teamSelection.pickCountDelta`
      );
    }
    if (deterministic.stateUpdate.teamSelection.selectedMemberIdsAppend !== undefined) {
      assertString(
        deterministic.stateUpdate.teamSelection.selectedMemberIdsAppend,
        `${actionPath}.deterministic.stateUpdate.teamSelection.selectedMemberIdsAppend`
      );
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
