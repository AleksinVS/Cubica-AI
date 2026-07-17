/**
 * Contract tests for Cubica-owned AI schemas.
 *
 * These tests validate the public contract helpers, not a concrete game or UI
 * framework. The goal is to keep generated UI and AI-driven turns portable
 * across Web, Telegram and Phaser renderers.
 */
import { describe, expect, it } from "vitest";
import {
  adaptA2uiLikeEventsToCubicaSurface,
  buildAcceptedAgentTurnEventLogEntry,
  buildCubicaAgentApprovalEnvelope,
  buildRejectedAgentTurnEventLogEntry,
  defaultCubicaSurfaceChannelActionPolicies,
  defaultCubicaSurfaceCatalog,
  projectSurfaceForPhaser,
  projectSurfaceForTelegram,
  surfaceContributionToCatalogComponent,
  validateAgentApprovalEnvelope,
  validateAgentEvaluationFixture,
  validateAgentReplayTranscript,
  validateAgentRuntimeOperationPolicy,
  validateAgentTurnEventLogEntry,
  validateAgentTurnInput,
  validateAgentTurnResult,
  validateCubicaSurface,
  validateExecutionModeConfig,
  validateA2uiLikeEvent,
  validateSurfaceChannelActionPolicy,
  validateSurfaceComponentContribution,
  type CubicaAgentTurnInput,
  type CubicaAgentTurnResult,
  type CubicaSurface,
  type CubicaSurfaceComponentContribution
} from "../src/index.ts";

const validSurface: CubicaSurface = {
  schemaVersion: "1.0.0",
  surfaceId: "surface-choice-1",
  catalogVersion: "2026-06-11",
  mode: "primary-gameplay",
  title: "Choose next step",
  dataModel: {
    metrics: {
      focus: 3,
      trust: 2
    }
  },
  root: {
    id: "root",
    kind: "cubica.choiceList",
    props: {
      label: "Next move",
      choices: [
        { id: "ask", label: "Ask the team" },
        { id: "decide", label: "Make a decision" }
      ]
    },
    actions: [
      {
        id: "choose-ask",
        kind: "agentTurn",
        label: "Ask",
        target: "agent.request-choice",
        payload: { choiceId: "ask" },
        sideEffectPolicy: "human-approved",
        requiresApproval: true
      }
    ]
  }
};

const validAgentTurnInput: CubicaAgentTurnInput = {
  schemaVersion: "1.0.0",
  turnId: "turn-1",
  sessionId: "session-1",
  gameId: "ai-driven-choice",
  playerId: "player-1",
  agentId: "scenario-agent",
  executionMode: "ai-driven",
  trigger: {
    kind: "playerAction",
    actionId: "choose",
    payload: { choiceId: "ask" }
  },
  stateScope: {
    public: {
      step: "intro"
    },
    actor: {
      handSize: 2
    }
  },
  manifestProjection: {
    title: "AI-driven choice"
  },
  availableIntents: [
    {
      actionId: "agent.choice.resolve",
      label: "Resolve agent choice",
      paramsSchema: {
        type: "object",
        additionalProperties: false
      }
    }
  ],
  surfaceCatalog: defaultCubicaSurfaceCatalog.map((component) => component.kind),
  correlationId: "correlation-1"
};

const validAgentTurnResult: CubicaAgentTurnResult = {
  schemaVersion: "1.0.0",
  turnId: "turn-1",
  agentId: "scenario-agent",
  ok: true,
  narration: "The team waits for your decision.",
  selectedIntent: {
    actionId: "agent.choice.resolve",
    params: {}
  },
  surface: validSurface,
  audit: {
    source: "mock",
    createdAt: "2026-06-11T00:00:00.000Z",
    runId: "run-1"
  }
};

describe("CubicaSurface validation", () => {
  it("accepts a channel-neutral primary gameplay surface from the default catalog", () => {
    const result = validateCubicaSurface(validSurface, { targetChannel: "web" });

    expect(result.ok).toBe(true);
    expect(result.value?.surfaceId).toBe("surface-choice-1");
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects unknown components", () => {
    const result = validateCubicaSurface({
      ...validSurface,
      root: {
        id: "root",
        kind: "unknown.experimentalWidget",
        props: {}
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unknownComponent",
        pointer: "/root"
      })
    );
  });

  it("rejects arbitrary generated HTML and unsafe mutating action policy", () => {
    const result = validateCubicaSurface({
      ...validSurface,
      root: {
        id: "root",
        kind: "cubica.button",
        props: {
          dangerouslySetInnerHTML: "<strong>unsafe</strong>"
        },
        actions: [
          {
            id: "mutate",
            kind: "runtimeAction",
            sideEffectPolicy: "read-only"
          }
        ]
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["forbiddenGeneratedUiKey", "mutatingActionMarkedReadOnly"])
    );
  });

  it("rejects helper-only components as primary gameplay UI", () => {
    const result = validateCubicaSurface({
      ...validSurface,
      root: {
        id: "root",
        kind: "cubica.diffSummary",
        props: {
          entries: ["Changed title"]
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "componentNotPrimaryGameplaySafe"
      })
    );
  });

  it("rejects editor and URL actions for Web player primary gameplay policy", () => {
    const result = validateCubicaSurface(
      {
        ...validSurface,
        root: {
          id: "root",
          kind: "cubica.button",
          props: {
            label: "Open editor tool"
          },
          actions: [
            {
              id: "edit",
              kind: "editorTool",
              label: "Edit",
              target: "editor.applyChangeSet",
              sideEffectPolicy: "human-approved",
              requiresApproval: true
            },
            {
              id: "external",
              kind: "openUrl",
              label: "External",
              target: "https://example.test",
              sideEffectPolicy: "system-approved"
            }
          ]
        }
      },
      {
        targetChannel: "web",
        channelActionPolicy: defaultCubicaSurfaceChannelActionPolicies.webPlayerPrimaryGameplay
      }
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["unsupportedChannelActionKind", "disallowedChannelActionKind"])
    );
  });
});

describe("CubicaSurface channel projections", () => {
  it("projects one validated Surface into Telegram messages and inline buttons", () => {
    const projection = projectSurfaceForTelegram(validSurface);

    expect(projection.channel).toBe("telegram");
    expect(projection.ok).toBe(true);
    expect(projection.actionsSuppressed).toBe(false);
    expect(projection.messages.map((message) => message.text).join("\n")).toContain("Ask the team");
    expect(projection.inlineKeyboard.flat().map((button) => button.label)).toContain("Ask");
    expect(projection.diagnostics).toEqual([]);
  });

  it("projects the same Surface into Phaser elements and interactive zones", () => {
    const projection = projectSurfaceForPhaser(validSurface);

    expect(projection.channel).toBe("phaser");
    expect(projection.ok).toBe(true);
    expect(projection.actionsSuppressed).toBe(false);
    expect(projection.elements).toContainEqual(
      expect.objectContaining({
        kind: "choice",
        label: "Ask the team"
      })
    );
    expect(projection.interactiveZones).toContainEqual(
      expect.objectContaining({
        id: "choose-ask",
        label: "Ask"
      })
    );
  });

  it("suppresses Telegram buttons when channel validation fails", () => {
    const projection = projectSurfaceForTelegram({
      ...validSurface,
      root: {
        id: "root",
        kind: "cubica.button",
        props: {
          label: "Run portal command"
        },
        actions: [
          {
            id: "portal",
            kind: "portalCommand",
            label: "Portal",
            target: "portal.publish",
            sideEffectPolicy: "system-approved"
          },
          {
            id: "continue",
            kind: "agentTurn",
            label: "Continue",
            target: "agent.next",
            sideEffectPolicy: "system-approved"
          }
        ]
      }
    });

    expect(projection.ok).toBe(false);
    expect(projection.actionsSuppressed).toBe(true);
    expect(projection.inlineKeyboard).toEqual([]);
    expect(projection.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupportedChannelActionKind"
      })
    );
  });

  it("suppresses Phaser interactive zones when channel validation fails", () => {
    const projection = projectSurfaceForPhaser({
      ...validSurface,
      root: {
        id: "root",
        kind: "cubica.button",
        props: {
          label: "Mixed actions"
        },
        actions: [
          {
            id: "continue",
            kind: "agentTurn",
            label: "Continue",
            target: "agent.next",
            sideEffectPolicy: "system-approved"
          },
          {
            id: "edit",
            kind: "editorTool",
            label: "Edit",
            target: "editor.applyChangeSet",
            sideEffectPolicy: "human-approved",
            requiresApproval: true
          }
        ]
      }
    });

    expect(projection.ok).toBe(false);
    expect(projection.actionsSuppressed).toBe(true);
    expect(projection.interactiveZones).toEqual([]);
    expect(projection.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupportedChannelActionKind"
      })
    );
  });

  it("degrades unsupported channel components into diagnostics instead of provider payloads", () => {
    const projection = projectSurfaceForPhaser({
      ...validSurface,
      mode: "helper",
      root: {
        id: "diagnostics",
        kind: "cubica.diagnosticList",
        props: {
          items: ["Renderer mismatch"]
        }
      }
    });

    expect(projection.elements).toContainEqual(
      expect.objectContaining({
        kind: "diagnostic",
        text: "Компонент cubica.diagnosticList не поддержан в Phaser."
      })
    );
    expect(projection.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupportedChannelComponent"
      })
    );
  });
});

describe("A2UI-like adapter contract", () => {
  it("maps a stream of external surface events into a validated CubicaSurface", () => {
    const result = adaptA2uiLikeEventsToCubicaSurface([
      {
        schemaVersion: "1.0.0",
        type: "surfaceUpdate",
        surface: validSurface
      },
      {
        schemaVersion: "1.0.0",
        type: "dataModelUpdate",
        dataModel: {
          transientNote: "adapter-only"
        }
      },
      {
        schemaVersion: "1.0.0",
        type: "beginRendering",
        surfaceId: validSurface.surfaceId
      }
    ]);

    expect(result.ok).toBe(true);
    expect(result.readyToRender).toBe(true);
    expect(result.surface?.dataModel).toMatchObject({
      transientNote: "adapter-only"
    });
  });

  it("rejects malformed external events before they reach domain code", () => {
    const result = validateA2uiLikeEvent({
      schemaVersion: "1.0.0",
      type: "surfaceUpdate",
      surface: {
        ...validSurface,
        root: {
          id: "unsafe",
          kind: "unknown.raw",
          props: {}
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unknownComponent"
      })
    );
  });
});

describe("Cubica approval and policy contracts", () => {
  it("validates a scoped human approval envelope", () => {
    const envelope = buildCubicaAgentApprovalEnvelope({
      approvalId: "approval-1",
      agentId: "editor-agent",
      toolName: "editor.applyChangeSet",
      approvedBy: "local-user",
      approvedAt: "2026-06-11T10:00:00.000Z",
      expiresAt: "2026-06-11T10:05:00.000Z",
      scopeHash: "change-set-1",
      status: "approved",
      actionId: "apply"
    });

    const result = validateAgentApprovalEnvelope(envelope, {
      nowIso: "2026-06-11T10:01:00.000Z",
      expectedToolName: "editor.applyChangeSet",
      expectedScopeHash: "change-set-1",
      requireApproved: true
    });

    expect(result.ok).toBe(true);
  });

  it("rejects stale or wrongly scoped approval envelopes", () => {
    const envelope = buildCubicaAgentApprovalEnvelope({
      approvalId: "approval-stale",
      agentId: "editor-agent",
      toolName: "editor.saveSession",
      approvedBy: "local-user",
      approvedAt: "2026-06-11T10:00:00.000Z",
      expiresAt: "2026-06-11T10:01:00.000Z",
      scopeHash: "old-scope",
      status: "approved"
    });

    const result = validateAgentApprovalEnvelope(envelope, {
      nowIso: "2026-06-11T10:02:00.000Z",
      expectedToolName: "editor.applyChangeSet",
      expectedScopeHash: "new-scope",
      requireApproved: true
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["approvalEnvelopeExpired", "approvalToolMismatch", "approvalScopeMismatch"])
    );
  });

  it("validates the default channel action policy", () => {
    expect(validateSurfaceChannelActionPolicy(defaultCubicaSurfaceChannelActionPolicies.webPlayerPrimaryGameplay).ok).toBe(true);
  });

  it("rejects contradictory channel action policies", () => {
    const result = validateSurfaceChannelActionPolicy({
      schemaVersion: "1.0.0",
      policyId: "contradictory",
      channel: "web",
      allowedActionKinds: ["agentTurn"],
      disallowedActionKinds: ["agentTurn"]
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "channelPolicyContradiction"
      })
    );
  });
});

describe("Agent Turn validation", () => {
  it("accepts a valid AI-driven turn input", () => {
    const result = validateAgentTurnInput(validAgentTurnInput);

    expect(result.ok).toBe(true);
    expect(result.value?.turnId).toBe("turn-1");
  });

  it("accepts a distinct actor-scoped channel without enabling secret state", () => {
    const result = validateAgentTurnInput({
      ...validAgentTurnInput,
      stateScope: {
        public: { round: 4 },
        actor: { hand: ["visible-to-this-actor"] }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.value?.stateScope.actor).toEqual({ hand: ["visible-to-this-actor"] });
    expect(result.value?.stateScope.secret).toBeUndefined();
  });

  it("rejects duplicate published intents in one actor-scoped input", () => {
    const intent = validAgentTurnInput.availableIntents[0]!;
    const result = validateAgentTurnInput({
      ...validAgentTurnInput,
      availableIntents: [intent, intent]
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "duplicateAvailableIntent" })
    );
  });

  it("rejects reserved object property names as player ids", () => {
    for (const playerId of ["__proto__", "constructor", "prototype"]) {
      const result = validateAgentTurnInput({ ...validAgentTurnInput, playerId });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: "schema.not" })
      );
    }
  });

  it("rejects deterministic mode for Agent Turn input", () => {
    const result = validateAgentTurnInput({
      ...validAgentTurnInput,
      executionMode: "deterministic"
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "schema.enum"
      })
    );
  });

  it("accepts a valid Agent Turn result with a CubicaSurface", () => {
    const result = validateAgentTurnResult(validAgentTurnResult);

    expect(result.ok).toBe(true);
    expect(result.value?.surface?.surfaceId).toBe(validSurface.surfaceId);
  });

  it("rejects legacy direct effects because an agent may only select an intent", () => {
    const result = validateAgentTurnResult({
      ...validAgentTurnResult,
      effects: [{ kind: "setFlag", target: "secret.answer", value: true }]
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("schema.additionalProperties");
  });

  it("rejects a failed Agent Turn that tries to carry a selected intent or Surface", () => {
    const result = validateAgentTurnResult({
      ...validAgentTurnResult,
      ok: false,
      error: {
        code: "provider_failed",
        message: "Provider failed"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["rejectedTurnHasSelectedIntent", "rejectedTurnHasSurface"])
    );
  });

  it("accepts only an intent published for the current actor and snapshot", () => {
    const accepted = validateAgentTurnResult(validAgentTurnResult, {
      availableIntents: validAgentTurnInput.availableIntents
    });
    const rejected = validateAgentTurnResult({
      ...validAgentTurnResult,
      selectedIntent: { actionId: "agent.invented", params: {} }
    }, {
      availableIntents: validAgentTurnInput.availableIntents
    });

    expect(accepted.ok).toBe(true);
    expect(rejected.diagnostics).toContainEqual(
      expect.objectContaining({ code: "selectedIntentNotAvailable" })
    );
  });

  it("binds Surface actions to the exact trusted Agent Turn entry and available intents", () => {
    const surface = {
      ...validSurface,
      root: {
        ...validSurface.root,
        actions: [
          {
            id: "wrong-agent-entry",
            kind: "agentTurn" as const,
            label: "Ask again",
            target: "agent.invented-entry",
            payload: {},
            sideEffectPolicy: "system-approved" as const
          },
          {
            id: "wrong-runtime-intent",
            kind: "runtimeAction" as const,
            label: "Run invented action",
            target: "agent.invented-intent",
            payload: {},
            sideEffectPolicy: "system-approved" as const
          }
        ]
      }
    };
    const result = validateAgentTurnResult({ ...validAgentTurnResult, surface }, {
      availableIntents: validAgentTurnInput.availableIntents,
      agentTurnEntryActionId: "agent.request-choice"
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["agentTurnTargetMismatch", "surfaceIntentNotAvailable"])
    );
  });
});

describe("Surface component contribution validation", () => {
  const validContribution: CubicaSurfaceComponentContribution = {
    schemaVersion: "1.0.0",
    ownerPluginId: "antarctica-player",
    kind: "antarctica.decisionCard",
    version: "1.0.0",
    description: "Scenario-specific decision card contributed by a game plugin.",
    safeForPrimaryGameplay: true,
    propsSchema: {
      type: "object",
      properties: {
        title: { type: "string" }
      }
    },
    allowedActionKinds: ["agentTurn", "runtimeAction"],
    channelSupport: {
      web: {
        support: "native",
        rendererId: "antarctica-player/DecisionCard"
      },
      telegram: {
        support: "fallback",
        fallbackKind: "cubica.choiceList"
      },
      phaser: {
        support: "fallback",
        fallbackKind: "cubica.cardGrid"
      }
    },
    review: {
      status: "approved",
      reviewedBy: "platform",
      reviewedAt: "2026-06-11T00:00:00.000Z"
    }
  };

  it("promotes an approved plugin contribution into catalog metadata", () => {
    const validation = validateSurfaceComponentContribution(validContribution);
    const catalogComponent = surfaceContributionToCatalogComponent(validContribution);

    expect(validation.ok).toBe(true);
    expect(catalogComponent.ok).toBe(true);
    expect(catalogComponent.value).toEqual(
      expect.objectContaining({
        kind: "antarctica.decisionCard",
        channelSupport: {
          web: "native",
          telegram: "fallback",
          phaser: "fallback"
        }
      })
    );
  });

  it("rejects unreviewed or underspecified plugin components before agent output", () => {
    const result = validateSurfaceComponentContribution({
      ...validContribution,
      kind: "cubica.unsafeOverride",
      channelSupport: {
        ...validContribution.channelSupport,
        telegram: {
          support: "fallback"
        }
      },
      review: {
        status: "draft"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["reservedCubicaNamespace", "missingFallbackKind", "componentContributionNotApproved"])
    );
  });
});

describe("Agent Turn replay, evaluation and audit contracts", () => {
  it("builds and validates accepted and rejected event log entries", () => {
    const accepted = buildAcceptedAgentTurnEventLogEntry({
      eventId: "event-accepted-1",
      input: validAgentTurnInput,
      result: validAgentTurnResult,
      recordedAt: "2026-06-11T00:00:01.000Z"
    });
    const rejected = buildRejectedAgentTurnEventLogEntry({
      eventId: "event-rejected-1",
      input: validAgentTurnInput,
      recordedAt: "2026-06-11T00:00:02.000Z",
      reason: {
        code: "schema.enum",
        message: "Agent returned an unsupported component"
      },
      diagnostics: [
        {
          severity: "error",
          source: "semantic",
          code: "unknownComponent",
          pointer: "/surface/root",
          message: "Surface component is not in catalog"
        }
      ],
      audit: validAgentTurnResult.audit
    });

    expect(validateAgentTurnEventLogEntry(accepted).ok).toBe(true);
    expect(validateAgentTurnEventLogEntry(rejected).ok).toBe(true);
    expect(rejected.status).toBe("rejected");
    expect(rejected.selectedActionId).toBeUndefined();
  });

  it("validates replay transcripts with explicit redaction policy", () => {
    const accepted = buildAcceptedAgentTurnEventLogEntry({
      eventId: "event-accepted-1",
      input: validAgentTurnInput,
      result: validAgentTurnResult,
      recordedAt: "2026-06-11T00:00:01.000Z"
    });

    const result = validateAgentReplayTranscript({
      schemaVersion: "1.0.0",
      transcriptId: "transcript-1",
      gameId: "ai-driven-choice",
      sessionId: "session-1",
      createdAt: "2026-06-11T00:01:00.000Z",
      entries: [accepted],
      redaction: {
        secretStateIncluded: false,
        policy: "public-state-only",
        redactedPaths: ["/stateScope/secret"]
      }
    });

    expect(result.ok).toBe(true);
  });

  it("validates evaluation fixtures for production AI-driven gates", () => {
    const result = validateAgentEvaluationFixture({
      schemaVersion: "1.0.0",
      fixtureId: "eval-ai-choice-1",
      gameId: "ai-driven-choice",
      title: "The agent keeps output inside the gameplay catalog",
      input: validAgentTurnInput,
      expected: {
        ok: true,
        allowedSurfaceKinds: ["cubica.choiceList", "cubica.text"],
        requiredActionId: "agent.choice.resolve",
        forbiddenDiagnosticCodes: ["unknownComponent", "forbiddenDirectStateMutation"],
        maxErrorSeverity: "error"
      },
      audit: {
        createdAt: "2026-06-11T00:02:00.000Z",
        owner: "platform"
      }
    });

    expect(result.ok).toBe(true);
  });

  it("rejects replay transcripts that include secret state", () => {
    const result = validateAgentReplayTranscript({
      schemaVersion: "1.0.0",
      transcriptId: "transcript-secret",
      gameId: "ai-driven-choice",
      sessionId: "session-1",
      createdAt: "2026-06-11T00:01:00.000Z",
      entries: [],
      redaction: {
        secretStateIncluded: true,
        policy: "unsafe"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "schema.const"
      })
    );
  });
});

describe("Agent Runtime production operation policy", () => {
  it("validates idempotency, timeout, retry, rate limit and cost controls", () => {
    const result = validateAgentRuntimeOperationPolicy({
      schemaVersion: "1.0.0",
      policyId: "production-agent-runtime-default",
      idempotency: {
        keySource: "turnId",
        duplicateBehavior: "returnPrevious",
        ttlSeconds: 3600
      },
      timeout: {
        turnTimeoutMs: 15000,
        providerTimeoutMs: 12000
      },
      retry: {
        maxAttempts: 2,
        backoffMs: 250,
        retryableErrorCodes: ["timeout", "rate_limited"]
      },
      rateLimit: {
        perSessionTurnsPerMinute: 12,
        perAgentTurnsPerMinute: 120
      },
      costControl: {
        maxInputTokensPerTurn: 6000,
        maxOutputTokensPerTurn: 1200,
        maxCostUsdPerSession: 1.5
      }
    });

    expect(result.ok).toBe(true);
  });

  it("rejects production policies without bounded attempts or timeouts", () => {
    const result = validateAgentRuntimeOperationPolicy({
      schemaVersion: "1.0.0",
      policyId: "unsafe",
      idempotency: {
        keySource: "turnId",
        duplicateBehavior: "returnPrevious",
        ttlSeconds: 0
      },
      timeout: {
        turnTimeoutMs: 0,
        providerTimeoutMs: 0
      },
      retry: {
        maxAttempts: 20,
        backoffMs: 0,
        retryableErrorCodes: []
      },
      rateLimit: {
        perSessionTurnsPerMinute: 0,
        perAgentTurnsPerMinute: 0
      },
      costControl: {}
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["schema.minimum", "schema.maximum"])
    );
  });
});

describe("Execution mode validation", () => {
  it("accepts deterministic config without Agent Runtime", () => {
    const result = validateExecutionModeConfig({ executionMode: "deterministic" });

    expect(result.ok).toBe(true);
  });

  it("requires Agent Runtime configuration for AI-driven games", () => {
    const result = validateExecutionModeConfig({ executionMode: "ai-driven" });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "schema.required"
      })
    );
  });

  it("requires AI-driven configuration to allow published Game Intent selection", () => {
    const result = validateExecutionModeConfig({
      executionMode: "ai-driven",
      agentRuntime: {
        agentId: "scenario-agent",
        initialActionId: "agent.request-choice",
        required: true,
        allowedCapabilities: ["legacyDirectEffect"],
        surfaceCatalog: ["cubica.choiceList"],
        failurePolicy: "pause"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "publishedIntentSelectionNotAllowed" })
    );
  });

  it("rejects deterministic games that require Agent Runtime", () => {
    const result = validateExecutionModeConfig({
      executionMode: "deterministic",
      agentRuntime: {
        agentId: "scenario-agent",
        initialActionId: "agent.request-choice",
        required: true,
        allowedCapabilities: ["selectPublishedIntent"],
        surfaceCatalog: ["cubica.choiceList"],
        failurePolicy: "pause"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "deterministicRequiresAgentRuntime"
      })
    );
  });
});
