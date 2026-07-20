/**
 * Materializes runtime-owned participant, turn and random state from a manifest.
 *
 * Game manifests declare a reusable participant template and allowed phases;
 * concrete participant ids and replay state belong to the session snapshot.
 */
import type {
  GameManifest,
  GameManifestPlayersTemplate
} from "@cubica/contracts-manifest";
import { createSessionRandomStreamsState } from "../runtime/sessionRandom.ts";

type RuntimeState = Record<string, unknown>;

export interface InitializeTurnBasedSessionOptions {
  /** Future launch surfaces may choose a value inside manifest player bounds. */
  participantCount?: number;
  /** Test/editor replay hook; production callers omit this cryptographic seed. */
  randomSeed?: string;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const SESSION_RANDOM_OPERATIONS = new Set(["random.dice.roll", "deck.shuffle", "deck.draw"]);

/**
 * Detect every Mechanics operation that consumes the runtime-owned generator.
 *
 * A draw needs the generator even when the current deck is not empty because
 * its declared empty-deck policy may reshuffle the discard pile. Initializing
 * from the complete manifest keeps that future branch replay-safe as well.
 */
const manifestUsesSessionRandomness = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.some(manifestUsesSessionRandomness);
  }
  if (!isObjectRecord(value)) {
    return false;
  }
  if (value.op === "core.entities.order" &&
      isObjectRecord(value.tieBreak) &&
      value.tieBreak.kind === "seeded-random") {
    return true;
  }
  if (typeof value.op === "string" && SESSION_RANDOM_OPERATIONS.has(value.op)) {
    return true;
  }
  return Object.values(value).some(manifestUsesSessionRandomness);
};

/** Road planning consumes randomness only when several minimum routes exist. */
const manifestUsesRandomRoadPlanning = (manifest: GameManifest): boolean =>
  Object.values(manifest.networkModels ?? {}).some((network) => network.roadPlanning?.tieBreak === "session-random");

const validateParticipantCount = (manifest: GameManifest, requested?: number): number => {
  const minimum = manifest.config.players.min;
  const maximum = manifest.config.players.max;
  const count = requested ?? minimum;

  if (![minimum, maximum, count].every((value) => Number.isSafeInteger(value))) {
    throw new Error("Manifest player bounds and participant count must be safe integers");
  }
  if (minimum < 1 || maximum < minimum || count < minimum || count > maximum) {
    throw new Error(`Participant count ${count} is outside manifest bounds ${minimum}..${maximum}`);
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
  const template = manifest.state.playersTemplate;
  const phases = manifest.config.turnModel?.phases ?? [];

  if (template) {
    const participantCount = validateParticipantCount(manifest, options.participantCount);
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

  if (manifestUsesSessionRandomness(manifest.mechanics) ||
      manifestUsesRandomRoadPlanning(manifest)) {
    const secretState = isObjectRecord(state.secret) ? state.secret : {};
    // Random state is session-owned by contract. Always replace authoring data
    // so a seed accidentally committed to a manifest cannot make every new
    // production session consume the same predictable random sequence.
    secretState.random = createSessionRandomStreamsState(options.randomSeed);
    state.secret = secretState;
  }

  return state;
};
