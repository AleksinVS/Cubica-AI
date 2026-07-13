/**
 * Projects manifest actions into safe availability data for delivery clients.
 *
 * This module never changes session state and never returns technical guard
 * details. It delegates condition evaluation to the same deterministic guard
 * implementation that protects dispatch, preventing UI/runtime rule drift.
 */

import type {
  SessionActionAvailability,
  SessionRecord
} from "@cubica/contracts-session";
import type { GameBundle } from "../content/manifestLoader.ts";
import { evaluateManifestActionGuardForProjection } from "./deterministicHandlers.ts";
import { listManifestActionDefinitions } from "./manifestActions.ts";

type RuntimeState = Record<string, unknown>;

const supportedHandlerTypes = new Set(["script", "manifest-data", "manifest-template"]);

const hasMissingRequiredParameters = (
  definition: ReturnType<typeof listManifestActionDefinitions>[number]
): boolean => {
  const required = Array.isArray(definition.paramsSchema?.required)
    ? definition.paramsSchema.required.filter((name): name is string => typeof name === "string")
    : [];
  const declaredParams = definition.params ?? {};
  return required.some((name) => declaredParams[name] === undefined);
};

const readProjectedActorPlayerId = (snapshot: SessionRecord<RuntimeState>): string | undefined => {
  const publicState = isRecord(snapshot.state.public) ? snapshot.state.public : {};
  const turn = isRecord(publicState.turn) ? publicState.turn : {};
  return typeof turn.activePlayerId === "string" && turn.activePlayerId.trim() !== ""
    ? turn.activePlayerId
    : snapshot.playerId;
};

/** Build the complete action projection for one authoritative session snapshot. */
export function projectSessionActionAvailability(
  snapshot: SessionRecord<RuntimeState>,
  bundle: GameBundle
): Array<SessionActionAvailability> {
  const sessionRole = snapshot.sessionRole ?? "player";
  const actorPlayerId = readProjectedActorPlayerId(snapshot);

  return listManifestActionDefinitions(bundle).map((definition) => {
    if (definition.allowedSessionRoles && !definition.allowedSessionRoles.includes(sessionRole)) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "role_not_allowed"
      };
    }

    if (!supportedHandlerTypes.has(definition.handlerType)) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported"
      };
    }

    // Legacy declarative `script` actions use the generic capability handler
    // and do not carry manifest guard metadata. They are executable whenever
    // role checks pass; parameter schemas still tell clients whether input is
    // required before the final dispatch validation.
    if (definition.handlerType === "script") {
      return hasMissingRequiredParameters(definition)
        ? {
            actionId: definition.actionId,
            status: "parameter-dependent",
            reasonCode: "parameters_required"
          }
        : { actionId: definition.actionId, status: "available" };
    }

    let evaluation: ReturnType<typeof evaluateManifestActionGuardForProjection>;
    try {
      evaluation = evaluateManifestActionGuardForProjection({
        sessionId: snapshot.sessionId,
        gameId: snapshot.gameId,
        actionId: definition.actionId,
        actorPlayerId,
        sessionRole,
        state: snapshot.state,
        now: snapshot.updatedAt,
        manifestAction: definition
      }, bundle.manifest.templates);
    } catch {
      // One malformed or newly introduced guard must fail closed for that
      // action, not turn an otherwise valid session snapshot into HTTP 500.
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported"
      };
    }

    if (!evaluation.metadataPresent) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "runtime_unsupported"
      };
    }
    if (evaluation.failures.length > 0) {
      return {
        actionId: definition.actionId,
        status: "unavailable",
        reasonCode: "state_condition_failed"
      };
    }
    if (evaluation.parameterChecksDeferred) {
      return {
        actionId: definition.actionId,
        status: "parameter-dependent",
        reasonCode: "parameters_required"
      };
    }
    return { actionId: definition.actionId, status: "available" };
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
