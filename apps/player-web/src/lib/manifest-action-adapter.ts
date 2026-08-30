import { ManifestAction } from "@cubica/contracts-manifest";

/**
 * Separates the published action binding from schema-validated parameters.
 *
 * The adapter never derives an action from card state, phase, command names,
 * or game-specific maps. The UI manifest must publish the exact actionId.
 */
const publishedActionParams = (payload: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== "actionId" && key !== "params")
  );
};

/**
 * Routes a manifest UI event through one explicit published Game Intent.
 * Local panel commands are handled by the Presenter and never reach here.
 */
export function createManifestActionAdapter(options: {
  readonly dispatchAction: (actionId: string, params?: Record<string, unknown>) => void;
  readonly onError: (message: string) => void;
}): (command: string, payload: Record<string, unknown>) => void {
  const { dispatchAction, onError } = options;

  return (command: string, payload: Record<string, unknown>) => {
    if (command !== ManifestAction.REQUEST_SERVER && command !== ManifestAction.ADVANCE) {
      onError(`Manifest command "${command}" is not a published runtime action binding.`);
      return;
    }

    const actionId = payload.actionId;
    if (typeof actionId !== "string" || actionId.trim() === "") {
      onError(`Manifest command "${command}" does not declare an explicit actionId.`);
      return;
    }

    if (Object.hasOwn(payload, "params")) {
      onError(
        `Manifest command "${command}" uses the removed nested payload.params format; publish action parameters beside actionId.`
      );
      return;
    }

    dispatchAction(actionId, publishedActionParams(payload));
  };
}
