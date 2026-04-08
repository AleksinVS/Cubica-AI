export interface RuntimeStateDelta<TState = unknown> {
  state?: TState;
  mergePatch?: Record<string, unknown>;
  jsonPatch?: Array<Record<string, unknown>>;
}

export interface RuntimeActionError {
  code: string;
  message: string;
}

export interface RuntimeActionEffect {
  kind: string;
  target?: string;
  value?: unknown;
  data?: Record<string, unknown>;
}

export interface RuntimeActionResult<TState = unknown> {
  ok: boolean;
  delta?: RuntimeStateDelta<TState>;
  effects?: Array<RuntimeActionEffect>;
  error?: RuntimeActionError;
}

export interface RuntimeManifestActionDefinition {
  actionId: string;
  handlerType: string;
  capabilityFamily?: string;
  capability?: string;
  functionName?: string;
  raw: Record<string, unknown>;
}

export interface RuntimeActionContext<TState = unknown> {
  sessionId: string;
  gameId: string;
  actionId: string;
  payload?: unknown;
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

/**
 * Bounded effect descriptor used in RuntimeActionResult.
 * Covers the current runtime effect surface for deterministic action dispatch.
 */
export interface RuntimeEffect {
  kind: string;
  target?: string;
  value?: unknown;
  data?: Record<string, unknown>;
}

/**
 * Bounded runtime dispatch input.
 * Covers the internal runtime-api dispatch path (not the HTTP layer).
 */
export interface RuntimeDispatchOptions {
  sessionId: string;
  playerId?: string;
  actionId: string;
  payload?: unknown;
}

/**
 * Bounded runtime dispatch result including the applied effect.
 * Used internally by runtime-api for effect projection and logging.
 */
export interface RuntimeDispatchResult<TState = unknown> {
  result: RuntimeActionResult<TState>;
  appliedEffect?: RuntimeEffect;
}
