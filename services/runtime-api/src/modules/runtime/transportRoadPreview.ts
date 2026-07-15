/**
 * Read-only orchestration for schema-declared transport-road previews.
 *
 * This module binds an action declaration to the generic road planner without
 * knowing any game id. It validates role, current action guards and only the
 * two endpoint references named by `transport.road.build`; payment remains part
 * of the later authoritative action dispatch.
 */
import type {
  TransportRoadPreviewRequest,
  TransportRoadPreviewResponse,
  SessionRecord
} from "@cubica/contracts-session";
import type { GameManifestDeterministicEffect } from "@cubica/contracts-manifest";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";
import type { GameBundle } from "../content/manifestLoader.ts";
import { RequestValidationError } from "../errors.ts";
import {
  resolveActionReferences,
  validateActionReferenceParameterSubset
} from "./actionParameters.ts";
import { evaluateManifestActionGuardForProjection, readManifestDeterministicMetadata } from "./deterministicHandlers.ts";
import { getRegisteredActionDefinition } from "./actionRegistry.ts";
import { previewTransportRoadBuild } from "./transportNetwork.ts";

type RuntimeState = Record<string, unknown>;
type RoadBuildEffect = Extract<GameManifestDeterministicEffect, { op: "transport.road.build" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Prefer explicit attribution, then the public active participant, then the session owner. */
const resolveActorPlayerId = (
  snapshot: SessionRecord<RuntimeState>,
  requestedPlayerId: string | undefined
): string | undefined => {
  if (requestedPlayerId) return requestedPlayerId;
  const publicState = isRecord(snapshot.state.public) ? snapshot.state.public : {};
  const turn = isRecord(publicState.turn) ? publicState.turn : {};
  return typeof turn.activePlayerId === "string" && turn.activePlayerId.trim() !== ""
    ? turn.activePlayerId
    : snapshot.playerId;
};

/** Build the common context used by guard and template resolution. */
const createActionContext = (options: {
  snapshot: SessionRecord<RuntimeState>;
  input: TransportRoadPreviewRequest;
  definition: NonNullable<ReturnType<typeof getRegisteredActionDefinition>>;
}): RuntimeActionContext<RuntimeState> => ({
  sessionId: options.snapshot.sessionId,
  gameId: options.snapshot.gameId,
  actionId: options.input.actionId,
  actorPlayerId: resolveActorPlayerId(options.snapshot, options.input.playerId),
  sessionRole: options.snapshot.sessionRole ?? "player",
  params: options.input.params,
  state: options.snapshot.state,
  now: options.snapshot.updatedAt,
  manifestAction: options.definition
});

/**
 * Produce a safe, non-authoritative preview from one immutable session
 * snapshot. Version lookup and conflict mapping remain RuntimeService duties.
 */
export const previewRuntimeTransportRoad = (options: {
  snapshot: SessionRecord<RuntimeState>;
  bundle: GameBundle;
  input: TransportRoadPreviewRequest;
}): TransportRoadPreviewResponse => {
  const { snapshot, bundle, input } = options;
  const definition = getRegisteredActionDefinition(bundle, input.actionId);
  if (!definition) {
    throw new RequestValidationError(
      `Action "${input.actionId}" is not defined for game "${snapshot.gameId}"`
    );
  }
  const sessionRole = snapshot.sessionRole ?? "player";
  if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
    throw new RequestValidationError(
      `Action "${input.actionId}" is not available to the current session role`
    );
  }
  if (definition.handlerType !== "manifest-data" && definition.handlerType !== "manifest-template") {
    throw new RequestValidationError(
      `Action "${input.actionId}" does not declare a previewable transport operation`
    );
  }

  const context = createActionContext({ snapshot, input, definition });
  const metadata = readManifestDeterministicMetadata(context, bundle.manifest.templates);
  const roadEffects = (metadata?.effects ?? []).filter(
    (effect): effect is RoadBuildEffect => effect.op === "transport.road.build"
  );
  const roadEffectIndex = metadata?.effects?.findIndex((effect) => effect.op === "transport.road.build") ?? -1;
  if (roadEffects.length !== 1 || roadEffectIndex !== 0) {
    throw new RequestValidationError(
      `Action "${input.actionId}" must declare one leading transport road build effect for preview`
    );
  }

  const effect = roadEffects[0];
  const networkModel = bundle.manifest.networkModels?.[effect.networkId];
  if (!networkModel || networkModel.visibility !== "public") {
    // A public preview endpoint must never confirm that a secret graph or
    // secret resource exists. Fail closed before resolving endpoint ids.
    throw new RequestValidationError(
      `Action "${input.actionId}" does not expose a public transport-road preview`
    );
  }
  const endpointNames = [effect.fromNodeParam, effect.toNodeParam];
  const params = validateActionReferenceParameterSubset(
    definition,
    input.params,
    endpointNames,
    { requiredVisibility: "public" }
  );
  const guard = evaluateManifestActionGuardForProjection(
    { ...context, params },
    bundle.manifest.templates
  );
  if (!guard.metadataPresent || guard.failures.length > 0) {
    throw new RequestValidationError(
      `Action "${input.actionId}" is not available in the current session state`
    );
  }
  const resolvedRefs = resolveActionReferences(
    definition,
    params,
    snapshot.state,
    endpointNames
  );
  if (endpointNames.some((parameterName) => resolvedRefs[parameterName]?.visibility !== "public")) {
    throw new RequestValidationError(
      `Action "${input.actionId}" does not expose a public transport-road preview`
    );
  }

  try {
    const preview = previewTransportRoadBuild({
      state: snapshot.state,
      effect,
      resolvedRefs,
      networkModels: bundle.manifest.networkModels
    });
    return {
      sessionId: snapshot.sessionId,
      actionId: input.actionId,
      usedStateVersion: snapshot.version.stateVersion,
      ...preview
    };
  } catch {
    // Geometry diagnostics can reveal internal state paths or content details.
    // Public callers receive only a stable product-level failure.
    throw new RequestValidationError(
      `Action "${input.actionId}" cannot be previewed for the selected endpoints in the current session state`
    );
  }
};
