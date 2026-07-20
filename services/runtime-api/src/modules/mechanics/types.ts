/** Internal execution contracts built from the schema-generated public types. */
import type {
  CollectionModel,
  CubicaMechanicsIRV1Alpha1,
  Plan,
  Predicate,
  StateModel,
  StateRef,
  Step,
  ValueExpression
} from "@cubica/contracts-manifest";
import type { RuntimeSystemScheduleMutation } from "@cubica/contracts-runtime";
import type {
  GameManifestObjectModelMap,
  GameManifestTransportNetworkModelMap
} from "@cubica/contracts-manifest";
import type { SessionRandomStreamsState } from "../runtime/sessionRandom.ts";

export type RuntimeState = Record<string, unknown>;
export type JsonRecord = Record<string, unknown>;

export interface MechanicsActorContext {
  actorPlayerId?: string;
  activePlayerId?: string;
  sessionRole?: "player" | "facilitator" | "assistant" | "observer";
}

/**
 * One public-metric snapshot pair for a single action transaction (ADR-092).
 *
 * `before` is the metric value in the authoritative pre-action state, `after`
 * is its value in the committed candidate state. The delta and its sign are a
 * consumer concern, so the contract stores both endpoints rather than the delta.
 */
export interface MetricChange {
  metricId: string;
  before: number;
  after: number;
}

/**
 * A declared public metric the runtime snapshots for ADR-092 metric deltas.
 *
 * `statePath` is the game-declared dot path to the metric value (for example
 * `public.metrics.time`). The platform never hard-codes metric names: it reads
 * this path generically from the manifest metric catalog.
 */
export interface PublicMetricRef {
  metricId: string;
  statePath: string;
}

export interface MechanicsEvent {
  eventType: string;
  audience: "public" | "actor" | "server";
  summary: unknown;
  data: Record<string, unknown>;
  /**
   * ADR-092 public-metric deltas of the whole action transaction. Present only
   * on public events of a game that declares a public metric catalog; several
   * public events of one transaction share the same block.
   */
  metricChanges?: ReadonlyArray<MetricChange>;
}

/**
 * A public event whose journal entry must receive the ADR-092 metric block.
 *
 * The `event` reference is the same object stored in `context.events`, so the
 * post-transaction pass enriches the durable stream by mutating it. When the
 * emitting step wrote to a journal endpoint, `journalReference`/`journalIndex`
 * locate the appended in-state entry so it receives an identical block.
 */
export interface MetricAuditTarget {
  event: MechanicsEvent;
  journalReference?: StateRef;
  journalIndex?: number;
}

export interface MechanicsAuditEntry {
  stepId: string;
  operation: string;
  result?: unknown;
}

export interface MechanicsRuntimeCost {
  steps: number;
  expressionNodes: number;
  /** Deterministic work units consumed by registered bounded algorithms. */
  algorithmWork: number;
  scannedEntities: number;
  resultEntities: number;
  writes: number;
  events: number;
  /** UTF-8 JSON bytes materialized by expression and step results. */
  intermediateBytes: number;
  /** UTF-8 JSON bytes retained in the protected event output. */
  eventBytes: number;
  /** UTF-8 JSON bytes retained in the bounded execution audit. */
  auditBytes: number;
}

export interface EntitySelection {
  kind: "entities";
  collectionId: string;
  ids: Array<string>;
}

/**
 * Trusted entity currently bound by a bounded collection operation.
 *
 * The identifier is kept beside the validated entity because identity is not
 * an authored facet/attribute and must not be copied into game state merely so
 * `value.item` can address the selected object.
 */
export interface MechanicsItemScope {
  model: CollectionModel;
  id: string;
  entity: JsonRecord;
}

export interface MechanicsExecutionInput {
  mechanics: CubicaMechanicsIRV1Alpha1;
  plan: Plan;
  state: RuntimeState;
  params?: Record<string, unknown>;
  actorContext: MechanicsActorContext;
  random?: SessionRandomStreamsState;
  /** Test/replay seam for protected opaque schedule identities. */
  createScheduleId?: () => string;
  networkModels?: GameManifestTransportNetworkModelMap;
  objectModels?: GameManifestObjectModelMap;
  turnPhases?: ReadonlyArray<string>;
  /**
   * Ordered public metric catalog (ADR-092). When non-empty, the executor
   * snapshots these metrics before/after the transaction and attaches
   * `metricChanges` to public events. Absent/empty means the game has no public
   * metric catalog, so no metric block is produced (game-agnostic gate).
   */
  publicMetrics?: ReadonlyArray<PublicMetricRef>;
}

export interface MechanicsExecutionOutput {
  candidateState: RuntimeState;
  randomState?: SessionRandomStreamsState;
  events: Array<MechanicsEvent>;
  audit: Array<MechanicsAuditEntry>;
  result: unknown;
  cost: MechanicsRuntimeCost;
  systemScheduleMutations: Array<RuntimeSystemScheduleMutation>;
}

export interface MechanicsExecutionContext {
  stateModel: StateModel;
  state: RuntimeState;
  preActionState: RuntimeState;
  params: Record<string, unknown>;
  actor: MechanicsActorContext;
  random?: SessionRandomStreamsState;
  results: Map<string, unknown>;
  events: Array<MechanicsEvent>;
  audit: Array<MechanicsAuditEntry>;
  cost: MechanicsRuntimeCost;
  limits: MechanicsRuntimeLimits;
  systemScheduleMutations: Array<RuntimeSystemScheduleMutation>;
  createScheduleId: () => string;
  networkModels?: GameManifestTransportNetworkModelMap;
  objectModels?: GameManifestObjectModelMap;
  turnPhases?: ReadonlyArray<string>;
  /** Ordered public metric catalog for ADR-092 metric deltas, if any. */
  publicMetrics?: ReadonlyArray<PublicMetricRef>;
  /**
   * Public events collected during the transaction that must receive the
   * ADR-092 metric block once the whole transaction's before/after snapshot is
   * known. Populated by `core.event.emit`; drained by the executor at the end.
   */
  metricAuditTargets?: Array<MetricAuditTarget>;
  /** Current per-entity binding while a bounded body is executing. */
  currentItem?: MechanicsItemScope;
  /**
   * Runtime-owned nested-step seam installed only by the transaction executor.
   *
   * Operations cannot inject an alternative executor: the public Mechanics
   * schema contains no corresponding field.
   */
  executeBoundedBody?: (
    steps: ReadonlyArray<Step>,
    item: MechanicsItemScope,
    scopeId: string
  ) => unknown;
}

export interface MechanicsRuntimeLimits {
  steps: number;
  expressionNodes: number;
  algorithmWork: number;
  scannedEntities: number;
  resultEntities: number;
  writes: number;
  events: number;
  intermediateBytes: number;
  eventBytes: number;
  auditBytes: number;
  maxJsonDepth: number;
  /** Maximum nodes in one retained expression/step result or typed JSON value. */
  maxJsonNodes: number;
  maxInputParamNodes: number;
  maxCandidateStateNodes: number;
  maxEventNodes: number;
  maxStringUtf8Bytes: number;
  maxIntermediateValueBytes: number;
  maxInputParamsBytes: number;
  maxCandidateStateBytes: number;
  maxSingleEventBytes: number;
}

export type { CollectionModel, Plan, Predicate, StateModel, Step, ValueExpression };
