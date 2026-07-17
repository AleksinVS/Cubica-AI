export interface RuntimeActionError {
  code: string;
  message: string;
}

/** Protected event emitted by one successful Mechanics transaction. */
export interface RuntimeActionEvent {
  eventType: string;
  audience: "public" | "actor" | "server";
  summary: unknown;
  data: Record<string, unknown>;
}

/** One bounded, protected trace entry produced by the Mechanics executor. */
export interface RuntimeMechanicsAuditStep {
  stepId: string;
  operation: string;
  result?: unknown;
}

/** Deterministic resource counters charged while one Mechanics plan executes. */
export interface RuntimeMechanicsCost {
  steps: number;
  expressionNodes: number;
  /** Deterministic work units consumed by registered bounded algorithms. */
  algorithmWork: number;
  scannedEntities: number;
  resultEntities: number;
  writes: number;
  events: number;
  intermediateBytes: number;
  eventBytes: number;
  auditBytes: number;
}

/**
 * Versioned protected execution audit.
 *
 * Delivery clients must not receive this object. The command owner persists it
 * inside the internal receipt in the same transaction as state and events.
 */
export interface RuntimeMechanicsAudit {
  formatVersion: "1.0.0";
  steps: ReadonlyArray<RuntimeMechanicsAuditStep>;
  cost: RuntimeMechanicsCost;
}

/** Protected scheduler mutation produced by Mechanics, never sent to clients. */
export type RuntimeSystemScheduleMutation =
  | {
      kind: "register";
      scheduleId: string;
      actionId: string;
      params: Record<string, string | number | boolean>;
      trigger: unknown;
      falsePolicy: "defer" | "skip";
      maxOccurrences: number;
    }
  | { kind: "cancel"; scheduleId: string };

export interface RuntimeActionResult<TState = unknown> {
  ok: boolean;
  /** Complete transaction-local candidate; the dispatcher commits it atomically. */
  candidateState?: TState;
  events?: Array<RuntimeActionEvent>;
  /** Protected executor trace for the durable internal receipt, never public API. */
  mechanicsAudit?: RuntimeMechanicsAudit;
  /** Protected schedule mutations committed only by the command owner. */
  systemScheduleMutations?: ReadonlyArray<RuntimeSystemScheduleMutation>;
  error?: RuntimeActionError;
}

export interface RuntimeManifestActionDefinition {
  actionId: string;
  definitionHash: string;
  binding: {
    kind: "mechanics-plan";
    planRef: string;
  };
  invocation: "external" | "system";
  capabilityFamily?: string;
  capability?: string;
  functionName?: string;
  paramsSchema?: Record<string, unknown>;
  allowedSessionRoles?: Array<"player" | "facilitator" | "assistant" | "observer">;
  raw: Record<string, unknown>;
}

export interface RuntimeResolvedReference {
  paramName: string;
  id: string;
  kind: "object" | "action-resource";
  collection: string;
  visibility: "public" | "secret";
  network?: string;
  objectType?: string;
}

export interface RuntimeActionContext<TState = unknown> {
  sessionId: string;
  gameId: string;
  actionId: string;
  params?: Record<string, unknown>;
  /** Participant attributed to this action by the current delivery mode. */
  actorPlayerId?: string;
  sessionRole?: "player" | "facilitator" | "assistant" | "observer";
  resolvedRefs?: Record<string, RuntimeResolvedReference>;
  state: TState;
  now: Date;
  manifestAction: RuntimeManifestActionDefinition;
}

export interface RuntimeActionHandler<TState = unknown> {
  (context: RuntimeActionContext<TState>): Promise<RuntimeActionResult<TState>> | RuntimeActionResult<TState>;
}

export interface RuntimeActionRegistry<TState = unknown> {
  get(actionId: string): RuntimeActionHandler<TState> | undefined;
  has(actionId: string): boolean;
  list(): Array<string>;
}
