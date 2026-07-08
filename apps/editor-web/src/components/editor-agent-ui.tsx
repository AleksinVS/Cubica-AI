"use client";

/**
 * CopilotKit integration for the editor assistant.
 *
 * This component is intentionally thin: it registers assistant context and
 * frontend tools, but it does not own authoring state. The workspace passes
 * existing Cubica functions for planning, dry-run, apply, undo, preview and
 * save so the assistant cannot bypass editor-engine validation.
 */
import {
  buildCubicaAgentApprovalEnvelope,
  type CubicaAgentApprovalEnvelope,
  type CubicaAgentToolResult,
  type CubicaJsonValue,
  type CubicaSurface,
  type CubicaSurfaceAction
} from "@cubica/contracts-ai";
import { CopilotChat, CopilotKit, useAgentContext, useFrontendTool, useHumanInTheLoop, type JsonSerializable } from "@copilotkit/react-core/v2";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";

import { editorRu as t } from "@/lib/locale";
import { EditorCubicaSurfaceRenderer } from "@/components/editor-cubica-surface";
import { EDITOR_AUTHORING_ASSISTANT_ID } from "@/lib/agent-assistant-registry";
import type { EditorAgentContextProjection } from "@/lib/agent-context-projection";
import { getEditorAgentToolDefinition, editorAgentToolNames, type EditorAssistantToolName } from "@/lib/editor-agent-tool-catalog";

export interface EditorAgentToolResult extends Omit<CubicaAgentToolResult<EditorAgentToolData>, "toolName" | "data"> {
  readonly ok: boolean;
  readonly summary: string;
  readonly diagnostics?: readonly { readonly severity: string; readonly source: string; readonly pointer: string; readonly message: string }[];
  readonly diffSummary?: readonly string[];
  readonly changeSetId?: string;
  readonly data?: EditorAgentToolData;
}

interface EditorAgentToolData {
  readonly changeSetId?: string;
  readonly prototypeProposal?: {
    readonly id: string;
    readonly definitionType: string;
    readonly definitionPointer: string;
    readonly sourcePointers: readonly string[];
    readonly gates: readonly { readonly id: string; readonly label: string; readonly ok: boolean }[];
    readonly expectedRuntimeDiff: string;
  };
}

export interface EditorAgentTools {
  readonly planChangeSet: (input: { readonly prompt?: string }) => Promise<EditorAgentToolResult>;
  readonly proposePrototypeExtraction: (input: {
    readonly prompt?: string;
    readonly sourcePointers?: readonly string[];
    readonly definitionType?: string;
    readonly definitionSemantics?: string;
  }) => Promise<EditorAgentToolResult>;
  readonly preparePrototypeChangeSet: () => Promise<EditorAgentToolResult>;
  readonly dryRunChangeSet: (input: { readonly prompt?: string }) => Promise<EditorAgentToolResult>;
  readonly applyChangeSet: (input: { readonly prompt?: string; readonly approval?: CubicaAgentApprovalEnvelope }) => Promise<EditorAgentToolResult>;
  readonly undoLastPatch: (input?: { readonly approval?: CubicaAgentApprovalEnvelope }) => Promise<EditorAgentToolResult>;
  readonly preparePreview: () => Promise<EditorAgentToolResult>;
  readonly saveSession: (input: { readonly approval?: CubicaAgentApprovalEnvelope }) => Promise<EditorAgentToolResult>;
}

type EditorAgentConnectionStatus = "disabled" | "checking" | "ready" | "runtime-disabled" | "backend-missing" | "error";

export interface EditorAgentConnectionState {
  readonly uiEnabled: boolean;
  readonly runtimeEnabled: boolean;
  readonly agUiBackendConfigured: boolean;
  readonly copilotReady: boolean;
  readonly status: EditorAgentConnectionStatus;
  readonly message: string;
}

const disabledConnectionState: EditorAgentConnectionState = {
  uiEnabled: false,
  runtimeEnabled: false,
  agUiBackendConfigured: false,
  copilotReady: false,
  status: "disabled",
  message: t.agentChat.msgDisabled
};

const checkingConnectionState: EditorAgentConnectionState = {
  uiEnabled: true,
  runtimeEnabled: false,
  agUiBackendConfigured: false,
  copilotReady: false,
  status: "checking",
  message: t.agentChat.msgChecking
};

const EditorAgentConnectionContext = createContext<EditorAgentConnectionState>(disabledConnectionState);
const EDITOR_APPROVAL_TTL_MS = 5 * 60 * 1000;
const mutatingEditorToolNames = ["editor.applyChangeSet", "editor.undoLastPatch", "editor.saveSession"] as const;

export function isEditorAgentUiEnabled(): boolean {
  const value = process.env.NEXT_PUBLIC_CUBICA_EDITOR_AGENT_UI;
  return value === "1" || value === "true";
}

export function useEditorAgentConnection(): EditorAgentConnectionState {
  return useContext(EditorAgentConnectionContext);
}

export function EditorAgentProvider({ children }: { readonly children: ReactNode }) {
  if (!isEditorAgentUiEnabled()) {
    return <EditorAgentConnectionContext.Provider value={disabledConnectionState}>{children}</EditorAgentConnectionContext.Provider>;
  }

  return <EditorAgentEnabledProvider>{children}</EditorAgentEnabledProvider>;
}

function EditorAgentEnabledProvider({ children }: { readonly children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<EditorAgentConnectionState>(checkingConnectionState);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRuntimeState() {
      try {
        const response = await fetch("/api/copilotkit", {
          credentials: "same-origin",
          signal: controller.signal
        });
        if (!response.ok) {
          setConnectionState({
            uiEnabled: true,
            runtimeEnabled: false,
            agUiBackendConfigured: false,
            copilotReady: false,
            status: "runtime-disabled",
            message: t.agentChat.msgHttp(response.status)
          });
          return;
        }

        const body = (await response.json()) as Partial<{
          readonly ok: boolean;
          readonly agUiBackendConfigured: boolean;
        }>;
        const runtimeEnabled = body.ok === true;
        const agUiBackendConfigured = body.agUiBackendConfigured === true;
        setConnectionState({
          uiEnabled: true,
          runtimeEnabled,
          agUiBackendConfigured,
          copilotReady: runtimeEnabled && agUiBackendConfigured,
          status: runtimeEnabled ? (agUiBackendConfigured ? "ready" : "backend-missing") : "runtime-disabled",
          message: runtimeEnabled
            ? agUiBackendConfigured
              ? t.agentChat.msgReady
              : t.agentChat.msgBackendMissing
            : t.agentChat.msgRuntimeDisabled
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setConnectionState({
          uiEnabled: true,
          runtimeEnabled: false,
          agUiBackendConfigured: false,
          copilotReady: false,
          status: "error",
          message: error instanceof Error ? error.message : t.agentChat.msgStatusFailed
        });
      }
    }

    void loadRuntimeState();

    return () => controller.abort();
  }, []);

  const contextValue = useMemo(() => connectionState, [connectionState]);
  const childrenWithContext = (
    <EditorAgentConnectionContext.Provider value={contextValue}>{children}</EditorAgentConnectionContext.Provider>
  );

  if (!connectionState.copilotReady) {
    return childrenWithContext;
  }

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent={EDITOR_AUTHORING_ASSISTANT_ID}
      credentials="same-origin"
      showDevConsole={false}
      enableInspector={false}
      properties={{
        agentId: EDITOR_AUTHORING_ASSISTANT_ID,
        ownerApp: "apps/editor-web"
      }}
      onError={({ error }) => {
        console.error("[cubica-editor-agent]", error.message);
      }}
    >
      {childrenWithContext}
    </CopilotKit>
  );
}

export function EditorAgentRuntimeHooks({
  enabled,
  context,
  tools
}: {
  readonly enabled: boolean;
  readonly context: EditorAgentContextProjection;
  readonly tools: EditorAgentTools;
}) {
  if (!enabled) {
    return null;
  }

  return <EditorAgentRuntimeHooksInner context={context} tools={tools} />;
}

export function EditorCopilotChatPanel({
  enabled,
  onCollapse,
  connection,
  fallback,
  surface,
  tools
}: {
  readonly enabled: boolean;
  readonly onCollapse: () => void;
  readonly connection: EditorAgentConnectionState;
  readonly fallback: ReactNode;
  readonly surface?: CubicaSurface | null;
  readonly tools: EditorAgentTools;
}) {
  if (!enabled) {
    if (connection.uiEnabled) {
      return <EditorAgentUnavailablePanel connection={connection} onCollapse={onCollapse} />;
    }

    return <>{fallback}</>;
  }

  return (
    <>
      <div className="panel-heading">
        <strong>{t.agentChat.title}</strong>
        <button type="button" onClick={onCollapse}>
          {t.common.collapse}
        </button>
      </div>
      <div className="agent-copilot-panel">
        {surface !== undefined && surface !== null ? (
          <EditorCubicaSurfaceRenderer surface={surface} onAction={(action) => handleEditorSurfaceAction(action, tools)} />
        ) : null}
        <CopilotChat
          agentId={EDITOR_AUTHORING_ASSISTANT_ID}
          labels={{
            modalHeaderTitle: t.agentChat.modalHeaderTitle,
            welcomeMessageText: t.agentChat.welcome,
            chatInputPlaceholder: t.agentChat.inputPlaceholder
          }}
          throttleMs={150}
        />
      </div>
    </>
  );
}

function EditorAgentUnavailablePanel({
  connection,
  onCollapse
}: {
  readonly connection: EditorAgentConnectionState;
  readonly onCollapse: () => void;
}) {
  return (
    <>
      <div className="panel-heading">
        <strong>{t.agentChat.title}</strong>
        <button type="button" onClick={onCollapse}>
          {t.common.collapse}
        </button>
      </div>
      <div className="agent-copilot-panel agent-copilot-panel-unavailable">
        <section>
          <span>{t.agentChat.connection}</span>
          <strong>{connectionStatusLabel(connection.status)}</strong>
          <p>{connection.message}</p>
          {connection.status === "backend-missing" ? (
            <p>{t.agentChat.backendHint}</p>
          ) : null}
        </section>
      </div>
    </>
  );
}

function connectionStatusLabel(status: EditorAgentConnectionStatus): string {
  switch (status) {
    case "checking":
      return t.agentChat.statusChecking;
    case "ready":
      return t.agentChat.statusReady;
    case "runtime-disabled":
      return t.agentChat.statusRuntimeDisabled;
    case "backend-missing":
      return t.agentChat.statusBackendMissing;
    case "error":
      return t.agentChat.statusError;
    case "disabled":
      return t.agentChat.statusDisabled;
  }
}

function handleEditorSurfaceAction(action: CubicaSurfaceAction, tools: EditorAgentTools): void {
  if (action.kind === "noop") {
    return;
  }

  if (action.kind !== "editorTool" || !isEditorAssistantToolName(action.target)) {
    return;
  }

  const prompt = payloadPrompt(action.payload);
  const approval =
    action.sideEffectPolicy === "human-approved" && action.requiresApproval === true
      ? buildSurfaceApprovalEnvelope(action)
      : undefined;

  switch (action.target) {
    case "editor.planChangeSet":
      void tools.planChangeSet({ prompt });
      return;
    case "editor.proposePrototypeExtraction":
      void tools.proposePrototypeExtraction({ prompt });
      return;
    case "editor.preparePrototypeChangeSet":
      void tools.preparePrototypeChangeSet();
      return;
    case "editor.dryRunChangeSet":
      void tools.dryRunChangeSet({ prompt });
      return;
    case "editor.applyChangeSet":
      void tools.applyChangeSet({ prompt, approval });
      return;
    case "editor.undoLastPatch":
      void tools.undoLastPatch({ approval });
      return;
    case "editor.preparePreview":
      void tools.preparePreview();
      return;
    case "editor.saveSession":
      void tools.saveSession({ approval });
      return;
  }
}

function isEditorAssistantToolName(value: string | undefined): value is EditorAssistantToolName {
  return value !== undefined && editorAgentToolNames.includes(value as EditorAssistantToolName);
}

function payloadPrompt(payload: CubicaJsonValue | undefined): string | undefined {
  if (payload === undefined || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as { readonly [key: string]: CubicaJsonValue };
  const prompt = record.prompt;
  return typeof prompt === "string" && prompt.trim() !== "" ? prompt : undefined;
}

const promptParameters = z.object({
  prompt: z.string().trim().min(1).max(800).optional().describe("Optional editor request. If omitted, the current preview prompt draft is used.")
});

const prototypeExtractionParameters = z.object({
  prompt: z.string().trim().min(1).max(800).optional().describe("Optional explanation for the prototype proposal."),
  sourcePointers: z.array(z.string().trim().min(1).max(400)).min(2).max(24).optional().describe("Optional authoring JSON Pointers to extract. If omitted, the editor searches for the best local candidate."),
  definitionType: z.string().trim().min(3).max(160).optional().describe("Optional local prototype type, for example ui.LocalScreenShell."),
  definitionSemantics: z.string().trim().min(3).max(1000).optional().describe("Optional _semantics text for the local prototype.")
});

const mutatingToolParameters = z.object({
  prompt: z.string().trim().min(1).max(800).optional().describe("Optional editor request. If omitted, the latest planned ChangeSet is used."),
  approvalId: z.string().trim().min(1).max(160).optional().describe("Approval id returned by editor.requestHumanApproval.")
});

const approvalRequestParameters = z.object({
  toolName: z.enum(mutatingEditorToolNames).describe("Mutating editor tool that needs approval."),
  scopeHash: z.string().trim().min(1).max(240).describe("Exact Cubica operation scope to approve."),
  summary: z.string().trim().min(1).max(1000).optional().describe("Short human-readable operation summary.")
});

function EditorAgentRuntimeHooksInner({
  context,
  tools
}: {
  readonly context: EditorAgentContextProjection;
  readonly tools: EditorAgentTools;
}) {
  const approvalsRef = useRef(new Map<string, CubicaAgentApprovalEnvelope>());

  useAgentContext({
    description: "Scoped Cubica editor context: active file identifiers, selected authoring pointers, diagnostics and preview trace summary.",
    value: toJsonSerializable(context)
  });

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.planChangeSet").name,
      description: getEditorAgentToolDefinition("editor.planChangeSet").description,
      parameters: promptParameters,
      handler: async ({ prompt }) => toCubicaToolResult("editor.planChangeSet", await tools.planChangeSet({ prompt }))
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.proposePrototypeExtraction").name,
      description: getEditorAgentToolDefinition("editor.proposePrototypeExtraction").description,
      parameters: prototypeExtractionParameters,
      handler: async ({ prompt, sourcePointers, definitionType, definitionSemantics }) =>
        toCubicaToolResult("editor.proposePrototypeExtraction", await tools.proposePrototypeExtraction({ prompt, sourcePointers, definitionType, definitionSemantics }))
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.preparePrototypeChangeSet").name,
      description: getEditorAgentToolDefinition("editor.preparePrototypeChangeSet").description,
      parameters: z.object({}),
      handler: async () => toCubicaToolResult("editor.preparePrototypeChangeSet", await tools.preparePrototypeChangeSet())
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.dryRunChangeSet").name,
      description: getEditorAgentToolDefinition("editor.dryRunChangeSet").description,
      parameters: promptParameters,
      handler: async ({ prompt }) => toCubicaToolResult("editor.dryRunChangeSet", await tools.dryRunChangeSet({ prompt }))
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.applyChangeSet").name,
      description: getEditorAgentToolDefinition("editor.applyChangeSet").description,
      parameters: mutatingToolParameters,
      handler: async ({ prompt, approvalId }) =>
        toCubicaToolResult("editor.applyChangeSet", await tools.applyChangeSet({ prompt, approval: lookupApproval(approvalsRef.current, approvalId) }))
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.undoLastPatch").name,
      description: getEditorAgentToolDefinition("editor.undoLastPatch").description,
      parameters: z.object({
        approvalId: z.string().trim().min(1).max(160).optional().describe("Approval id returned by editor.requestHumanApproval.")
      }),
      handler: async ({ approvalId }) =>
        toCubicaToolResult("editor.undoLastPatch", await tools.undoLastPatch({ approval: lookupApproval(approvalsRef.current, approvalId) }))
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.preparePreview").name,
      description: getEditorAgentToolDefinition("editor.preparePreview").description,
      parameters: z.object({}),
      handler: async () => toCubicaToolResult("editor.preparePreview", await tools.preparePreview())
    },
    [tools]
  );

  useFrontendTool(
    {
      name: getEditorAgentToolDefinition("editor.saveSession").name,
      description: getEditorAgentToolDefinition("editor.saveSession").description,
      parameters: z.object({
        approvalId: z.string().trim().min(1).max(160).optional().describe("Approval id returned by editor.requestHumanApproval.")
      }),
      handler: async ({ approvalId }) =>
        toCubicaToolResult("editor.saveSession", await tools.saveSession({ approval: lookupApproval(approvalsRef.current, approvalId) }))
    },
    [tools]
  );

  useHumanInTheLoop(
    {
      name: getEditorAgentToolDefinition("editor.requestHumanApproval").name,
      description: getEditorAgentToolDefinition("editor.requestHumanApproval").description,
      parameters: approvalRequestParameters,
      render: ({ args, respond, status }) => {
        if (status !== "executing" || respond === undefined) {
          return null;
        }

        const summary = args.summary ?? args.toolName;
        const approve = async () => {
          const envelope = buildApprovalEnvelope({
            toolName: args.toolName,
            scopeHash: args.scopeHash,
            actionId: "copilot-human-approval"
          });
          approvalsRef.current.set(envelope.approvalId, envelope);
          await respond({
            ok: true,
            approvalId: envelope.approvalId,
            toolName: envelope.toolName,
            scopeHash: envelope.scopeHash,
            expiresAt: envelope.expiresAt
          });
        };
        const reject = async () => {
          await respond({
            ok: false,
            toolName: args.toolName,
            scopeHash: args.scopeHash,
            reason: t.agentChat.rejectedReason
          });
        };

        return (
          <section className="editor-surface-approval">
            <span>{t.agentChat.approvalRequired}</span>
            <strong>{args.toolName}</strong>
            <p>{summary}</p>
            <div className="editor-surface-actions">
              <button type="button" onClick={() => void approve()}>
                {t.agentChat.approve}
              </button>
              <button type="button" onClick={() => void reject()}>
                {t.agentChat.reject}
              </button>
            </div>
          </section>
        );
      }
    },
    [tools]
  );

  return null;
}

function lookupApproval(
  approvals: ReadonlyMap<string, CubicaAgentApprovalEnvelope>,
  approvalId: string | undefined
): CubicaAgentApprovalEnvelope | undefined {
  return approvalId === undefined ? undefined : approvals.get(approvalId);
}

function buildSurfaceApprovalEnvelope(action: CubicaSurfaceAction): CubicaAgentApprovalEnvelope | undefined {
  if (!isEditorAssistantToolName(action.target)) {
    return undefined;
  }

  return buildApprovalEnvelope({
    toolName: action.target,
    actionId: action.id,
    scopeHash: surfaceActionApprovalScope(action)
  });
}

function buildApprovalEnvelope(input: {
  readonly toolName: EditorAssistantToolName;
  readonly actionId: string;
  readonly scopeHash: string;
}): CubicaAgentApprovalEnvelope {
  const approvedAt = new Date();
  const expiresAt = new Date(approvedAt.getTime() + EDITOR_APPROVAL_TTL_MS);
  return buildCubicaAgentApprovalEnvelope({
    approvalId: `approval-${approvedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: EDITOR_AUTHORING_ASSISTANT_ID,
    toolName: input.toolName,
    approvedBy: "local-editor-user",
    approvedAt: approvedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    scopeHash: input.scopeHash,
    status: "approved",
    actionId: input.actionId
  });
}

function surfaceActionApprovalScope(action: CubicaSurfaceAction): string {
  const metadataScope = action.metadata?.approvalScopeHash;
  return typeof metadataScope === "string" ? metadataScope : `${action.target ?? action.kind}:${action.id}`;
}

function toJsonSerializable(value: EditorAgentContextProjection): JsonSerializable {
  return JSON.parse(JSON.stringify(value)) as JsonSerializable;
}

function toCubicaToolResult(toolName: EditorAssistantToolName, result: EditorAgentToolResult): CubicaAgentToolResult<EditorAgentToolData> {
  getEditorAgentToolDefinition(toolName);
  const fallbackData = result.changeSetId === undefined ? undefined : { changeSetId: result.changeSetId };
  return {
    ok: result.ok,
    toolName,
    summary: result.summary,
    diagnostics: result.diagnostics,
    diffSummary: result.diffSummary,
    data: result.data ?? fallbackData
  };
}
