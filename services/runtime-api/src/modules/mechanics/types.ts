/** Internal execution contracts built from the schema-generated public types. */
import type {
  CollectionModel,
  CubicaMechanicsIRV1Alpha1,
  Plan,
  Predicate,
  StateModel,
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

export interface MechanicsEvent {
  eventType: string;
  audience: "public" | "actor" | "server";
  summary: unknown;
  data: Record<string, unknown>;
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
