import { ManifestAction } from "@cubica/contracts-manifest";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Separates UI routing metadata from deterministic action parameters.
 *
 * `actionId` tells player-web where to route the click; it is not part of a
 * game's params schema. New manifests can group parameters under `params`,
 * while older manifests may keep application fields beside `actionId`.
 */
const manifestActionParams = (
  payload: Record<string, unknown>,
  routingKeys: ReadonlySet<string>
): Record<string, unknown> => {
  if (isRecord(payload.params)) {
    return payload.params;
  }
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !routingKeys.has(key) && key !== "params")
  );
};

/**
 * Creates an adapter that converts UI commands from the manifest
 * into runtime action IDs for dispatch.
 *
 * Supports two levels of customization:
 * 1. commandMap — static mapping of commands to actionId
 * 2. resolveActionId — dynamic resolution (e.g., finding cardId in boardCards)
 *
 * If neither commandMap nor resolveActionId are specified, a small default
 * set of runtime-oriented commands is used. Pure UI commands such as showPanel
 * are handled by the Presenter before this adapter is called.
 */
export function createManifestActionAdapter(options: {
  /** Game-specific content (type unknown — plugin casts to its own type) */
  gameContent: unknown;
  /** Mapping of manifest commands to runtime action IDs */
  commandMap?: Record<string, string>;
  /** Dynamic command resolution. Called before commandMap lookup. */
  resolveActionId?: (command: string, payload: Record<string, unknown>) => string | null;
  /** Dispatch action callback */
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  /** Error callback */
  onError: (message: string) => void;
}): (command: string, payload: Record<string, unknown>) => void {
  const { commandMap, resolveActionId, dispatchAction, onError } = options;

  return (command: string, payload: Record<string, unknown>) => {
    // 1. Try dynamic resolution (plugin may search by cardId etc.)
    if (resolveActionId) {
      const actionId = resolveActionId(command, payload);
      if (actionId) {
        dispatchAction(actionId, payload);
        return;
      }
    }

    // 2. Try static mapping
    if (commandMap && command in commandMap) {
      dispatchAction(commandMap[command], payload);
      return;
    }

    // 3. Generic manifest-driven dispatch: simple games put the exact runtime
    // action id into the UI payload, so no plugin resolver is needed.
    if (command === ManifestAction.REQUEST_SERVER) {
      const actionId = payload.actionId;
      if (typeof actionId === "string" && actionId.trim()) {
        dispatchAction(actionId, manifestActionParams(payload, new Set(["actionId"])));
        return;
      }

      dispatchAction(ManifestAction.REQUEST_SERVER, payload);
      return;
    }

    if (command === ManifestAction.ADVANCE) {
      const actionId = payload.actionId ?? payload.advanceActionId;
      if (typeof actionId === "string" && actionId.trim()) {
        dispatchAction(actionId, manifestActionParams(payload, new Set(["actionId", "advanceActionId"])));
        return;
      }

      dispatchAction(ManifestAction.ADVANCE, payload);
      return;
    }

    onError(`Unknown manifest command: ${command}`);
  };
}
