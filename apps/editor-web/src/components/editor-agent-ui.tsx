"use client";
import type { EditorAgentProtocolMessage } from "@/lib/ag-ui-event-adapter";
import { toEditorUserMessage, type EditorMessageSender } from "@/components/workspace/mvp-agent-message";

/**
 * CopilotKit integration for the editor assistant.
 *
 * This component is intentionally thin: it registers assistant context and
 * frontend tools, but it does not own authoring state. The workspace passes
 * existing Cubica functions for planning, dry-run and preview. Only the human
 * workspace controls can confirm a prepared mutation, undo or save.
 */
import {
  type CubicaAgentToolResult,
  type CubicaJsonValue,
  type CubicaSurface,
  type CubicaSurfaceAction
} from "@cubica/contracts-ai";
import { CopilotChat, CopilotChatUserMessage, type CopilotChatUserMessageProps, CopilotKit, useAgent, useCopilotKit, useAgentContext, useFrontendTool, type JsonSerializable } from "@copilotkit/react-core/v2";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  readonly prepareCandidate: (input: { readonly changeSetJson: string; readonly contextToken?: string }) => Promise<EditorAgentToolResult>;
  readonly proposePrototypeExtraction: (input: {
    readonly prompt?: string;
    readonly sourcePointers?: readonly string[];
    readonly definitionType?: string;
    readonly definitionSemantics?: string;
  }) => Promise<EditorAgentToolResult>;
  readonly preparePrototypeChangeSet: () => Promise<EditorAgentToolResult>;
  readonly dryRunChangeSet: (input: { readonly prompt?: string }) => Promise<EditorAgentToolResult>;
  readonly preparePreview: () => Promise<EditorAgentToolResult>;
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
  threadId,
  title,
  onSenderReady,
  onBusyChange,
  onSendError,
  onCollapse,
  connection,
  fallback,
  surface,
  tools
}: {
  readonly enabled: boolean;
  readonly threadId?: string;
  readonly title?: string;
  readonly onSenderReady?: (sender: EditorMessageSender | null) => void;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly onSendError?: (message: string) => void;
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
        <strong>{title ?? t.agentChat.title}</strong>
        <button type="button" onClick={onCollapse}>
          {t.common.collapse}
        </button>
      </div>
      <div className="agent-copilot-panel">
        {surface !== undefined && surface !== null ? (
          <EditorCubicaSurfaceRenderer surface={surface} onAction={(action) => handleEditorSurfaceAction(action, tools)} />
        ) : null}
        <EditorConversationBridge threadId={threadId} onSenderReady={onSenderReady} onBusyChange={onBusyChange} onSendError={onSendError} />
        <CopilotChat
          agentId={EDITOR_AUTHORING_ASSISTANT_ID}
          threadId={threadId}
          input={{
            textArea: { "aria-label": "Сообщение агенту" },
            sendButton: { "aria-label": "Отправить сообщение" },
            addMenuButton: { "aria-label": "Добавить вложение" }
          }}
          messageView={{ userMessage: EditorUserMessage }}
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
  switch (action.target) {
    case "editor.planChangeSet":
      void tools.planChangeSet({ prompt });
      return;
    case "editor.prepareCandidate": {
      const input = action.payload;
      if (input !== undefined && input !== null && typeof input === "object" && !Array.isArray(input)) {
        const values = input as { readonly [key: string]: CubicaJsonValue };
        if (typeof values.changeSetJson === "string") {
          void tools.prepareCandidate({
            changeSetJson: values.changeSetJson,
            contextToken: typeof values.contextToken === "string" ? values.contextToken : undefined
          });
        }
      }
      return;
    }
    case "editor.proposePrototypeExtraction":
      void tools.proposePrototypeExtraction({ prompt });
      return;
    case "editor.preparePrototypeChangeSet":
      void tools.preparePrototypeChangeSet();
      return;
    case "editor.dryRunChangeSet":
      void tools.dryRunChangeSet({ prompt });
      return;
    case "editor.preparePreview":
      void tools.preparePreview();
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

function EditorAgentRuntimeHooksInner({
  context,
  tools
}: {
  readonly context: EditorAgentContextProjection;
  readonly tools: EditorAgentTools;
}) {
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
      name: getEditorAgentToolDefinition("editor.prepareCandidate").name,
      description: getEditorAgentToolDefinition("editor.prepareCandidate").description,
      parameters: z.object({
        changeSetJson: z.string().min(2).max(64_000).describe("JSON string of an EditorChangeSet. Only selected source JSON patches are accepted."),
        contextToken: z.string().optional().describe("Context token from an element or YAML request; required when that request supplied one.")
      }),
      handler: async ({ changeSetJson, contextToken }) =>
        toCubicaToolResult("editor.prepareCandidate", await tools.prepareCandidate({ changeSetJson, contextToken }))
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
      name: getEditorAgentToolDefinition("editor.preparePreview").name,
      description: getEditorAgentToolDefinition("editor.preparePreview").description,
      parameters: z.object({}),
      handler: async () => toCubicaToolResult("editor.preparePreview", await tools.preparePreview())
    },
    [tools]
  );

  return null;
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


function EditorConversationBridge({ threadId, onSenderReady, onBusyChange, onSendError }: {
  threadId?: string; onSenderReady?: (sender: EditorMessageSender | null) => void; onBusyChange?: (busy: boolean) => void; onSendError?: (message: string) => void;
}) {
  const { agent } = useAgent({ agentId: EDITOR_AUTHORING_ASSISTANT_ID });
  const { copilotkit } = useCopilotKit();
  useEffect(() => { onBusyChange?.(agent.isRunning); }, [agent.isRunning, onBusyChange]);
  const histories = useRef(new Map<string, EditorAgentProtocolMessage[]>());
  const previous = useRef(threadId);
  useEffect(() => {
    if (previous.current !== threadId) {
      if (previous.current) histories.current.set(previous.current, [...agent.messages]);
      agent.setMessages(threadId ? histories.current.get(threadId) ?? [] : []);
      previous.current = threadId;
    }
  }, [agent, threadId]);
  useEffect(() => {
    onSenderReady?.(async input => {
      if (agent.isRunning) throw new Error("Дождитесь ответа агента перед отправкой нового рисунка.");
      if (threadId && agent.threadId !== threadId) throw new Error("Диалог ещё подключается. Повторите отправку.");
      agent.addMessage(toEditorUserMessage(input));
      // The message is now in the chat; show its streamed answer without holding the drawing UI.
      void copilotkit.runAgent({ agent }).catch(error => {
        onSendError?.(error instanceof Error ? error.message : "Не удалось получить ответ агента. Сообщение осталось в диалоге.");
      });
    });
    return () => onSenderReady?.(null);
  }, [agent, copilotkit, onSenderReady, onSendError, threadId]);
  return null;
}


const EditorUserMessage = Object.assign(function EditorDrawingUserMessage(props: CopilotChatUserMessageProps) {
  const content = props.message.content;
  const hiddenContext = (part: { readonly type: string; readonly text?: string }) => part.type === "text" &&
    (part.text?.startsWith("Контекст рисунка:") || part.text?.startsWith("Контекст выбранного источника ("));
  if (!Array.isArray(content) || !content.some(hiddenContext)) return <CopilotChatUserMessage {...props} />;
  return <CopilotChatUserMessage {...props} onEditMessage={undefined}
    message={{ ...props.message, content: content.filter(part => !hiddenContext(part)) }} />;
}, CopilotChatUserMessage);
