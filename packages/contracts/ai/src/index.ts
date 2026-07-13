/**
 * Cubica-owned AI and agent contracts.
 *
 * This package is the framework-neutral boundary for AI tasks, user-facing
 * assistants, generative UI surfaces and future AI-driven gameplay turns.
 * UI libraries such as CopilotKit and protocols such as AG-UI must translate
 * into these shapes instead of becoming domain contracts themselves.
 */
import AjvModule, {
  type AnySchema,
  type ErrorObject,
  type Options as AjvOptions,
  type ValidateFunction
} from "ajv";
import addFormatsModule from "ajv-formats";

interface LocalAjvInstance {
  addSchema(schema: AnySchema, key?: string): LocalAjvInstance;
  getSchema(keyRef: string): ValidateFunction | undefined;
  compile(schema: AnySchema): ValidateFunction;
}

type LocalAjvConstructor = new (options?: AjvOptions) => LocalAjvInstance;

export interface AiTaskEnvelope<TInput = unknown> {
  taskType: string;
  input: TInput;
  context?: Record<string, unknown>;
}

export interface AiTaskResult<TOutput = unknown> {
  ok: boolean;
  output?: TOutput;
  model?: string;
  error?: {
    code: string;
    message: string;
  };
}

export type CubicaAssistantStatus = "implemented" | "planned";

export type CubicaAssistantSurface = "sidebar" | "inline" | "panel";

export type CubicaAgentSideEffectPolicy = "read-only" | "human-approved" | "system-approved";

export type CubicaAgentAuditLevel = "none" | "read" | "mutating";

export interface CubicaAssistantRecord<TToolName extends string = string, TContextKey extends string = string> {
  readonly agentId: string;
  readonly ownerApp: string;
  readonly surface: CubicaAssistantSurface;
  readonly allowedContext: readonly TContextKey[];
  readonly allowedTools: readonly TToolName[];
  readonly sideEffectPolicy: CubicaAgentSideEffectPolicy;
  readonly auditLevel: CubicaAgentAuditLevel;
  readonly version: string;
  readonly status: CubicaAssistantStatus;
  readonly description: string;
}

export interface CubicaAgentContextSource {
  readonly app: string;
  readonly sessionId?: string;
  readonly gameId?: string;
  readonly activeFilePath?: string;
  readonly activeFileVersionHash?: string;
}

export interface CubicaAgentContext<TSource extends CubicaAgentContextSource = CubicaAgentContextSource> {
  readonly contextVersion: number;
  readonly agentId: string;
  readonly source: TSource;
}

export interface CubicaAgentToolDefinition<TParameters = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters?: TParameters;
  readonly sideEffectPolicy: CubicaAgentSideEffectPolicy;
  readonly auditLevel: CubicaAgentAuditLevel;
}

export interface CubicaAgentToolDiagnostic {
  readonly severity: string;
  readonly source: string;
  readonly pointer?: string;
  readonly message: string;
}

export interface CubicaAgentToolResult<TData = unknown> {
  readonly ok: boolean;
  readonly toolName: string;
  readonly summary: string;
  readonly diagnostics?: readonly CubicaAgentToolDiagnostic[];
  readonly data?: TData;
  readonly diffSummary?: readonly string[];
  readonly correlationId?: string;
}

export type CubicaAgentApprovalStatus = "approved" | "rejected";

/**
 * Human approval envelope.
 *
 * An envelope is a Cubica-owned record that a person approved one exact
 * mutating operation. It deliberately lives outside provider tool arguments:
 * an agent may request approval, but only the host UI can create the envelope
 * that a mutating tool accepts.
 */
export interface CubicaAgentApprovalEnvelope {
  readonly schemaVersion: "1.0.0";
  readonly approvalId: string;
  readonly agentId: string;
  readonly toolName: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly scopeHash: string;
  readonly status: CubicaAgentApprovalStatus;
  readonly runId?: string;
  readonly actionId?: string;
  readonly correlationId?: string;
  readonly metadata?: Record<string, CubicaJsonValue>;
}

export interface CubicaAgentApprovalValidationOptions {
  readonly nowIso?: string;
  readonly expectedToolName?: string;
  readonly expectedScopeHash?: string;
  readonly requireApproved?: boolean;
}

export type CubicaAgentEvent =
  | {
      readonly kind: "run";
      readonly phase: "started" | "finished";
      readonly runId?: string;
      readonly threadId?: string;
      readonly canMutateCanonicalState: false;
    }
  | {
      readonly kind: "text";
      readonly phase: "start" | "content" | "end" | "chunk";
      readonly messageId?: string;
      readonly delta?: string;
      readonly canMutateCanonicalState: false;
    }
  | {
      readonly kind: "tool";
      readonly phase: "start" | "args" | "end" | "result" | "chunk";
      readonly toolCallId?: string;
      readonly toolCallName?: string;
      readonly argsDelta?: string;
      readonly content?: string;
      readonly canMutateCanonicalState: false;
    }
  | {
      readonly kind: "state";
      readonly phase: "snapshot" | "delta";
      readonly statePolicy: "assistant-state-only" | "unsafe-canonical-path-rejected";
      readonly unsafeCanonicalPaths: readonly string[];
      readonly canMutateCanonicalState: false;
    }
  | {
      readonly kind: "error";
      readonly message: string;
      readonly code?: string;
      readonly canMutateCanonicalState: false;
    }
  | {
      readonly kind: "messages" | "activity" | "custom" | "unknown";
      readonly eventType: string;
      readonly canMutateCanonicalState: false;
    };

export interface CubicaAgentRun<TContext extends CubicaAgentContext = CubicaAgentContext> {
  readonly agentId: string;
  readonly runId?: string;
  readonly threadId?: string;
  readonly context: TContext;
  readonly tools: readonly CubicaAgentToolDefinition[];
}

/**
 * JSON value used in cross-platform contracts.
 *
 * The contracts intentionally do not expose functions, React nodes, class
 * instances or other process-local values because every payload may cross
 * service and renderer boundaries.
 */
export type CubicaJsonValue =
  | null
  | string
  | number
  | boolean
  | readonly CubicaJsonValue[]
  | { readonly [key: string]: CubicaJsonValue };

export type CubicaSurfaceSchemaVersion = "1.0.0";
export type CubicaSurfaceMode = "helper" | "primary-gameplay";
export type CubicaSurfaceChannel = "web" | "telegram" | "phaser";
export type CubicaSurfaceChannelSupport = "native" | "fallback" | "unsupported";

export type CubicaSurfaceActionKind =
  | "noop"
  | "agentTurn"
  | "runtimeAction"
  | "editorTool"
  | "portalCommand"
  | "openUrl";

export interface CubicaSurfaceAction<TPayload extends CubicaJsonValue = CubicaJsonValue> {
  readonly id: string;
  readonly kind: CubicaSurfaceActionKind;
  readonly label?: string;
  readonly target?: string;
  readonly payload?: TPayload;
  readonly sideEffectPolicy: CubicaAgentSideEffectPolicy;
  readonly requiresApproval?: boolean;
  readonly metadata?: Record<string, CubicaJsonValue>;
}

export interface CubicaSurfaceComponent<TProps extends Record<string, CubicaJsonValue> = Record<string, CubicaJsonValue>> {
  readonly id: string;
  readonly kind: string;
  readonly props: TProps;
  readonly children?: readonly CubicaSurfaceComponent[];
  readonly actions?: readonly CubicaSurfaceAction[];
  readonly dataBinding?: {
    readonly path: string;
    readonly optional?: boolean;
  };
  readonly metadata?: Record<string, CubicaJsonValue>;
}

export interface CubicaSurface {
  readonly schemaVersion: CubicaSurfaceSchemaVersion;
  readonly surfaceId: string;
  readonly catalogVersion: string;
  readonly mode: CubicaSurfaceMode;
  readonly title?: string;
  readonly dataModel?: Record<string, CubicaJsonValue>;
  readonly root: CubicaSurfaceComponent;
  readonly metadata?: Record<string, CubicaJsonValue>;
}

export interface CubicaSurfaceCatalogComponent {
  readonly kind: string;
  readonly version: string;
  readonly description: string;
  readonly safeForPrimaryGameplay: boolean;
  readonly channelSupport: Readonly<Record<CubicaSurfaceChannel, CubicaSurfaceChannelSupport>>;
  readonly allowedActionKinds: readonly CubicaSurfaceActionKind[];
}

export type CubicaSurfaceCatalog = readonly CubicaSurfaceCatalogComponent[];

export interface CubicaSurfaceProjectionOptions {
  readonly catalog?: CubicaSurfaceCatalog;
  readonly channelActionPolicy?: CubicaSurfaceChannelActionPolicy;
}

export interface CubicaTelegramSurfaceMessage {
  readonly id: string;
  readonly text: string;
}

export interface CubicaTelegramSurfaceButton {
  readonly id: string;
  readonly label: string;
  readonly action: CubicaSurfaceAction;
}

/**
 * Framework-neutral Telegram projection.
 *
 * A projection is a renderer-ready view of a validated Surface. It is still
 * data, not Telegram SDK objects, so a bot adapter can convert it without
 * pulling bot dependencies into shared contracts.
 */
export interface CubicaTelegramSurfaceProjection {
  readonly channel: "telegram";
  readonly surfaceId: string;
  readonly title?: string;
  readonly ok: boolean;
  readonly actionsSuppressed: boolean;
  readonly messages: readonly CubicaTelegramSurfaceMessage[];
  readonly inlineKeyboard: readonly (readonly CubicaTelegramSurfaceButton[])[];
  readonly diagnostics: readonly CubicaContractDiagnostic[];
}

export interface CubicaPhaserSurfaceElement {
  readonly id: string;
  readonly componentKind: string;
  readonly kind: "text" | "button" | "choice" | "metrics" | "card" | "hint" | "diagnostic";
  readonly text?: string;
  readonly label?: string;
  readonly props?: Record<string, CubicaJsonValue>;
}

export interface CubicaPhaserSurfaceInteractiveZone {
  readonly id: string;
  readonly label: string;
  readonly action: CubicaSurfaceAction;
}

/**
 * Framework-neutral Phaser projection.
 *
 * Phaser.js (2D game engine) adapters should create sprites, text objects and
 * input zones from this projection instead of parsing raw Surface trees again.
 */
export interface CubicaPhaserSurfaceProjection {
  readonly channel: "phaser";
  readonly surfaceId: string;
  readonly title?: string;
  readonly ok: boolean;
  readonly actionsSuppressed: boolean;
  readonly elements: readonly CubicaPhaserSurfaceElement[];
  readonly interactiveZones: readonly CubicaPhaserSurfaceInteractiveZone[];
  readonly diagnostics: readonly CubicaContractDiagnostic[];
}

export interface CubicaSurfaceChannelContribution {
  readonly support: CubicaSurfaceChannelSupport;
  readonly rendererId?: string;
  readonly fallbackKind?: string;
}

export type CubicaSurfaceContributionReviewStatus = "draft" | "approved" | "rejected";

/**
 * Plugin contribution for a new Surface component.
 *
 * The contribution is intentionally richer than the runtime catalog entry:
 * reviewers need props schema, channel renderer declarations and review status
 * before the component is allowed in agent output.
 */
export interface CubicaSurfaceComponentContribution {
  readonly schemaVersion: "1.0.0";
  readonly ownerPluginId: string;
  readonly kind: string;
  readonly version: string;
  readonly description: string;
  readonly safeForPrimaryGameplay: boolean;
  readonly propsSchema: Record<string, CubicaJsonValue>;
  readonly allowedActionKinds: readonly CubicaSurfaceActionKind[];
  readonly channelSupport: Readonly<Record<CubicaSurfaceChannel, CubicaSurfaceChannelContribution>>;
  readonly review: {
    readonly status: CubicaSurfaceContributionReviewStatus;
    readonly reviewedBy?: string;
    readonly reviewedAt?: string;
    readonly notes?: string;
  };
}

export type CubicaA2uiLikeEvent =
  | {
      readonly schemaVersion: "1.0.0";
      readonly type: "surfaceUpdate";
      readonly surface: CubicaSurface;
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly type: "dataModelUpdate";
      readonly dataModel: Record<string, CubicaJsonValue>;
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly type: "beginRendering";
      readonly surfaceId?: string;
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly type: "diagnostic";
      readonly diagnostic: CubicaContractDiagnostic;
    };

export interface CubicaA2uiAdapterResult {
  readonly ok: boolean;
  readonly surface?: CubicaSurface;
  readonly readyToRender: boolean;
  readonly diagnostics: readonly CubicaContractDiagnostic[];
}

export type CubicaGameExecutionMode = "deterministic" | "hybrid" | "ai-driven";
export type CubicaAgentFailurePolicy = "pause" | "retry" | "deterministicFallback" | "facilitatorTakeover";

export interface CubicaAgentRuntimeManifestConfig {
  readonly agentId: string;
  readonly runtimeId?: string;
  readonly required: boolean;
  readonly allowedCapabilities: readonly string[];
  readonly surfaceCatalog: readonly string[];
  readonly failurePolicy: CubicaAgentFailurePolicy;
}

export interface CubicaAgentRuntimeOperationPolicy {
  readonly schemaVersion: "1.0.0";
  readonly policyId: string;
  readonly idempotency: {
    readonly keySource: "turnId" | "correlationId";
    readonly duplicateBehavior: "returnPrevious" | "reject";
    readonly ttlSeconds: number;
  };
  readonly timeout: {
    readonly turnTimeoutMs: number;
    readonly providerTimeoutMs: number;
  };
  readonly retry: {
    readonly maxAttempts: number;
    readonly backoffMs: number;
    readonly retryableErrorCodes: readonly string[];
  };
  readonly rateLimit: {
    readonly perSessionTurnsPerMinute: number;
    readonly perAgentTurnsPerMinute: number;
  };
  readonly costControl: {
    readonly maxInputTokensPerTurn?: number;
    readonly maxOutputTokensPerTurn?: number;
    readonly maxCostUsdPerSession?: number;
  };
}

/**
 * Manifest-adjacent execution configuration.
 *
 * It is kept in the AI contracts package first so runtime/player code can
 * validate the new shape before the full game manifest schema is widened.
 */
export interface CubicaExecutionModeConfig {
  readonly executionMode: CubicaGameExecutionMode;
  readonly agentRuntime?: CubicaAgentRuntimeManifestConfig;
}

export type CubicaAgentTurnTriggerKind = "playerAction" | "systemEvent" | "facilitatorAction" | "timer";

export interface CubicaAgentTurnTrigger {
  readonly kind: CubicaAgentTurnTriggerKind;
  readonly actionId?: string;
  readonly eventType?: string;
  readonly payload?: CubicaJsonValue;
}

export interface CubicaAgentTurnInput {
  readonly schemaVersion: "1.0.0";
  readonly turnId: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly playerId?: string;
  readonly agentId: string;
  readonly executionMode: Exclude<CubicaGameExecutionMode, "deterministic">;
  readonly trigger: CubicaAgentTurnTrigger;
  readonly stateScope: {
    readonly public: Record<string, CubicaJsonValue>;
    readonly secret?: Record<string, CubicaJsonValue>;
  };
  readonly manifestProjection: Record<string, CubicaJsonValue>;
  readonly allowedCapabilities: readonly string[];
  readonly surfaceCatalog: readonly string[];
  readonly correlationId?: string;
}

export type CubicaAgentEffectKind =
  | "setFlag"
  | "setMetric"
  | "appendLog"
  | "replaceStep"
  | "grantCapability"
  | "custom";

export interface CubicaAgentStateEffect {
  readonly kind: CubicaAgentEffectKind;
  readonly target: string;
  readonly value?: CubicaJsonValue;
  readonly data?: Record<string, CubicaJsonValue>;
}

export interface CubicaAgentAvailableAction {
  readonly actionId: string;
  readonly label: string;
  readonly kind: "agentTurn" | "runtimeAction" | "facilitatorAction";
  readonly payloadSchema?: Record<string, CubicaJsonValue>;
  readonly sideEffectPolicy: CubicaAgentSideEffectPolicy;
}

export interface CubicaAgentCapabilityRule {
  readonly capability: string;
  readonly effectKinds: readonly CubicaAgentEffectKind[];
  readonly targetPathPrefixes: readonly string[];
  readonly availableActionKinds?: readonly CubicaAgentAvailableAction["kind"][];
  readonly surfaceActionKinds?: readonly CubicaSurfaceActionKind[];
}

/**
 * Capability policy.
 *
 * This turns manifest `allowedCapabilities` from documentation into an
 * executable allowlist: each declared capability maps to concrete effect kinds,
 * target state paths and action kinds that runtime may accept.
 */
export interface CubicaAgentCapabilityPolicy {
  readonly schemaVersion: "1.0.0";
  readonly policyId: string;
  readonly rules: readonly CubicaAgentCapabilityRule[];
}

export interface CubicaSurfaceChannelActionPolicy {
  readonly schemaVersion: "1.0.0";
  readonly policyId: string;
  readonly channel: CubicaSurfaceChannel;
  readonly surfaceMode?: CubicaSurfaceMode;
  readonly allowedActionKinds: readonly CubicaSurfaceActionKind[];
  readonly disallowedActionKinds?: readonly CubicaSurfaceActionKind[];
  readonly allowedTargets?: readonly string[];
}

export type CubicaContractDiagnosticSeverity = "error" | "warning";
export type CubicaContractDiagnosticSource = "schema" | "semantic";

export interface CubicaContractDiagnostic {
  readonly severity: CubicaContractDiagnosticSeverity;
  readonly source: CubicaContractDiagnosticSource;
  readonly code: string;
  readonly pointer: string;
  readonly message: string;
}

export interface CubicaAgentTurnAuditMetadata {
  readonly source: "mock" | "local" | "provider";
  readonly createdAt: string;
  readonly model?: string;
  readonly runId?: string;
  readonly promptHash?: string;
  readonly transcriptRef?: string;
}

export interface CubicaAgentTurnResult {
  readonly schemaVersion: "1.0.0";
  readonly turnId: string;
  readonly agentId: string;
  readonly ok: boolean;
  readonly narration?: string;
  readonly effects?: readonly CubicaAgentStateEffect[];
  readonly availableActions?: readonly CubicaAgentAvailableAction[];
  readonly surface?: CubicaSurface;
  readonly diagnostics?: readonly CubicaContractDiagnostic[];
  readonly audit: CubicaAgentTurnAuditMetadata;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export type CubicaAgentTurnEventStatus = "accepted" | "rejected";

export interface CubicaAgentTurnEventLogEntry {
  readonly schemaVersion: "1.0.0";
  readonly eventId: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly gameId: string;
  readonly agentId: string;
  readonly status: CubicaAgentTurnEventStatus;
  readonly recordedAt: string;
  readonly trigger: CubicaAgentTurnTrigger;
  readonly effectCount: number;
  readonly surfaceId?: string;
  readonly rejectionReason?: {
    readonly code: string;
    readonly message: string;
  };
  readonly rejectedDiagnostics?: readonly CubicaContractDiagnostic[];
  readonly audit: CubicaAgentTurnAuditMetadata;
  readonly correlationId?: string;
}

export interface CubicaAgentReplayTranscript {
  readonly schemaVersion: "1.0.0";
  readonly transcriptId: string;
  readonly gameId: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly entries: readonly CubicaAgentTurnEventLogEntry[];
  readonly redaction: {
    readonly secretStateIncluded: false;
    readonly policy: string;
    readonly redactedPaths?: readonly string[];
  };
}

export interface CubicaAgentEvaluationFixture {
  readonly schemaVersion: "1.0.0";
  readonly fixtureId: string;
  readonly gameId: string;
  readonly title?: string;
  readonly input: CubicaAgentTurnInput;
  readonly expected: {
    readonly ok?: boolean;
    readonly allowedSurfaceKinds?: readonly string[];
    readonly requiredEffectKinds?: readonly CubicaAgentEffectKind[];
    readonly forbiddenDiagnosticCodes?: readonly string[];
    readonly maxErrorSeverity?: CubicaContractDiagnosticSeverity;
  };
  readonly audit: {
    readonly createdAt: string;
    readonly owner: string;
  };
}

export interface CubicaValidationResult<TValue> {
  readonly ok: boolean;
  readonly value?: TValue;
  readonly diagnostics: readonly CubicaContractDiagnostic[];
}

export interface CubicaSurfaceValidationOptions {
  readonly catalog?: CubicaSurfaceCatalog;
  readonly targetChannel?: CubicaSurfaceChannel;
  readonly channelActionPolicy?: CubicaSurfaceChannelActionPolicy;
}

export interface CubicaAgentTurnValidationOptions extends CubicaSurfaceValidationOptions {
  readonly forbiddenStatePathPrefixes?: readonly string[];
}

export const CUBICA_SURFACE_SCHEMA_ID = "https://cubica.ai/schemas/ai/cubica-surface.schema.json";
export const CUBICA_AGENT_TURN_INPUT_SCHEMA_ID = "https://cubica.ai/schemas/ai/agent-turn-input.schema.json";
export const CUBICA_AGENT_TURN_RESULT_SCHEMA_ID = "https://cubica.ai/schemas/ai/agent-turn-result.schema.json";
export const CUBICA_EXECUTION_MODE_CONFIG_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/execution-mode-config.schema.json";
export const CUBICA_SURFACE_COMPONENT_CONTRIBUTION_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/surface-component-contribution.schema.json";
export const CUBICA_AGENT_TURN_EVENT_LOG_ENTRY_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/agent-turn-event-log-entry.schema.json";
export const CUBICA_AGENT_REPLAY_TRANSCRIPT_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/agent-replay-transcript.schema.json";
export const CUBICA_AGENT_EVALUATION_FIXTURE_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/agent-evaluation-fixture.schema.json";
export const CUBICA_A2UI_LIKE_EVENT_SCHEMA_ID = "https://cubica.ai/schemas/ai/a2ui-like-event.schema.json";
export const CUBICA_AGENT_RUNTIME_OPERATION_POLICY_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/agent-runtime-operation-policy.schema.json";
export const CUBICA_AGENT_APPROVAL_ENVELOPE_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/agent-approval-envelope.schema.json";
export const CUBICA_AGENT_CAPABILITY_POLICY_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/agent-capability-policy.schema.json";
export const CUBICA_SURFACE_CHANNEL_ACTION_POLICY_SCHEMA_ID =
  "https://cubica.ai/schemas/ai/surface-channel-action-policy.schema.json";

export const defaultCubicaSurfaceCatalog = [
  {
    kind: "cubica.text",
    version: "1.0.0",
    description: "Plain text block.",
    safeForPrimaryGameplay: true,
    channelSupport: { web: "native", telegram: "native", phaser: "fallback" },
    allowedActionKinds: ["noop"]
  },
  {
    kind: "cubica.button",
    version: "1.0.0",
    description: "Single command button.",
    safeForPrimaryGameplay: true,
    channelSupport: { web: "native", telegram: "native", phaser: "native" },
    allowedActionKinds: ["agentTurn", "runtimeAction", "editorTool", "portalCommand", "openUrl"]
  },
  {
    kind: "cubica.diagnosticList",
    version: "1.0.0",
    description: "Validation and assistant diagnostics.",
    safeForPrimaryGameplay: false,
    channelSupport: { web: "native", telegram: "fallback", phaser: "unsupported" },
    allowedActionKinds: ["noop"]
  },
  {
    kind: "cubica.diffSummary",
    version: "1.0.0",
    description: "Summary of proposed document changes.",
    safeForPrimaryGameplay: false,
    channelSupport: { web: "native", telegram: "fallback", phaser: "unsupported" },
    allowedActionKinds: ["editorTool", "noop"]
  },
  {
    kind: "cubica.approvalCard",
    version: "1.0.0",
    description: "Human approval surface for mutating assistant tools.",
    safeForPrimaryGameplay: false,
    channelSupport: { web: "native", telegram: "fallback", phaser: "unsupported" },
    allowedActionKinds: ["editorTool", "portalCommand", "runtimeAction", "noop"]
  },
  {
    kind: "cubica.metricsBar",
    version: "1.0.0",
    description: "Compact gameplay metrics summary.",
    safeForPrimaryGameplay: true,
    channelSupport: { web: "native", telegram: "fallback", phaser: "native" },
    allowedActionKinds: ["noop"]
  },
  {
    kind: "cubica.choiceList",
    version: "1.0.0",
    description: "Player choice list.",
    safeForPrimaryGameplay: true,
    channelSupport: { web: "native", telegram: "native", phaser: "fallback" },
    allowedActionKinds: ["agentTurn", "runtimeAction"]
  },
  {
    kind: "cubica.cardGrid",
    version: "1.0.0",
    description: "Grid of gameplay cards.",
    safeForPrimaryGameplay: true,
    channelSupport: { web: "native", telegram: "fallback", phaser: "native" },
    allowedActionKinds: ["agentTurn", "runtimeAction"]
  },
  {
    kind: "cubica.hintPanel",
    version: "1.0.0",
    description: "Contextual hint or explanation panel.",
    safeForPrimaryGameplay: true,
    channelSupport: { web: "native", telegram: "native", phaser: "fallback" },
    allowedActionKinds: ["noop", "agentTurn"]
  }
] as const satisfies CubicaSurfaceCatalog;

export const defaultCubicaAgentCapabilityPolicy = {
  schemaVersion: "1.0.0",
  policyId: "cubica-platform-agent-capabilities-v1",
  rules: [
    {
      capability: "advanceStep",
      effectKinds: ["replaceStep", "appendLog"],
      targetPathPrefixes: ["public.step", "public.currentStep", "public.timeline", "public.log"],
      availableActionKinds: ["agentTurn", "runtimeAction"],
      surfaceActionKinds: ["agentTurn", "runtimeAction", "noop"]
    },
    {
      capability: "setMetric",
      effectKinds: ["setMetric", "appendLog"],
      targetPathPrefixes: ["public.metrics", "public.log"],
      availableActionKinds: ["agentTurn", "runtimeAction"],
      surfaceActionKinds: ["agentTurn", "runtimeAction", "noop"]
    },
    {
      capability: "setFlag",
      effectKinds: ["setFlag", "appendLog"],
      targetPathPrefixes: ["public.flags", "public.log"],
      availableActionKinds: ["agentTurn", "runtimeAction"],
      surfaceActionKinds: ["agentTurn", "runtimeAction", "noop"]
    },
    {
      capability: "appendLog",
      effectKinds: ["appendLog"],
      targetPathPrefixes: ["public.log"],
      availableActionKinds: ["agentTurn", "runtimeAction"],
      surfaceActionKinds: ["agentTurn", "runtimeAction", "noop"]
    }
  ]
} as const satisfies CubicaAgentCapabilityPolicy;

export const defaultCubicaSurfaceChannelActionPolicies = {
  webPlayerPrimaryGameplay: {
    schemaVersion: "1.0.0",
    policyId: "web-player-primary-gameplay-actions-v1",
    channel: "web",
    surfaceMode: "primary-gameplay",
    allowedActionKinds: ["noop", "agentTurn", "runtimeAction"],
    disallowedActionKinds: ["editorTool", "portalCommand", "openUrl"]
  },
  editorHelper: {
    schemaVersion: "1.0.0",
    policyId: "editor-helper-actions-v1",
    channel: "web",
    surfaceMode: "helper",
    allowedActionKinds: ["noop", "editorTool"]
  },
  telegram: {
    schemaVersion: "1.0.0",
    policyId: "telegram-projection-actions-v1",
    channel: "telegram",
    allowedActionKinds: ["noop", "agentTurn", "runtimeAction", "openUrl"],
    disallowedActionKinds: ["editorTool", "portalCommand"]
  },
  phaser: {
    schemaVersion: "1.0.0",
    policyId: "phaser-projection-actions-v1",
    channel: "phaser",
    allowedActionKinds: ["noop", "agentTurn", "runtimeAction"],
    disallowedActionKinds: ["editorTool", "portalCommand", "openUrl"]
  }
} as const satisfies Record<string, CubicaSurfaceChannelActionPolicy>;

const jsonValueDefinition = {
  anyOf: [
    { type: "null" },
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    {
      type: "array",
      items: { $ref: "#/definitions/JsonValue" }
    },
    {
      type: "object",
      additionalProperties: { $ref: "#/definitions/JsonValue" }
    }
  ]
} as const;

const metadataSchema = {
  type: "object",
  additionalProperties: { $ref: "#/definitions/JsonValue" }
} as const;

const diagnosticSchema = {
  type: "object",
  additionalProperties: false,
  required: ["severity", "source", "code", "pointer", "message"],
  properties: {
    severity: { enum: ["error", "warning"] },
    source: { enum: ["schema", "semantic"] },
    code: { type: "string" },
    pointer: { type: "string" },
    message: { type: "string" }
  }
} as const;

export const cubicaSurfaceSchema = {
  $id: CUBICA_SURFACE_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaSurface",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "surfaceId", "catalogVersion", "mode", "root"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    surfaceId: { type: "string", minLength: 1 },
    catalogVersion: { type: "string", minLength: 1 },
    mode: { enum: ["helper", "primary-gameplay"] },
    title: { type: "string" },
    dataModel: {
      type: "object",
      additionalProperties: { $ref: "#/definitions/JsonValue" }
    },
    root: { $ref: "#/definitions/CubicaSurfaceComponent" },
    metadata: metadataSchema
  },
  definitions: {
    JsonValue: jsonValueDefinition,
    CubicaSurfaceAction: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "sideEffectPolicy"],
      properties: {
        id: { type: "string", minLength: 1 },
        kind: { enum: ["noop", "agentTurn", "runtimeAction", "editorTool", "portalCommand", "openUrl"] },
        label: { type: "string" },
        target: { type: "string" },
        payload: { $ref: "#/definitions/JsonValue" },
        sideEffectPolicy: { enum: ["read-only", "human-approved", "system-approved"] },
        requiresApproval: { type: "boolean" },
        metadata: metadataSchema
      }
    },
    CubicaSurfaceComponent: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "props"],
      properties: {
        id: { type: "string", minLength: 1 },
        kind: { type: "string", minLength: 1 },
        props: {
          type: "object",
          additionalProperties: { $ref: "#/definitions/JsonValue" }
        },
        children: {
          type: "array",
          items: { $ref: "#/definitions/CubicaSurfaceComponent" }
        },
        actions: {
          type: "array",
          items: { $ref: "#/definitions/CubicaSurfaceAction" }
        },
        dataBinding: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: { type: "string", minLength: 1 },
            optional: { type: "boolean" }
          }
        },
        metadata: metadataSchema
      }
    }
  }
} as const;

export const agentTurnInputSchema = {
  $id: CUBICA_AGENT_TURN_INPUT_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentTurnInput",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "turnId",
    "sessionId",
    "gameId",
    "agentId",
    "executionMode",
    "trigger",
    "stateScope",
    "manifestProjection",
    "allowedCapabilities",
    "surfaceCatalog"
  ],
  properties: {
    schemaVersion: { const: "1.0.0" },
    turnId: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 },
    gameId: { type: "string", minLength: 1 },
    playerId: {
      type: "string",
      minLength: 1,
      not: { enum: ["__proto__", "constructor", "prototype"] }
    },
    agentId: { type: "string", minLength: 1 },
    executionMode: { enum: ["hybrid", "ai-driven"] },
    trigger: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { enum: ["playerAction", "systemEvent", "facilitatorAction", "timer"] },
        actionId: { type: "string" },
        eventType: { type: "string" },
        payload: { $ref: "#/definitions/JsonValue" }
      }
    },
    stateScope: {
      type: "object",
      additionalProperties: false,
      required: ["public"],
      properties: {
        public: {
          type: "object",
          additionalProperties: { $ref: "#/definitions/JsonValue" }
        },
        secret: {
          type: "object",
          additionalProperties: { $ref: "#/definitions/JsonValue" }
        }
      }
    },
    manifestProjection: {
      type: "object",
      additionalProperties: { $ref: "#/definitions/JsonValue" }
    },
    allowedCapabilities: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    surfaceCatalog: {
      type: "array",
      items: { type: "string", minLength: 1 }
    },
    correlationId: { type: "string" }
  },
  definitions: {
    JsonValue: jsonValueDefinition
  }
} as const;

export const agentTurnResultSchema = {
  $id: CUBICA_AGENT_TURN_RESULT_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentTurnResult",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "turnId", "agentId", "ok", "audit"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    turnId: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    ok: { type: "boolean" },
    narration: { type: "string" },
    effects: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "target"],
        properties: {
          kind: { enum: ["setFlag", "setMetric", "appendLog", "replaceStep", "grantCapability", "custom"] },
          target: { type: "string", minLength: 1 },
          value: { $ref: "#/definitions/JsonValue" },
          data: {
            type: "object",
            additionalProperties: { $ref: "#/definitions/JsonValue" }
          }
        }
      }
    },
    availableActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["actionId", "label", "kind", "sideEffectPolicy"],
        properties: {
          actionId: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          kind: { enum: ["agentTurn", "runtimeAction", "facilitatorAction"] },
          payloadSchema: {
            type: "object",
            additionalProperties: { $ref: "#/definitions/JsonValue" }
          },
          sideEffectPolicy: { enum: ["read-only", "human-approved", "system-approved"] }
        }
      }
    },
    surface: { $ref: CUBICA_SURFACE_SCHEMA_ID },
    diagnostics: {
      type: "array",
      items: diagnosticSchema
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["source", "createdAt"],
      properties: {
        source: { enum: ["mock", "local", "provider"] },
        createdAt: { type: "string" },
        model: { type: "string" },
        runId: { type: "string" },
        promptHash: { type: "string" },
        transcriptRef: { type: "string" }
      }
    },
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" }
      }
    }
  },
  definitions: {
    JsonValue: jsonValueDefinition
  }
} as const;

export const executionModeConfigSchema = {
  $id: CUBICA_EXECUTION_MODE_CONFIG_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaExecutionModeConfig",
  type: "object",
  additionalProperties: false,
  required: ["executionMode"],
  properties: {
    executionMode: { enum: ["deterministic", "hybrid", "ai-driven"] },
    agentRuntime: {
      type: "object",
      additionalProperties: false,
      required: ["agentId", "required", "allowedCapabilities", "surfaceCatalog", "failurePolicy"],
      properties: {
        agentId: { type: "string", minLength: 1 },
        runtimeId: { type: "string" },
        required: { type: "boolean" },
        allowedCapabilities: {
          type: "array",
          items: { type: "string", minLength: 1 }
        },
        surfaceCatalog: {
          type: "array",
          items: { type: "string", minLength: 1 }
        },
        failurePolicy: { enum: ["pause", "retry", "deterministicFallback", "facilitatorTakeover"] }
      }
    }
  },
  allOf: [
    {
      if: {
        properties: {
          executionMode: { enum: ["hybrid", "ai-driven"] }
        },
        required: ["executionMode"]
      },
      then: {
        required: ["agentRuntime"]
      }
    }
  ]
} as const;

export const agentRuntimeOperationPolicySchema = {
  $id: CUBICA_AGENT_RUNTIME_OPERATION_POLICY_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentRuntimeOperationPolicy",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "policyId", "idempotency", "timeout", "retry", "rateLimit", "costControl"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    policyId: { type: "string", minLength: 1 },
    idempotency: {
      type: "object",
      additionalProperties: false,
      required: ["keySource", "duplicateBehavior", "ttlSeconds"],
      properties: {
        keySource: { enum: ["turnId", "correlationId"] },
        duplicateBehavior: { enum: ["returnPrevious", "reject"] },
        ttlSeconds: { type: "integer", minimum: 1 }
      }
    },
    timeout: {
      type: "object",
      additionalProperties: false,
      required: ["turnTimeoutMs", "providerTimeoutMs"],
      properties: {
        turnTimeoutMs: { type: "integer", minimum: 100 },
        providerTimeoutMs: { type: "integer", minimum: 100 }
      }
    },
    retry: {
      type: "object",
      additionalProperties: false,
      required: ["maxAttempts", "backoffMs", "retryableErrorCodes"],
      properties: {
        maxAttempts: { type: "integer", minimum: 0, maximum: 5 },
        backoffMs: { type: "integer", minimum: 0 },
        retryableErrorCodes: {
          type: "array",
          items: { type: "string", minLength: 1 }
        }
      }
    },
    rateLimit: {
      type: "object",
      additionalProperties: false,
      required: ["perSessionTurnsPerMinute", "perAgentTurnsPerMinute"],
      properties: {
        perSessionTurnsPerMinute: { type: "integer", minimum: 1 },
        perAgentTurnsPerMinute: { type: "integer", minimum: 1 }
      }
    },
    costControl: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxInputTokensPerTurn: { type: "integer", minimum: 1 },
        maxOutputTokensPerTurn: { type: "integer", minimum: 1 },
        maxCostUsdPerSession: { type: "number", exclusiveMinimum: 0 }
      }
    }
  }
} as const;

export const agentApprovalEnvelopeSchema = {
  $id: CUBICA_AGENT_APPROVAL_ENVELOPE_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentApprovalEnvelope",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "approvalId",
    "agentId",
    "toolName",
    "approvedBy",
    "approvedAt",
    "expiresAt",
    "scopeHash",
    "status"
  ],
  properties: {
    schemaVersion: { const: "1.0.0" },
    approvalId: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    toolName: { type: "string", minLength: 1 },
    approvedBy: { type: "string", minLength: 1 },
    approvedAt: { type: "string", minLength: 1 },
    expiresAt: { type: "string", minLength: 1 },
    scopeHash: { type: "string", minLength: 1 },
    status: { enum: ["approved", "rejected"] },
    runId: { type: "string" },
    actionId: { type: "string" },
    correlationId: { type: "string" },
    metadata: metadataSchema
  },
  definitions: {
    JsonValue: jsonValueDefinition
  }
} as const;

export const agentCapabilityPolicySchema = {
  $id: CUBICA_AGENT_CAPABILITY_POLICY_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentCapabilityPolicy",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "policyId", "rules"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    policyId: { type: "string", minLength: 1 },
    rules: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["capability", "effectKinds", "targetPathPrefixes"],
        properties: {
          capability: { type: "string", minLength: 1 },
          effectKinds: {
            type: "array",
            minItems: 1,
            items: { enum: ["setFlag", "setMetric", "appendLog", "replaceStep", "grantCapability", "custom"] }
          },
          targetPathPrefixes: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 }
          },
          availableActionKinds: {
            type: "array",
            items: { enum: ["agentTurn", "runtimeAction", "facilitatorAction"] }
          },
          surfaceActionKinds: {
            type: "array",
            items: { enum: ["noop", "agentTurn", "runtimeAction", "editorTool", "portalCommand", "openUrl"] }
          }
        }
      }
    }
  }
} as const;

export const surfaceChannelActionPolicySchema = {
  $id: CUBICA_SURFACE_CHANNEL_ACTION_POLICY_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaSurfaceChannelActionPolicy",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "policyId", "channel", "allowedActionKinds"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    policyId: { type: "string", minLength: 1 },
    channel: { enum: ["web", "telegram", "phaser"] },
    surfaceMode: { enum: ["helper", "primary-gameplay"] },
    allowedActionKinds: {
      type: "array",
      minItems: 1,
      items: { enum: ["noop", "agentTurn", "runtimeAction", "editorTool", "portalCommand", "openUrl"] }
    },
    disallowedActionKinds: {
      type: "array",
      items: { enum: ["noop", "agentTurn", "runtimeAction", "editorTool", "portalCommand", "openUrl"] }
    },
    allowedTargets: {
      type: "array",
      items: { type: "string", minLength: 1 }
    }
  }
} as const;

export const surfaceComponentContributionSchema = {
  $id: CUBICA_SURFACE_COMPONENT_CONTRIBUTION_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaSurfaceComponentContribution",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "ownerPluginId",
    "kind",
    "version",
    "description",
    "safeForPrimaryGameplay",
    "propsSchema",
    "allowedActionKinds",
    "channelSupport",
    "review"
  ],
  properties: {
    schemaVersion: { const: "1.0.0" },
    ownerPluginId: { type: "string", minLength: 1 },
    kind: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    description: { type: "string", minLength: 1 },
    safeForPrimaryGameplay: { type: "boolean" },
    propsSchema: {
      type: "object",
      additionalProperties: { $ref: "#/definitions/JsonValue" }
    },
    allowedActionKinds: {
      type: "array",
      items: { enum: ["noop", "agentTurn", "runtimeAction", "editorTool", "portalCommand", "openUrl"] }
    },
    channelSupport: {
      type: "object",
      additionalProperties: false,
      required: ["web", "telegram", "phaser"],
      properties: {
        web: { $ref: "#/definitions/ChannelContribution" },
        telegram: { $ref: "#/definitions/ChannelContribution" },
        phaser: { $ref: "#/definitions/ChannelContribution" }
      }
    },
    review: {
      type: "object",
      additionalProperties: false,
      required: ["status"],
      properties: {
        status: { enum: ["draft", "approved", "rejected"] },
        reviewedBy: { type: "string" },
        reviewedAt: { type: "string" },
        notes: { type: "string" }
      }
    }
  },
  definitions: {
    JsonValue: jsonValueDefinition,
    ChannelContribution: {
      type: "object",
      additionalProperties: false,
      required: ["support"],
      properties: {
        support: { enum: ["native", "fallback", "unsupported"] },
        rendererId: { type: "string" },
        fallbackKind: { type: "string" }
      }
    }
  }
} as const;

export const a2uiLikeEventSchema = {
  $id: CUBICA_A2UI_LIKE_EVENT_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaA2uiLikeEvent",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "type", "surface"],
      properties: {
        schemaVersion: { const: "1.0.0" },
        type: { const: "surfaceUpdate" },
        surface: { $ref: CUBICA_SURFACE_SCHEMA_ID }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "type", "dataModel"],
      properties: {
        schemaVersion: { const: "1.0.0" },
        type: { const: "dataModelUpdate" },
        dataModel: {
          type: "object",
          additionalProperties: { $ref: "#/definitions/JsonValue" }
        }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "type"],
      properties: {
        schemaVersion: { const: "1.0.0" },
        type: { const: "beginRendering" },
        surfaceId: { type: "string" }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "type", "diagnostic"],
      properties: {
        schemaVersion: { const: "1.0.0" },
        type: { const: "diagnostic" },
        diagnostic: diagnosticSchema
      }
    }
  ],
  definitions: {
    JsonValue: jsonValueDefinition
  }
} as const;

export const agentTurnEventLogEntrySchema = {
  $id: CUBICA_AGENT_TURN_EVENT_LOG_ENTRY_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentTurnEventLogEntry",
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "eventId",
    "turnId",
    "sessionId",
    "gameId",
    "agentId",
    "status",
    "recordedAt",
    "trigger",
    "effectCount",
    "audit"
  ],
  properties: {
    schemaVersion: { const: "1.0.0" },
    eventId: { type: "string", minLength: 1 },
    turnId: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 },
    gameId: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    status: { enum: ["accepted", "rejected"] },
    recordedAt: { type: "string", minLength: 1 },
    trigger: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { enum: ["playerAction", "systemEvent", "facilitatorAction", "timer"] },
        actionId: { type: "string" },
        eventType: { type: "string" },
        payload: { $ref: "#/definitions/JsonValue" }
      }
    },
    effectCount: { type: "integer", minimum: 0 },
    surfaceId: { type: "string" },
    rejectionReason: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" }
      }
    },
    rejectedDiagnostics: {
      type: "array",
      items: diagnosticSchema
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["source", "createdAt"],
      properties: {
        source: { enum: ["mock", "local", "provider"] },
        createdAt: { type: "string" },
        model: { type: "string" },
        runId: { type: "string" },
        promptHash: { type: "string" },
        transcriptRef: { type: "string" }
      }
    },
    correlationId: { type: "string" }
  },
  definitions: {
    JsonValue: jsonValueDefinition
  }
} as const;

export const agentReplayTranscriptSchema = {
  $id: CUBICA_AGENT_REPLAY_TRANSCRIPT_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentReplayTranscript",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "transcriptId", "gameId", "sessionId", "createdAt", "entries", "redaction"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    transcriptId: { type: "string", minLength: 1 },
    gameId: { type: "string", minLength: 1 },
    sessionId: { type: "string", minLength: 1 },
    createdAt: { type: "string", minLength: 1 },
    entries: {
      type: "array",
      items: { $ref: CUBICA_AGENT_TURN_EVENT_LOG_ENTRY_SCHEMA_ID }
    },
    redaction: {
      type: "object",
      additionalProperties: false,
      required: ["secretStateIncluded", "policy"],
      properties: {
        secretStateIncluded: { const: false },
        policy: { type: "string", minLength: 1 },
        redactedPaths: {
          type: "array",
          items: { type: "string" }
        }
      }
    }
  }
} as const;

export const agentEvaluationFixtureSchema = {
  $id: CUBICA_AGENT_EVALUATION_FIXTURE_SCHEMA_ID,
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "CubicaAgentEvaluationFixture",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "fixtureId", "gameId", "input", "expected", "audit"],
  properties: {
    schemaVersion: { const: "1.0.0" },
    fixtureId: { type: "string", minLength: 1 },
    gameId: { type: "string", minLength: 1 },
    title: { type: "string" },
    input: { $ref: CUBICA_AGENT_TURN_INPUT_SCHEMA_ID },
    expected: {
      type: "object",
      additionalProperties: false,
      properties: {
        ok: { type: "boolean" },
        allowedSurfaceKinds: {
          type: "array",
          items: { type: "string", minLength: 1 }
        },
        requiredEffectKinds: {
          type: "array",
          items: { enum: ["setFlag", "setMetric", "appendLog", "replaceStep", "grantCapability", "custom"] }
        },
        forbiddenDiagnosticCodes: {
          type: "array",
          items: { type: "string", minLength: 1 }
        },
        maxErrorSeverity: { enum: ["error", "warning"] }
      }
    },
    audit: {
      type: "object",
      additionalProperties: false,
      required: ["createdAt", "owner"],
      properties: {
        createdAt: { type: "string", minLength: 1 },
        owner: { type: "string", minLength: 1 }
      }
    }
  }
} as const;

const forbiddenGeneratedUiKeys = new Set([
  "dangerouslySetInnerHTML",
  "innerHTML",
  "html",
  "rawHtml",
  "script",
  "scriptBody",
  "eval"
]);

const forbiddenDirectStateMutationKeys = new Set([
  "statePatch",
  "sessionPatch",
  "directStatePatch",
  "directStateMutation",
  "jsonPatch",
  "mergePatch"
]);

const forbiddenAgentEffectKinds = new Set(["jsonPatch", "mergePatch", "directStatePatch", "sessionPatch", "rawState"]);

let validatorsCache:
  | {
      readonly surface: ValidateFunction;
      readonly turnInput: ValidateFunction;
      readonly turnResult: ValidateFunction;
      readonly executionMode: ValidateFunction;
      readonly componentContribution: ValidateFunction;
      readonly eventLogEntry: ValidateFunction;
      readonly replayTranscript: ValidateFunction;
      readonly evaluationFixture: ValidateFunction;
      readonly a2uiLikeEvent: ValidateFunction;
      readonly runtimeOperationPolicy: ValidateFunction;
      readonly approvalEnvelope: ValidateFunction;
      readonly capabilityPolicy: ValidateFunction;
      readonly surfaceChannelActionPolicy: ValidateFunction;
    }
  | undefined;

/**
 * Validates a Cubica Surface through JSON Schema and semantic catalog rules.
 *
 * JSON Schema catches shape errors. The semantic pass catches policy rules that
 * depend on the selected renderer catalog, such as unsupported channels or
 * attempts to smuggle executable UI into props.
 */
export function validateCubicaSurface(
  input: unknown,
  options: CubicaSurfaceValidationOptions = {}
): CubicaValidationResult<CubicaSurface> {
  const validate = getCompiledValidators().surface;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const surface = input as CubicaSurface;
  const semanticDiagnostics = validateSurfaceSemantics(surface, options);
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: surface,
    diagnostics
  };
}

export function validateAgentTurnInput(input: unknown): CubicaValidationResult<CubicaAgentTurnInput> {
  const validate = getCompiledValidators().turnInput;
  const valid = validate(input);
  const diagnostics = valid ? [] : mapAjvErrors(validate.errors);

  return {
    ok: valid,
    value: valid ? (input as CubicaAgentTurnInput) : undefined,
    diagnostics
  };
}

export function validateAgentTurnResult(
  input: unknown,
  options: CubicaAgentTurnValidationOptions = {}
): CubicaValidationResult<CubicaAgentTurnResult> {
  const validate = getCompiledValidators().turnResult;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const result = input as CubicaAgentTurnResult;
  const semanticDiagnostics = validateAgentTurnSemantics(result, options);
  const surfaceDiagnostics =
    result.surface === undefined ? [] : validateCubicaSurface(result.surface, options).diagnostics;
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics, ...surfaceDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: result,
    diagnostics
  };
}

export function validateExecutionModeConfig(input: unknown): CubicaValidationResult<CubicaExecutionModeConfig> {
  const validate = getCompiledValidators().executionMode;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);
  const semanticDiagnostics = valid ? validateExecutionModeSemantics(input as CubicaExecutionModeConfig) : [];
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: diagnostics.length === 0 ? (input as CubicaExecutionModeConfig) : undefined,
    diagnostics
  };
}

export function validateSurfaceComponentContribution(
  input: unknown
): CubicaValidationResult<CubicaSurfaceComponentContribution> {
  const validate = getCompiledValidators().componentContribution;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const contribution = input as CubicaSurfaceComponentContribution;
  const semanticDiagnostics = validateSurfaceComponentContributionSemantics(contribution);
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: contribution,
    diagnostics
  };
}

/**
 * Converts an approved plugin contribution into the runtime allowlist catalog.
 *
 * Draft and rejected contributions are intentionally not converted: agents may
 * only emit components that passed review and have explicit channel behavior.
 */
export function surfaceContributionToCatalogComponent(
  contribution: CubicaSurfaceComponentContribution
): CubicaValidationResult<CubicaSurfaceCatalogComponent> {
  const validation = validateSurfaceComponentContribution(contribution);

  if (!validation.ok) {
    return { ok: false, diagnostics: validation.diagnostics };
  }

  return {
    ok: true,
    value: {
      kind: contribution.kind,
      version: contribution.version,
      description: contribution.description,
      safeForPrimaryGameplay: contribution.safeForPrimaryGameplay,
      channelSupport: {
        web: contribution.channelSupport.web.support,
        telegram: contribution.channelSupport.telegram.support,
        phaser: contribution.channelSupport.phaser.support
      },
      allowedActionKinds: contribution.allowedActionKinds
    },
    diagnostics: []
  };
}

export function validateAgentTurnEventLogEntry(
  input: unknown
): CubicaValidationResult<CubicaAgentTurnEventLogEntry> {
  const validate = getCompiledValidators().eventLogEntry;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const entry = input as CubicaAgentTurnEventLogEntry;
  const semanticDiagnostics = validateAgentTurnEventLogEntrySemantics(entry);
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: entry,
    diagnostics
  };
}

export function validateAgentReplayTranscript(
  input: unknown
): CubicaValidationResult<CubicaAgentReplayTranscript> {
  const validate = getCompiledValidators().replayTranscript;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const transcript = input as CubicaAgentReplayTranscript;
  const entryDiagnostics = transcript.entries.flatMap((entry, index) =>
    validateAgentTurnEventLogEntry(entry).diagnostics.map((diagnostic) => ({
      ...diagnostic,
      pointer: `/entries/${index}${diagnostic.pointer === "/" ? "" : diagnostic.pointer}`
    }))
  );
  const diagnostics = [...schemaDiagnostics, ...entryDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: transcript,
    diagnostics
  };
}

export function validateAgentEvaluationFixture(
  input: unknown
): CubicaValidationResult<CubicaAgentEvaluationFixture> {
  const validate = getCompiledValidators().evaluationFixture;
  const valid = validate(input);
  const diagnostics = valid ? [] : mapAjvErrors(validate.errors);

  return {
    ok: valid,
    value: valid ? (input as CubicaAgentEvaluationFixture) : undefined,
    diagnostics
  };
}

export function validateA2uiLikeEvent(input: unknown): CubicaValidationResult<CubicaA2uiLikeEvent> {
  const validate = getCompiledValidators().a2uiLikeEvent;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const event = input as CubicaA2uiLikeEvent;
  const surfaceDiagnostics =
    event.type === "surfaceUpdate" ? validateCubicaSurface(event.surface).diagnostics : [];
  const diagnostics = [...schemaDiagnostics, ...surfaceDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: event,
    diagnostics
  };
}

export function validateAgentRuntimeOperationPolicy(
  input: unknown
): CubicaValidationResult<CubicaAgentRuntimeOperationPolicy> {
  const validate = getCompiledValidators().runtimeOperationPolicy;
  const valid = validate(input);
  const diagnostics = valid ? [] : mapAjvErrors(validate.errors);

  return {
    ok: valid,
    value: valid ? (input as CubicaAgentRuntimeOperationPolicy) : undefined,
    diagnostics
  };
}

export function validateAgentApprovalEnvelope(
  input: unknown,
  options: CubicaAgentApprovalValidationOptions = {}
): CubicaValidationResult<CubicaAgentApprovalEnvelope> {
  const validate = getCompiledValidators().approvalEnvelope;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const envelope = input as CubicaAgentApprovalEnvelope;
  const semanticDiagnostics = validateAgentApprovalEnvelopeSemantics(envelope, options);
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: envelope,
    diagnostics
  };
}

export function buildCubicaAgentApprovalEnvelope(
  args: Omit<CubicaAgentApprovalEnvelope, "schemaVersion">
): CubicaAgentApprovalEnvelope {
  return {
    schemaVersion: "1.0.0",
    ...args
  };
}

export function validateAgentCapabilityPolicy(
  input: unknown
): CubicaValidationResult<CubicaAgentCapabilityPolicy> {
  const validate = getCompiledValidators().capabilityPolicy;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const policy = input as CubicaAgentCapabilityPolicy;
  const semanticDiagnostics = validateAgentCapabilityPolicySemantics(policy);
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: policy,
    diagnostics
  };
}

export function validateSurfaceChannelActionPolicy(
  input: unknown
): CubicaValidationResult<CubicaSurfaceChannelActionPolicy> {
  const validate = getCompiledValidators().surfaceChannelActionPolicy;
  const valid = validate(input);
  const schemaDiagnostics = valid ? [] : mapAjvErrors(validate.errors);

  if (!valid) {
    return { ok: false, diagnostics: schemaDiagnostics };
  }

  const policy = input as CubicaSurfaceChannelActionPolicy;
  const semanticDiagnostics = validateSurfaceChannelActionPolicySemantics(policy);
  const diagnostics = [...schemaDiagnostics, ...semanticDiagnostics];

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    value: policy,
    diagnostics
  };
}

export function validateAgentTurnCapabilities(
  result: CubicaAgentTurnResult,
  allowedCapabilities: readonly string[],
  policy: CubicaAgentCapabilityPolicy = defaultCubicaAgentCapabilityPolicy
): readonly CubicaContractDiagnostic[] {
  const policyValidation = validateAgentCapabilityPolicy(policy);
  if (!policyValidation.ok) {
    return policyValidation.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      pointer: `/capabilityPolicy${diagnostic.pointer === "/" ? "" : diagnostic.pointer}`
    }));
  }

  const rules = policy.rules.filter((rule) => allowedCapabilities.includes(rule.capability));
  const diagnostics: CubicaContractDiagnostic[] = [];

  for (const [effectIndex, effect] of (result.effects ?? []).entries()) {
    if (!rules.some((rule) => capabilityRuleAllowsEffect(rule, effect))) {
      diagnostics.push(
        makeDiagnostic(
          "capabilityEffectNotAllowed",
          `/effects/${effectIndex}`,
          `Agent effect ${effect.kind} on ${effect.target} is outside declared allowedCapabilities`
        )
      );
    }
  }

  for (const [actionIndex, action] of (result.availableActions ?? []).entries()) {
    if (!rules.some((rule) => rule.availableActionKinds?.includes(action.kind) === true)) {
      diagnostics.push(
        makeDiagnostic(
          "capabilityAvailableActionNotAllowed",
          `/availableActions/${actionIndex}`,
          `Available action kind ${action.kind} is outside declared allowedCapabilities`
        )
      );
    }
  }

  if (result.surface !== undefined) {
    walkSurfaceComponents(result.surface.root, "/surface/root", (component, pointer) => {
      for (const [actionIndex, action] of (component.actions ?? []).entries()) {
        if (!rules.some((rule) => rule.surfaceActionKinds?.includes(action.kind) === true)) {
          diagnostics.push(
            makeDiagnostic(
              "capabilitySurfaceActionNotAllowed",
              `${pointer}/actions/${actionIndex}`,
              `Surface action kind ${action.kind} is outside declared allowedCapabilities`
            )
          );
        }
      }
    });
  }

  return diagnostics;
}

export function adaptA2uiLikeEventsToCubicaSurface(
  events: readonly unknown[],
  options: CubicaSurfaceValidationOptions = {}
): CubicaA2uiAdapterResult {
  let surface: CubicaSurface | undefined;
  let readyToRender = false;
  const diagnostics: CubicaContractDiagnostic[] = [];

  for (const [index, eventInput] of events.entries()) {
    const validation = validateA2uiLikeEvent(eventInput);
    if (!validation.ok || validation.value === undefined) {
      diagnostics.push(
        ...validation.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          pointer: `/events/${index}${diagnostic.pointer === "/" ? "" : diagnostic.pointer}`
        }))
      );
      continue;
    }

    const event = validation.value;
    switch (event.type) {
      case "surfaceUpdate":
        surface = event.surface;
        break;
      case "dataModelUpdate":
        surface =
          surface === undefined
            ? surface
            : {
                ...surface,
                dataModel: {
                  ...(surface.dataModel ?? {}),
                  ...event.dataModel
                }
              };
        break;
      case "beginRendering":
        readyToRender = event.surfaceId === undefined || event.surfaceId === surface?.surfaceId;
        if (!readyToRender) {
          diagnostics.push(
            makeDiagnostic(
              "a2uiSurfaceIdMismatch",
              `/events/${index}/surfaceId`,
              `A2UI-like beginRendering references ${event.surfaceId}, but current surface is ${surface?.surfaceId ?? "missing"}`
            )
          );
        }
        break;
      case "diagnostic":
        diagnostics.push(event.diagnostic);
        break;
    }
  }

  if (surface === undefined) {
    diagnostics.push(makeDiagnostic("a2uiSurfaceMissing", "/events", "A2UI-like stream did not include a surfaceUpdate event"));
  } else {
    diagnostics.push(...validateCubicaSurface(surface, options).diagnostics);
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error") && surface !== undefined,
    surface,
    readyToRender,
    diagnostics
  };
}

export function buildAcceptedAgentTurnEventLogEntry(args: {
  readonly eventId: string;
  readonly input: CubicaAgentTurnInput;
  readonly result: CubicaAgentTurnResult;
  readonly recordedAt: string;
}): CubicaAgentTurnEventLogEntry {
  return {
    schemaVersion: "1.0.0",
    eventId: args.eventId,
    turnId: args.input.turnId,
    sessionId: args.input.sessionId,
    gameId: args.input.gameId,
    agentId: args.result.agentId,
    status: "accepted",
    recordedAt: args.recordedAt,
    trigger: args.input.trigger,
    effectCount: args.result.effects?.length ?? 0,
    surfaceId: args.result.surface?.surfaceId,
    audit: args.result.audit,
    correlationId: args.input.correlationId
  };
}

export function buildRejectedAgentTurnEventLogEntry(args: {
  readonly eventId: string;
  readonly input: CubicaAgentTurnInput;
  readonly recordedAt: string;
  readonly reason: { readonly code: string; readonly message: string };
  readonly diagnostics?: readonly CubicaContractDiagnostic[];
  readonly audit: CubicaAgentTurnAuditMetadata;
}): CubicaAgentTurnEventLogEntry {
  return {
    schemaVersion: "1.0.0",
    eventId: args.eventId,
    turnId: args.input.turnId,
    sessionId: args.input.sessionId,
    gameId: args.input.gameId,
    agentId: args.input.agentId,
    status: "rejected",
    recordedAt: args.recordedAt,
    trigger: args.input.trigger,
    effectCount: 0,
    rejectionReason: args.reason,
    rejectedDiagnostics: args.diagnostics,
    audit: args.audit,
    correlationId: args.input.correlationId
  };
}

export function projectSurfaceForTelegram(
  surface: CubicaSurface,
  options: CubicaSurfaceProjectionOptions = {}
): CubicaTelegramSurfaceProjection {
  const validation = validateCubicaSurface(surface, {
    catalog: options.catalog,
    targetChannel: "telegram",
    channelActionPolicy: options.channelActionPolicy ?? defaultCubicaSurfaceChannelActionPolicies.telegram
  });
  const diagnostics = validation.diagnostics.slice();
  const actionsSuppressed = !validation.ok;
  const messages: CubicaTelegramSurfaceMessage[] = [];
  const buttons: CubicaTelegramSurfaceButton[] = [];

  walkSurfaceComponents(surface.root, "/root", (component) => {
    const support = getCatalogSupport(component.kind, "telegram", options.catalog);

    if (support === "unsupported") {
      messages.push({
        id: `${component.id}:unsupported`,
        text: `Компонент ${component.kind} не поддержан в Telegram.`
      });
      return;
    }

    const text = componentToTelegramText(component);
    if (text !== undefined) {
      messages.push({ id: component.id, text });
    }

    for (const action of component.actions ?? []) {
      if (!actionsSuppressed && (action.kind === "agentTurn" || action.kind === "runtimeAction" || action.kind === "openUrl")) {
        buttons.push({
          id: action.id,
          label: action.label ?? action.id,
          action
        });
      }
    }
  });

  return {
    channel: "telegram",
    surfaceId: surface.surfaceId,
    title: surface.title,
    ok: validation.ok,
    actionsSuppressed,
    messages,
    inlineKeyboard: buttons.map((button) => [button]),
    diagnostics
  };
}

export function projectSurfaceForPhaser(
  surface: CubicaSurface,
  options: CubicaSurfaceProjectionOptions = {}
): CubicaPhaserSurfaceProjection {
  const validation = validateCubicaSurface(surface, {
    catalog: options.catalog,
    targetChannel: "phaser",
    channelActionPolicy: options.channelActionPolicy ?? defaultCubicaSurfaceChannelActionPolicies.phaser
  });
  const diagnostics = validation.diagnostics.slice();
  const actionsSuppressed = !validation.ok;
  const elements: CubicaPhaserSurfaceElement[] = [];
  const interactiveZones: CubicaPhaserSurfaceInteractiveZone[] = [];

  walkSurfaceComponents(surface.root, "/root", (component) => {
    const support = getCatalogSupport(component.kind, "phaser", options.catalog);

    if (support === "unsupported") {
      elements.push({
        id: `${component.id}:unsupported`,
        componentKind: component.kind,
        kind: "diagnostic",
        text: `Компонент ${component.kind} не поддержан в Phaser.`
      });
      return;
    }

    elements.push(...componentToPhaserElements(component));

    for (const action of component.actions ?? []) {
      if (!actionsSuppressed && (action.kind === "agentTurn" || action.kind === "runtimeAction")) {
        interactiveZones.push({
          id: action.id,
          label: action.label ?? action.id,
          action
        });
      }
    }
  });

  return {
    channel: "phaser",
    surfaceId: surface.surfaceId,
    title: surface.title,
    ok: validation.ok,
    actionsSuppressed,
    elements,
    interactiveZones,
    diagnostics
  };
}

function getCompiledValidators() {
  if (validatorsCache !== undefined) {
    return validatorsCache;
  }

  const AjvConstructor =
    (AjvModule as unknown as { readonly default?: LocalAjvConstructor }).default ??
    (AjvModule as unknown as LocalAjvConstructor);
  // Strict Ajv mode keeps these AI/agent JSON Schemas the single source of truth
  // (ADR-025): unknown keywords/formats and malformed schemas fail fast instead
  // of being silently ignored. allowUnionTypes and ajv-formats are applied for a
  // uniform, principled config across the codebase's validators (union `type`
  // arrays are valid JSON Schema; ajv-formats registers standard formats so any
  // `format` keyword is recognised, not rejected as unknown under strict mode).
  // strictRequired is disabled because the AI schemas use a standard conditional
  // idiom — e.g. execution-mode-config `allOf/0/then: {required:["agentRuntime"]}`
  // — where the required property is defined at the parent level and not re-listed
  // inside the `then` subschema. `required` is still fully enforced; only the
  // authoring lint is relaxed. Documented bounded exception in LEGACY-0016.
  const ajv = new AjvConstructor({ allErrors: true, strict: true, allowUnionTypes: true, strictRequired: false });
  const addFormats =
    (addFormatsModule as unknown as { readonly default?: (instance: LocalAjvInstance) => void }).default ??
    (addFormatsModule as unknown as (instance: LocalAjvInstance) => void);
  addFormats(ajv);

  ajv.addSchema(cubicaSurfaceSchema as AnySchema, CUBICA_SURFACE_SCHEMA_ID);
  ajv.addSchema(agentTurnInputSchema as AnySchema, CUBICA_AGENT_TURN_INPUT_SCHEMA_ID);
  ajv.addSchema(agentTurnEventLogEntrySchema as AnySchema, CUBICA_AGENT_TURN_EVENT_LOG_ENTRY_SCHEMA_ID);
  ajv.addSchema(a2uiLikeEventSchema as AnySchema, CUBICA_A2UI_LIKE_EVENT_SCHEMA_ID);
  ajv.addSchema(agentApprovalEnvelopeSchema as AnySchema, CUBICA_AGENT_APPROVAL_ENVELOPE_SCHEMA_ID);
  ajv.addSchema(agentCapabilityPolicySchema as AnySchema, CUBICA_AGENT_CAPABILITY_POLICY_SCHEMA_ID);
  ajv.addSchema(surfaceChannelActionPolicySchema as AnySchema, CUBICA_SURFACE_CHANNEL_ACTION_POLICY_SCHEMA_ID);

  validatorsCache = {
    surface: ajv.getSchema(CUBICA_SURFACE_SCHEMA_ID) ?? ajv.compile(cubicaSurfaceSchema as AnySchema),
    turnInput: ajv.getSchema(CUBICA_AGENT_TURN_INPUT_SCHEMA_ID) ?? ajv.compile(agentTurnInputSchema as AnySchema),
    turnResult: ajv.compile(agentTurnResultSchema as AnySchema),
    executionMode: ajv.compile(executionModeConfigSchema as AnySchema),
    componentContribution: ajv.compile(surfaceComponentContributionSchema as AnySchema),
    eventLogEntry:
      ajv.getSchema(CUBICA_AGENT_TURN_EVENT_LOG_ENTRY_SCHEMA_ID) ??
      ajv.compile(agentTurnEventLogEntrySchema as AnySchema),
    replayTranscript: ajv.compile(agentReplayTranscriptSchema as AnySchema),
    evaluationFixture: ajv.compile(agentEvaluationFixtureSchema as AnySchema),
    a2uiLikeEvent: ajv.getSchema(CUBICA_A2UI_LIKE_EVENT_SCHEMA_ID) ?? ajv.compile(a2uiLikeEventSchema as AnySchema),
    runtimeOperationPolicy: ajv.compile(agentRuntimeOperationPolicySchema as AnySchema),
    approvalEnvelope:
      ajv.getSchema(CUBICA_AGENT_APPROVAL_ENVELOPE_SCHEMA_ID) ??
      ajv.compile(agentApprovalEnvelopeSchema as AnySchema),
    capabilityPolicy:
      ajv.getSchema(CUBICA_AGENT_CAPABILITY_POLICY_SCHEMA_ID) ??
      ajv.compile(agentCapabilityPolicySchema as AnySchema),
    surfaceChannelActionPolicy:
      ajv.getSchema(CUBICA_SURFACE_CHANNEL_ACTION_POLICY_SCHEMA_ID) ??
      ajv.compile(surfaceChannelActionPolicySchema as AnySchema)
  };

  return validatorsCache;
}

function validateSurfaceSemantics(
  surface: CubicaSurface,
  options: CubicaSurfaceValidationOptions
): CubicaContractDiagnostic[] {
  const catalog = toCatalogMap(options.catalog ?? defaultCubicaSurfaceCatalog);
  const diagnostics: CubicaContractDiagnostic[] = [];
  const channelPolicy = options.channelActionPolicy;

  if (channelPolicy !== undefined) {
    const policyValidation = validateSurfaceChannelActionPolicy(channelPolicy);
    diagnostics.push(
      ...policyValidation.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        pointer: `/channelActionPolicy${diagnostic.pointer === "/" ? "" : diagnostic.pointer}`
      }))
    );

    if (options.targetChannel !== undefined && channelPolicy.channel !== options.targetChannel) {
      diagnostics.push(
        makeDiagnostic(
          "channelPolicyMismatch",
          "/channelActionPolicy/channel",
          `Channel action policy ${channelPolicy.policyId} is for ${channelPolicy.channel}, not ${options.targetChannel}`
        )
      );
    }

    if (channelPolicy.surfaceMode !== undefined && channelPolicy.surfaceMode !== surface.mode) {
      diagnostics.push(
        makeDiagnostic(
          "channelPolicySurfaceModeMismatch",
          "/channelActionPolicy/surfaceMode",
          `Channel action policy ${channelPolicy.policyId} is for ${channelPolicy.surfaceMode}, not ${surface.mode}`
        )
      );
    }
  }

  collectForbiddenKeyDiagnostics(surface, "", diagnostics);
  walkSurfaceComponents(surface.root, "/root", (component, pointer) => {
    const definition = catalog.get(component.kind);

    if (definition === undefined) {
      diagnostics.push(makeDiagnostic("unknownComponent", pointer, `Surface component is not in catalog: ${component.kind}`));
      return;
    }

    if (surface.mode === "primary-gameplay" && !definition.safeForPrimaryGameplay) {
      diagnostics.push(
        makeDiagnostic(
          "componentNotPrimaryGameplaySafe",
          pointer,
          `Surface component cannot be used as primary gameplay UI: ${component.kind}`
        )
      );
    }

    const channelSupport = options.targetChannel === undefined ? undefined : definition.channelSupport[options.targetChannel];
    if (channelSupport === "unsupported") {
      diagnostics.push(
        makeDiagnostic(
          "unsupportedChannelComponent",
          pointer,
          `Surface component ${component.kind} is unsupported on ${options.targetChannel}`
        )
      );
    }

    for (const [actionIndex, action] of (component.actions ?? []).entries()) {
      const actionPointer = `${pointer}/actions/${actionIndex}`;
      if (!definition.allowedActionKinds.includes(action.kind)) {
        diagnostics.push(
          makeDiagnostic(
            "unsupportedComponentAction",
            actionPointer,
            `Action kind ${action.kind} is not allowed for component ${component.kind}`
          )
        );
      }
      validateSurfaceAction(action, actionPointer, diagnostics, channelPolicy);
    }
  });

  return diagnostics;
}

function validateSurfaceAction(
  action: CubicaSurfaceAction,
  pointer: string,
  diagnostics: CubicaContractDiagnostic[],
  channelPolicy?: CubicaSurfaceChannelActionPolicy
): void {
  const mutating = action.kind === "agentTurn" || action.kind === "runtimeAction" || action.kind === "editorTool" || action.kind === "portalCommand";

  if (mutating && action.sideEffectPolicy === "read-only") {
    diagnostics.push(
      makeDiagnostic(
        "mutatingActionMarkedReadOnly",
        pointer,
        `Mutating action ${action.id} must not use read-only side-effect policy`
      )
    );
  }

  if (action.sideEffectPolicy === "human-approved" && action.requiresApproval !== true) {
    diagnostics.push(
      makeDiagnostic(
        "missingHumanApprovalRule",
        pointer,
        `Human-approved action ${action.id} must declare requiresApproval: true`
      )
    );
  }

  if (channelPolicy !== undefined) {
    if (!channelPolicy.allowedActionKinds.includes(action.kind)) {
      diagnostics.push(
        makeDiagnostic(
          "unsupportedChannelActionKind",
          pointer,
          `Action kind ${action.kind} is not allowed by channel policy ${channelPolicy.policyId}`
        )
      );
    }

    if (channelPolicy.disallowedActionKinds?.includes(action.kind) === true) {
      diagnostics.push(
        makeDiagnostic(
          "disallowedChannelActionKind",
          pointer,
          `Action kind ${action.kind} is explicitly disallowed by channel policy ${channelPolicy.policyId}`
        )
      );
    }

    if (channelPolicy.allowedTargets !== undefined && action.kind !== "noop") {
      if (action.target === undefined || !channelPolicy.allowedTargets.includes(action.target)) {
        diagnostics.push(
          makeDiagnostic(
            "unsupportedChannelActionTarget",
            `${pointer}/target`,
            `Action target ${action.target ?? "missing"} is not allowed by channel policy ${channelPolicy.policyId}`
          )
        );
      }
    }
  }
}

function validateAgentTurnSemantics(
  result: CubicaAgentTurnResult,
  options: CubicaAgentTurnValidationOptions
): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];
  const forbiddenStatePathPrefixes = options.forbiddenStatePathPrefixes ?? ["secret", "/secret", "state.secret", "/state/secret"];

  collectForbiddenKeyDiagnostics(result, "", diagnostics);

  if (result.ok === false) {
    if ((result.effects?.length ?? 0) > 0) {
      diagnostics.push(
        makeDiagnostic(
          "rejectedTurnHasEffects",
          "/effects",
          "Rejected Agent Turn results must not include persisted effects"
        )
      );
    }

    if ((result.availableActions?.length ?? 0) > 0) {
      diagnostics.push(
        makeDiagnostic(
          "rejectedTurnHasAvailableActions",
          "/availableActions",
          "Rejected Agent Turn results must not expose executable gameplay actions"
        )
      );
    }

    if (result.surface !== undefined) {
      diagnostics.push(
        makeDiagnostic(
          "rejectedTurnHasSurface",
          "/surface",
          "Rejected Agent Turn results must not expose primary gameplay Surface"
        )
      );
    }
  }

  for (const [effectIndex, effect] of (result.effects ?? []).entries()) {
    const pointer = `/effects/${effectIndex}`;

    if (forbiddenAgentEffectKinds.has(effect.kind)) {
      diagnostics.push(makeDiagnostic("forbiddenAgentEffectKind", pointer, `Agent effect kind is forbidden: ${effect.kind}`));
    }

    if (forbiddenStatePathPrefixes.some((prefix) => effect.target === prefix || effect.target.startsWith(`${prefix}.`) || effect.target.startsWith(`${prefix}/`))) {
      diagnostics.push(makeDiagnostic("forbiddenStatePath", `${pointer}/target`, `Agent effect targets forbidden state path: ${effect.target}`));
    }
  }

  return diagnostics;
}

function validateExecutionModeSemantics(config: CubicaExecutionModeConfig): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];

  if (config.executionMode === "deterministic" && config.agentRuntime?.required === true) {
    diagnostics.push(
      makeDiagnostic(
        "deterministicRequiresAgentRuntime",
        "/agentRuntime/required",
        "Deterministic games must not require Agent Runtime"
      )
    );
  }

  if ((config.executionMode === "ai-driven" || config.executionMode === "hybrid") && config.agentRuntime?.required !== true) {
    diagnostics.push(
      makeDiagnostic(
        "agentRuntimeNotRequired",
        "/agentRuntime/required",
        `${config.executionMode} games must declare Agent Runtime as required`
      )
    );
  }

  return diagnostics;
}

function validateAgentApprovalEnvelopeSemantics(
  envelope: CubicaAgentApprovalEnvelope,
  options: CubicaAgentApprovalValidationOptions
): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];
  const approvedAt = Date.parse(envelope.approvedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  const now = Date.parse(options.nowIso ?? new Date().toISOString());

  if (!Number.isFinite(approvedAt)) {
    diagnostics.push(makeDiagnostic("invalidApprovalTimestamp", "/approvedAt", "Approval timestamp must be a valid ISO date"));
  }

  if (!Number.isFinite(expiresAt)) {
    diagnostics.push(makeDiagnostic("invalidApprovalExpiry", "/expiresAt", "Approval expiry must be a valid ISO date"));
  }

  if (Number.isFinite(approvedAt) && Number.isFinite(expiresAt) && expiresAt <= approvedAt) {
    diagnostics.push(
      makeDiagnostic("approvalExpiryBeforeCreation", "/expiresAt", "Approval expiry must be later than approval creation")
    );
  }

  if (Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt <= now) {
    diagnostics.push(makeDiagnostic("approvalEnvelopeExpired", "/expiresAt", "Approval envelope has expired"));
  }

  if (options.requireApproved === true && envelope.status !== "approved") {
    diagnostics.push(makeDiagnostic("approvalEnvelopeNotApproved", "/status", "Approval envelope status must be approved"));
  }

  if (options.expectedToolName !== undefined && envelope.toolName !== options.expectedToolName) {
    diagnostics.push(
      makeDiagnostic(
        "approvalToolMismatch",
        "/toolName",
        `Approval envelope is scoped to ${envelope.toolName}, not ${options.expectedToolName}`
      )
    );
  }

  if (options.expectedScopeHash !== undefined && envelope.scopeHash !== options.expectedScopeHash) {
    diagnostics.push(
      makeDiagnostic(
        "approvalScopeMismatch",
        "/scopeHash",
        "Approval envelope scope does not match the requested operation"
      )
    );
  }

  return diagnostics;
}

function validateAgentCapabilityPolicySemantics(policy: CubicaAgentCapabilityPolicy): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];
  const seenCapabilities = new Set<string>();

  for (const [ruleIndex, rule] of policy.rules.entries()) {
    if (seenCapabilities.has(rule.capability)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicateCapabilityRule",
          `/rules/${ruleIndex}/capability`,
          `Capability policy declares duplicate rule for ${rule.capability}`
        )
      );
    }
    seenCapabilities.add(rule.capability);
  }

  return diagnostics;
}

function validateSurfaceChannelActionPolicySemantics(
  policy: CubicaSurfaceChannelActionPolicy
): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];
  const allowed = new Set(policy.allowedActionKinds);

  for (const [actionIndex, actionKind] of (policy.disallowedActionKinds ?? []).entries()) {
    if (allowed.has(actionKind)) {
      diagnostics.push(
        makeDiagnostic(
          "channelPolicyContradiction",
          `/disallowedActionKinds/${actionIndex}`,
          `Action kind ${actionKind} cannot be both allowed and disallowed`
        )
      );
    }
  }

  return diagnostics;
}

function capabilityRuleAllowsEffect(rule: CubicaAgentCapabilityRule, effect: CubicaAgentStateEffect): boolean {
  return rule.effectKinds.includes(effect.kind) && rule.targetPathPrefixes.some((prefix) => pathMatchesPrefix(effect.target, prefix));
}

function validateSurfaceComponentContributionSemantics(
  contribution: CubicaSurfaceComponentContribution
): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];
  const componentKindPattern = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_.-]*$/u;

  collectForbiddenKeyDiagnostics(contribution, "", diagnostics);

  if (!componentKindPattern.test(contribution.kind)) {
    diagnostics.push(
      makeDiagnostic(
        "invalidComponentNamespace",
        "/kind",
        "Plugin Surface component kind must use a stable namespace, for example plugin.componentName"
      )
    );
  }

  if (contribution.ownerPluginId !== "cubica-core" && contribution.kind.startsWith("cubica.")) {
    diagnostics.push(
      makeDiagnostic(
        "reservedCubicaNamespace",
        "/kind",
        "Only cubica-core may contribute components in the reserved cubica namespace"
      )
    );
  }

  if (contribution.allowedActionKinds.length === 0) {
    diagnostics.push(
      makeDiagnostic(
        "missingAllowedActions",
        "/allowedActionKinds",
        "Surface component contribution must declare at least one allowed action kind"
      )
    );
  }

  for (const channel of ["web", "telegram", "phaser"] as const) {
    const support = contribution.channelSupport[channel];
    const pointer = `/channelSupport/${channel}`;

    if (support.support === "native" && support.rendererId === undefined) {
      diagnostics.push(
        makeDiagnostic(
          "missingNativeRenderer",
          pointer,
          `Native ${channel} support must declare rendererId so the host can bind the implementation`
        )
      );
    }

    if (support.support === "fallback" && support.fallbackKind === undefined) {
      diagnostics.push(
        makeDiagnostic(
          "missingFallbackKind",
          pointer,
          `Fallback ${channel} support must declare fallbackKind so unsupported renderers degrade safely`
        )
      );
    }
  }

  if (contribution.review.status !== "approved") {
    diagnostics.push(
      makeDiagnostic(
        "componentContributionNotApproved",
        "/review/status",
        "Surface component contribution must be approved before it can be added to the agent output catalog"
      )
    );
  }

  return diagnostics;
}

function validateAgentTurnEventLogEntrySemantics(entry: CubicaAgentTurnEventLogEntry): CubicaContractDiagnostic[] {
  const diagnostics: CubicaContractDiagnostic[] = [];

  if (entry.status === "accepted" && entry.rejectionReason !== undefined) {
    diagnostics.push(
      makeDiagnostic(
        "acceptedTurnHasRejectionReason",
        "/rejectionReason",
        "Accepted Agent Turn event log entries must not include a rejection reason"
      )
    );
  }

  if (entry.status === "accepted" && entry.rejectedDiagnostics !== undefined) {
    diagnostics.push(
      makeDiagnostic(
        "acceptedTurnHasRejectedDiagnostics",
        "/rejectedDiagnostics",
        "Accepted Agent Turn event log entries must not include rejected diagnostics"
      )
    );
  }

  if (entry.status === "rejected" && entry.rejectionReason === undefined && (entry.rejectedDiagnostics?.length ?? 0) === 0) {
    diagnostics.push(
      makeDiagnostic(
        "rejectedTurnMissingReason",
        "/rejectionReason",
        "Rejected Agent Turn event log entries must include a rejection reason or rejected diagnostics"
      )
    );
  }

  if (entry.status === "rejected" && entry.effectCount !== 0) {
    diagnostics.push(
      makeDiagnostic(
        "rejectedTurnHasEffects",
        "/effectCount",
        "Rejected Agent Turn event log entries must not record accepted effects"
      )
    );
  }

  return diagnostics;
}

function mapAjvErrors(errors: ErrorObject[] | null | undefined): CubicaContractDiagnostic[] {
  return (errors ?? []).map((error) =>
    makeDiagnostic(
      `schema.${error.keyword}`,
      error.instancePath || "/",
      error.message === undefined ? "JSON Schema validation failed" : error.message,
      "schema"
    )
  );
}

function makeDiagnostic(
  code: string,
  pointer: string,
  message: string,
  source: CubicaContractDiagnosticSource = "semantic"
): CubicaContractDiagnostic {
  return {
    severity: "error",
    source,
    code,
    pointer,
    message
  };
}

function toCatalogMap(catalog: CubicaSurfaceCatalog): ReadonlyMap<string, CubicaSurfaceCatalogComponent> {
  return new Map(catalog.map((component) => [component.kind, component]));
}

function getCatalogSupport(
  componentKind: string,
  channel: CubicaSurfaceChannel,
  catalog: CubicaSurfaceCatalog = defaultCubicaSurfaceCatalog
): CubicaSurfaceChannelSupport | undefined {
  return toCatalogMap(catalog).get(componentKind)?.channelSupport[channel];
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}/`);
}

function componentToTelegramText(component: CubicaSurfaceComponent): string | undefined {
  switch (component.kind) {
    case "cubica.text":
      return stringProp(component.props, "text") ?? stringProp(component.props, "body") ?? stringProp(component.props, "label");
    case "cubica.button":
      return stringProp(component.props, "label") ?? component.actions?.[0]?.label;
    case "cubica.choiceList":
      return [stringProp(component.props, "label") ?? "Выберите действие", ...choiceLabels(component.props)]
        .filter((line) => line.length > 0)
        .join("\n");
    case "cubica.metricsBar":
      return metricsSummary(component.props);
    case "cubica.hintPanel":
      return stringProp(component.props, "text") ?? stringProp(component.props, "hint") ?? stringProp(component.props, "body");
    case "cubica.cardGrid":
      return cardGridSummary(component.props);
    case "cubica.diagnosticList":
      return listProp(component.props, "items").join("\n");
    case "cubica.diffSummary":
      return listProp(component.props, "entries").join("\n");
    case "cubica.approvalCard":
      return stringProp(component.props, "summary") ?? stringProp(component.props, "title");
    default:
      return undefined;
  }
}

function componentToPhaserElements(component: CubicaSurfaceComponent): CubicaPhaserSurfaceElement[] {
  switch (component.kind) {
    case "cubica.text":
      return [
        {
          id: component.id,
          componentKind: component.kind,
          kind: "text",
          text: stringProp(component.props, "text") ?? stringProp(component.props, "body") ?? stringProp(component.props, "label")
        }
      ];
    case "cubica.button":
      return [
        {
          id: component.id,
          componentKind: component.kind,
          kind: "button",
          label: stringProp(component.props, "label") ?? component.actions?.[0]?.label
        }
      ];
    case "cubica.choiceList":
      return choiceLabels(component.props).map((label, index) => ({
        id: `${component.id}:choice:${index}`,
        componentKind: component.kind,
        kind: "choice" as const,
        label
      }));
    case "cubica.metricsBar":
      return [
        {
          id: component.id,
          componentKind: component.kind,
          kind: "metrics",
          text: metricsSummary(component.props),
          props: component.props
        }
      ];
    case "cubica.cardGrid":
      return cardLabels(component.props).map((label, index) => ({
        id: `${component.id}:card:${index}`,
        componentKind: component.kind,
        kind: "card" as const,
        label
      }));
    case "cubica.hintPanel":
      return [
        {
          id: component.id,
          componentKind: component.kind,
          kind: "hint",
          text: stringProp(component.props, "text") ?? stringProp(component.props, "hint") ?? stringProp(component.props, "body")
        }
      ];
    default:
      return [
        {
          id: `${component.id}:fallback`,
          componentKind: component.kind,
          kind: "diagnostic",
          text: `Компонент ${component.kind} будет показан через безопасную диагностику.`
        }
      ];
  }
}

function stringProp(props: Record<string, CubicaJsonValue>, key: string): string | undefined {
  const value = props[key];
  return typeof value === "string" ? value : undefined;
}

function listProp(props: Record<string, CubicaJsonValue>, key: string): string[] {
  const value = props[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (item !== null && typeof item === "object") {
        return stringProp(item as Record<string, CubicaJsonValue>, "label") ?? stringProp(item as Record<string, CubicaJsonValue>, "text");
      }

      return undefined;
    })
    .filter((item): item is string => item !== undefined);
}

function choiceLabels(props: Record<string, CubicaJsonValue>): string[] {
  return listProp(props, "choices");
}

function cardLabels(props: Record<string, CubicaJsonValue>): string[] {
  return listProp(props, "cards");
}

function cardGridSummary(props: Record<string, CubicaJsonValue>): string | undefined {
  const title = stringProp(props, "title");
  const cards = cardLabels(props);
  const body = cards.length === 0 ? undefined : cards.join("\n");

  return [title, body].filter((part): part is string => part !== undefined && part.length > 0).join("\n") || undefined;
}

function metricsSummary(props: Record<string, CubicaJsonValue>): string | undefined {
  const metrics = props.metrics;

  if (!Array.isArray(metrics)) {
    return undefined;
  }

  const lines = metrics
    .map((metric) => {
      if (metric === null || typeof metric !== "object") {
        return undefined;
      }

      const record = metric as Record<string, CubicaJsonValue>;
      const label = stringProp(record, "label") ?? stringProp(record, "id");
      const value = record.value;

      if (label === undefined) {
        return undefined;
      }

      return `${label}: ${formatJsonScalar(value)}`;
    })
    .filter((line): line is string => line !== undefined);

  return lines.length === 0 ? undefined : lines.join("\n");
}

function formatJsonScalar(value: CubicaJsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function walkSurfaceComponents(
  component: CubicaSurfaceComponent,
  pointer: string,
  visit: (component: CubicaSurfaceComponent, pointer: string) => void
): void {
  visit(component, pointer);

  for (const [index, child] of (component.children ?? []).entries()) {
    walkSurfaceComponents(child, `${pointer}/children/${index}`, visit);
  }
}

function collectForbiddenKeyDiagnostics(
  value: unknown,
  pointer: string,
  diagnostics: CubicaContractDiagnostic[]
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeyDiagnostics(item, `${pointer}/${index}`, diagnostics));
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPointer = `${pointer}/${escapeJsonPointerSegment(key)}`;
    if (forbiddenGeneratedUiKeys.has(key)) {
      diagnostics.push(makeDiagnostic("forbiddenGeneratedUiKey", childPointer, `Generated UI key is forbidden: ${key}`));
    }

    if (forbiddenDirectStateMutationKeys.has(key)) {
      diagnostics.push(makeDiagnostic("forbiddenDirectStateMutation", childPointer, `Direct state mutation key is forbidden: ${key}`));
    }

    collectForbiddenKeyDiagnostics(childValue, childPointer, diagnostics);
  }
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/gu, "~0").replace(/\//gu, "~1");
}
