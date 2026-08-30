import type { GameBundle } from "../content/manifestLoader.ts";
import type { GameIntentCatalog } from "@cubica/contracts-manifest";
import type { RuntimeManifestActionDefinition } from "@cubica/contracts-runtime";
import { compareCanonicalIds } from "../mechanics/canonicalOrder.ts";

const readActionsObject = (bundle: GameBundle): GameIntentCatalog => bundle.manifest.actions;

const actionDefinitionCache = new WeakMap<
  GameBundle,
  ReadonlyArray<RuntimeManifestActionDefinition>
>();

export function listManifestActionDefinitions(bundle: GameBundle): Array<RuntimeManifestActionDefinition> {
  const cached = actionDefinitionCache.get(bundle);
  if (cached) {
    // Preserve the established mutable-array return contract without exposing
    // the shared cached container. Its definition objects remain frozen.
    return [...cached];
  }

  // PostgreSQL JSONB and other manifest transports do not promise to retain
  // author insertion order. Sorting at this trust boundary keeps every action
  // consumer—including the agent catalog—independent of storage key order.
  const definitions = Object.entries(readActionsObject(bundle))
    .sort(([leftActionId], [rightActionId]) => compareCanonicalIds(leftActionId, rightActionId))
    .map(([actionId, action]) => {
      // Game Intent validation has already admitted this catalog. This single
      // explicit unknown bridge exists only because the runtime contract keeps
      // an immutable raw JSON view for hashing and diagnostics.
      const raw = action as unknown as Record<string, unknown>;
      const allowedSessionRoles = action.allowedSessionRoles
        ? [...action.allowedSessionRoles]
        : undefined;
      if (allowedSessionRoles) {
        Object.freeze(allowedSessionRoles);
      }
      const definition: RuntimeManifestActionDefinition = {
        actionId,
        // Current publication requires invocation. The fallback exists only
        // for integrity-checked historic immutable bundles on exact receipt
        // replay; old actions were exclusively external.
        invocation: action.invocation ?? "external",
        definitionHash: action.definitionHash,
        binding: action.binding,
        capabilityFamily: action.capabilityFamily,
        capability: action.capability,
        functionName: action.function,
        paramsSchema: action.paramsSchema as unknown as Record<string, unknown> | undefined,
        allowedSessionRoles,
        raw
      };
      return Object.freeze(definition);
    });

  // The returned catalog is shared by all consumers of the same immutable
  // bundle. Freezing both the array and its copied role lists prevents one
  // consumer from corrupting ordering or authorization data for another.
  const immutableDefinitions = Object.freeze(definitions);
  actionDefinitionCache.set(bundle, immutableDefinitions);
  return [...immutableDefinitions];
}

export function getManifestActionDefinition(bundle: GameBundle, actionId: string) {
  return listManifestActionDefinitions(bundle).find((definition) => definition.actionId === actionId) ?? null;
}
