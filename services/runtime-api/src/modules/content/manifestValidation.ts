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
  assertArray(state.public.log, "state.public.log");
  assertObjectRecord(state.public.flags, "state.public.flags");
  assertObjectRecord(state.public.flags.cards, "state.public.flags.cards");

  if (state.secret !== undefined) {
    assertObjectRecord(state.secret, "state.secret");
  }

  return state as unknown as GameManifestState;
};

const validateActions = (actions: unknown): Record<string, GameManifestActionDefinition> => {
  assertObjectRecord(actions, "actions");

  for (const [actionId, action] of Object.entries(actions)) {
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
