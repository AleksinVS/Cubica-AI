/**
 * Materializes runtime-owned participant, turn and random state from a manifest.
 *
 * Game manifests declare a reusable participant template and allowed phases;
 * concrete participant ids belong to the session snapshot. Author-provided
 * generator state is always removed because production randomness is owned by
 * the server and is not persisted.
 */
import type {
  GameManifest,
  GameManifestPlayersTemplate
} from "@cubica/contracts-manifest";

type RuntimeState = Record<string, unknown>;

export interface InitializeTurnBasedSessionOptions {
  /** Future launch surfaces may choose a value inside manifest player bounds. */
  participantCount?: number;
}

export class ParticipantCountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParticipantCountValidationError";
  }
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const resolveParticipantCount = (manifest: GameManifest, requested?: number): number => {
  const minimum = manifest.config.players.min;
  const maximum = manifest.config.players.max;
  const count = requested ?? minimum;

  if (![minimum, maximum, count].every((value) => Number.isSafeInteger(value))) {
    throw new ParticipantCountValidationError("Manifest player bounds and participant count must be safe integers");
  }
  if (minimum < 1 || maximum < minimum || count < minimum || count > maximum) {
    throw new ParticipantCountValidationError(`Participant count ${count} is outside manifest bounds ${minimum}..${maximum}`);
  }

  return count;
};

const materializePlayer = (template: GameManifestPlayersTemplate): RuntimeState => ({
  metrics: structuredClone(template.metrics),
  flags: structuredClone(template.flags ?? {}),
  objects: structuredClone(template.objects ?? {}),
  status: template.status ?? "active"
});

/** Expand the declared participant template without mutating cached state. */
export const initializeTurnBasedSessionState = (
  manifest: GameManifest,
  declaredState: RuntimeState,
  options: InitializeTurnBasedSessionOptions = {}
): RuntimeState => {
  const state = structuredClone(declaredState);
  const participantCount = resolveParticipantCount(manifest, options.participantCount);
  const template = manifest.state.playersTemplate;
  const phases = manifest.config.turnModel?.phases ?? [];

  if (template) {
    const order = Array.from({ length: participantCount }, (_, index) => `p${index + 1}`);
    state.players = Object.fromEntries(order.map((playerId) => [playerId, materializePlayer(template)]));

    if (phases.length > 0) {
      const publicState = isObjectRecord(state.public) ? state.public : {};
      publicState.turn = {
        order,
        activePlayerId: order[0],
        phase: phases[0],
        turnNumber: 1
      };
      state.public = publicState;
    }
  }

  // `playersTemplate` is authoring input, not live state. Leaving it in the
  // snapshot would expose two competing sources of truth for player balances.
  delete state.playersTemplate;

  const declaredSecretState = isObjectRecord(state.secret) ? state.secret : undefined;
  // Removing an authored value unconditionally keeps a game from smuggling a
  // known seed into server-owned randomness.
  if (declaredSecretState) delete declaredSecretState.random;

  return state;
};
