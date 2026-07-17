/**
 * Builds the single actor-scoped state view used by every player-facing API.
 *
 * Visibility comes from the immutable Mechanics `stateModel`, not from a
 * physical state branch name. This matters because a game may store public
 * per-player values below `players.<id>` while keeping other values in the
 * same record actor-confidential. Projection is deny-by-default: undeclared
 * values, server-labelled symbols, the complete `secret` root and private
 * symbols belonging to another actor never leave runtime.
 */
import type {
  StateModel,
  StorageLocation,
  StorageSegment
} from "@cubica/contracts-manifest";

type RuntimeState = Record<string, unknown>;

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

export interface PlayerSessionProjectionInput {
  /** Authoritative state from the session store. It is never mutated. */
  state: RuntimeState;
  /** State model pinned by the session's immutable game bundle. */
  stateModel: StateModel;
  /** Actor resolved from the authenticated principal by runtime. */
  actorPlayerId?: string;
}

export interface PlayerSessionProjection {
  /** State-shaped REST/WebSocket view with public and current-actor data. */
  state: RuntimeState;
  /** State-shaped subset declared with `audienceRef: public`. */
  publicAudienceState: RuntimeState;
  /** State-shaped subset declared with `audienceRef: actor` for this actor. */
  actorAudienceState: RuntimeState;
}

interface ExpandedValue {
  path: string[];
  value: unknown;
  /** Keys substituted for every `{ context: "actor" }` segment. */
  actorKeys: string[];
}

/**
 * Return only values explicitly labelled for the public or authenticated
 * actor audiences in the pinned state model.
 */
export function projectPlayerSessionState(
  input: PlayerSessionProjectionInput
): RuntimeState {
  return buildPlayerSessionProjection(input).state;
}

/** Build both the combined player view and its explicit audience channels. */
export function buildPlayerSessionProjection(
  input: PlayerSessionProjectionInput
): PlayerSessionProjection {
  const source = input.state;
  const publicAudienceState: RuntimeState = {};
  const actorAudienceState: RuntimeState = {};
  const symbols = [
    ...Object.values(input.stateModel.endpoints),
    ...Object.values(input.stateModel.collections)
  ];

  // First copy allowlisted symbols. Public symbols with an actor placeholder
  // are expanded for every participant because the declaration—not the
  // physical `players` root—makes those values public.
  for (const symbol of symbols) {
    if (symbol.audienceRef === "server" || symbol.storage.root === "secret") continue;
    if (symbol.audienceRef === "actor" && input.actorPlayerId === undefined) continue;
    const actorMode = symbol.audienceRef === "actor"
      ? { kind: "one" as const, actorPlayerId: input.actorPlayerId! }
      : { kind: "all" as const };
    const audienceTarget = symbol.audienceRef === "actor"
      ? actorAudienceState
      : publicAudienceState;
    for (const expanded of expandStorage(source, symbol.storage, actorMode)) {
      // An actor-labelled symbol without an actor placeholder cannot be tied
      // to a particular viewer. Failing closed avoids exposing a shared path
      // merely because a manifest accidentally assigned it an actor label.
      if (symbol.audienceRef === "actor" && expanded.actorKeys.length === 0) {
        continue;
      }
      writePath(audienceTarget, expanded.path, structuredClone(expanded.value));
    }
  }

  // More restrictive declarations win over a broader parent symbol. Actor
  // values are removed from the public channel for every participant and are
  // restored only for the authenticated actor in `actorAudienceState`.
  for (const symbol of symbols) {
    if (symbol.audienceRef === "server") {
      for (const expanded of expandStorage(source, symbol.storage, { kind: "all" })) {
        removePath(publicAudienceState, expanded.path);
        removePath(actorAudienceState, expanded.path);
      }
      continue;
    }
    if (symbol.audienceRef === "actor") {
      for (const expanded of expandStorage(source, symbol.storage, { kind: "all" })) {
        removePath(publicAudienceState, expanded.path);
      }
    }
  }

  // Defense in depth: no declaration can make the physical server-owned root
  // player-facing. The semantic checker should reject such a declaration too,
  // but runtime projection remains safe for historic immutable bundles.
  delete publicAudienceState.secret;
  delete actorAudienceState.secret;
  const state = structuredClone(publicAudienceState);
  mergeRecords(state, actorAudienceState);
  delete state.secret;
  return { state, publicAudienceState, actorAudienceState };
}

type ActorExpansion =
  | { kind: "all" }
  | { kind: "one"; actorPlayerId: string };

/** Expand actor/parameter placeholders only through keys present in state. */
function expandStorage(
  source: RuntimeState,
  storage: StorageLocation,
  actorExpansion: ActorExpansion
): ExpandedValue[] {
  if (storage.root === "secret" || forbiddenKeys.has(storage.root)) return [];
  const rootValue = source[storage.root];
  if (rootValue === undefined) return [];

  const output: ExpandedValue[] = [];
  walkStorage(
    rootValue,
    storage.segments,
    0,
    [storage.root],
    [],
    actorExpansion,
    output
  );
  return output;
}

function walkStorage(
  current: unknown,
  segments: StorageSegment[],
  index: number,
  path: string[],
  actorKeys: string[],
  actorExpansion: ActorExpansion,
  output: ExpandedValue[]
): void {
  if (index === segments.length) {
    output.push({ path, value: current, actorKeys });
    return;
  }
  if (!isRecord(current)) return;

  const segment = segments[index];
  if (typeof segment === "string") {
    if (forbiddenKeys.has(segment) || !hasOwn(current, segment)) return;
    walkStorage(
      current[segment],
      segments,
      index + 1,
      [...path, segment],
      actorKeys,
      actorExpansion,
      output
    );
    return;
  }

  if ("context" in segment) {
    const keys = actorExpansion.kind === "one"
      ? [actorExpansion.actorPlayerId]
      : safeOwnKeys(current);
    for (const actorKey of keys) {
      if (!hasOwn(current, actorKey)) continue;
      walkStorage(
        current[actorKey],
        segments,
        index + 1,
        [...path, actorKey],
        [...actorKeys, actorKey],
        actorExpansion,
        output
      );
    }
    return;
  }

  // A state projection has no command parameters. A `{ param: ... }` segment
  // therefore denotes every already materialized key at that position. This
  // exposes no more than the symbol's explicit audience label permits.
  for (const key of safeOwnKeys(current)) {
    walkStorage(
      current[key],
      segments,
      index + 1,
      [...path, key],
      actorKeys,
      actorExpansion,
      output
    );
  }
}

function writePath(target: RuntimeState, path: string[], value: unknown): void {
  let current = target;
  for (const segment of path.slice(0, -1)) {
    if (forbiddenKeys.has(segment)) return;
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment] as RuntimeState;
  }
  const leaf = path.at(-1);
  if (leaf !== undefined && !forbiddenKeys.has(leaf)) current[leaf] = value;
}

/** Merge two already-filtered state-shaped audience projections. */
function mergeRecords(target: RuntimeState, source: RuntimeState): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    if (forbiddenKeys.has(key)) continue;
    const targetValue = target[key];
    if (isRecord(targetValue) && isRecord(sourceValue)) {
      mergeRecords(targetValue, sourceValue);
    } else {
      target[key] = structuredClone(sourceValue);
    }
  }
}

/** Remove a denied leaf and prune empty records left by another actor. */
function removePath(target: RuntimeState, path: string[]): void {
  const parents: Array<{ parent: RuntimeState; key: string }> = [];
  let current: unknown = target;
  for (const segment of path.slice(0, -1)) {
    if (!isRecord(current) || !hasOwn(current, segment)) return;
    parents.push({ parent: current, key: segment });
    current = current[segment];
  }
  if (!isRecord(current)) return;
  const leaf = path.at(-1);
  if (leaf === undefined) return;
  delete current[leaf];

  for (const { parent, key } of parents.reverse()) {
    const child = parent[key];
    if (!isRecord(child) || Object.keys(child).length > 0) break;
    delete parent[key];
  }
}

const safeOwnKeys = (value: RuntimeState): string[] =>
  Object.keys(value).filter((key) => !forbiddenKeys.has(key)).sort();

const hasOwn = (value: RuntimeState, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isRecord = (value: unknown): value is RuntimeState =>
  typeof value === "object" && value !== null && !Array.isArray(value);
