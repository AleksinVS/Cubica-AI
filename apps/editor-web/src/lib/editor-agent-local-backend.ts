/**
 * Local AG-UI backend for the editor authoring assistant.
 *
 * This backend is intentionally deterministic: it proves the CopilotKit/AG-UI
 * protocol path and can request human approval, but it is not a production
 * LLM brain. Production can replace it by setting
 * CUBICA_EDITOR_AGENT_AG_UI_URL to an external AG-UI service.
 */
import { EventType, type BaseEvent, type Message, type RunAgentInput, type Tool } from "@ag-ui/core";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "@/lib/agent-assistant-registry";

type LocalToolChoice =
  | {
      readonly toolName: string;
      readonly args: Record<string, unknown>;
      readonly intro: string;
    }
  | undefined;

const CHANGE_REQUEST_MARKERS = [
  "add",
  "change",
  "create",
  "delete",
  "edit",
  "move",
  "rename",
  "replace",
  "update",
  "добав",
  "замен",
  "измени",
  "изменить",
  "перемести",
  "переимен",
  "созда",
  "сделай",
  "удал"
];

export function createLocalEditorAgentEvents(input: RunAgentInput): readonly BaseEvent[] {
  const messageId = `local-${input.runId}-message`;
  const roles = input.messages.map(message => message.role);
  const lastUserIndex = roles.lastIndexOf("user");
  const lastToolIndex = roles.lastIndexOf("tool");
  const latestToolResult = lastToolIndex > lastUserIndex ? input.messages[lastToolIndex] : undefined;
  const latestUserText = latestUserMessageText(input.messages);
  const toolChoice = latestToolResult === undefined ? chooseTool(input.tools, latestUserText) : undefined;
  const responseText = latestToolResult !== undefined
    ? summarizeToolResult(latestToolResult)
    : toolChoice === undefined
      ? localHelpText(input.tools, latestUserText)
      : toolChoice.intro;
  const events: BaseEvent[] = [
    {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
      parentRunId: input.parentRunId
    },
    {
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
      name: EDITOR_AUTHORING_ASSISTANT_ID
    },
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: responseText
    },
    {
      type: EventType.TEXT_MESSAGE_END,
      messageId
    }
  ];

  if (toolChoice !== undefined) {
    const toolCallId = `local-${input.runId}-tool`;
    events.push(
      {
        type: EventType.TOOL_CALL_START,
        toolCallId,
        toolCallName: toolChoice.toolName,
        parentMessageId: messageId
      },
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId,
        delta: JSON.stringify(toolChoice.args)
      },
      {
        type: EventType.TOOL_CALL_END,
        toolCallId
      }
    );
  }

  events.push({
    type: EventType.RUN_FINISHED,
    threadId: input.threadId,
    runId: input.runId,
    result: {
      agentId: EDITOR_AUTHORING_ASSISTANT_ID,
      backendMode: "local"
    }
  });

  return events;
}

function chooseTool(tools: readonly Tool[], latestUserText: string): LocalToolChoice {
  const prompt = latestUserText.trim();
  const lowerPrompt = prompt.toLowerCase();
  const toolNames = new Set(tools.map((tool) => tool.name));

  if (toolNames.has("editor.preparePreview") && includesAny(lowerPrompt, ["preview", "предпросмотр", "превью"])) {
    return {
      toolName: "editor.preparePreview",
      args: {},
      intro: "Подготавливаю предпросмотр текущей игры."
    };
  }

  if (toolNames.has("editor.dryRunChangeSet") && includesAny(lowerPrompt, ["dry-run", "dry run", "проверь", "валидац", "проверка"])) {
    return {
      toolName: "editor.dryRunChangeSet",
      args: prompt === "" ? {} : { prompt },
      intro: "Проверяю предложенное изменение."
    };
  }

  if (
    toolNames.has("editor.preparePrototypeChangeSet") &&
    includesAny(lowerPrompt, ["use proposal", "use prototype", "prepare prototype", "используй proposal", "используй прототип", "подготовь прототип", "запланируй прототип"])
  ) {
    return {
      toolName: "editor.preparePrototypeChangeSet",
      args: {},
      intro: "Подготавливаю предложенный прототип к просмотру."
    };
  }

  if (
    toolNames.has("editor.proposePrototypeExtraction") &&
    includesAny(lowerPrompt, ["prototype", "прототип", "extract", "extraction", "извлеч", "выдели повтор", "повторяющ"])
  ) {
    return {
      toolName: "editor.proposePrototypeExtraction",
      args: prompt === "" ? {} : { prompt },
      intro: "Проверяю, какие повторяющиеся элементы можно объединить в прототип."
    };
  }

  if (toolNames.has("editor.planChangeSet") && prompt !== "" && includesAny(lowerPrompt, CHANGE_REQUEST_MARKERS)) {
    return {
      toolName: "editor.planChangeSet",
      args: { prompt },
      intro: "Подготавливаю изменение. Перед применением вы сможете его проверить."
    };
  }

  return undefined;
}

function localHelpText(_tools: readonly Tool[], _latestUserText: string): string {
  return "Подключён локальный помощник. Он может подготовить точную замену текста или названия выбранного элемента — укажите новое значение в кавычках. Для свободного обсуждения правил и анализа изображений подключите внешний ИИ. Изменения применяются только после вашего подтверждения.";
}

function summarizeToolResult(message: Message): string {
  const rawContent = typeof message.content === "string" ? message.content : "";
  const parsed = parseJsonObject(rawContent);
  const summary = typeof parsed?.summary === "string" ? parsed.summary : rawContent;
  const ok = typeof parsed?.ok === "boolean" ? (parsed.ok ? "OK" : "blocked") : "done";
  const diagnostics = Array.isArray(parsed?.diagnostics) && parsed.diagnostics.length > 0
    ? ` Диагностик: ${parsed.diagnostics.length}.`
    : "";
  return `Tool result: ${ok}. ${summary || "Инструмент завершил выполнение."}${diagnostics}`;
}

function latestUserMessageText(messages: readonly Message[]): string {
  const message = latestMessage(messages, "user");
  if (typeof message?.content === "string") return message.content;
  // The drawing sender keeps its explicit instruction first; later parts are visual context.
  const firstPart = Array.isArray(message?.content) ? message.content[0] : undefined;
  return firstPart?.type === "text" ? firstPart.text : "";
}

function latestMessage(messages: readonly Message[], role: Message["role"]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) {
      return messages[index];
    }
  }

  return undefined;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function includesAny(value: string, markers: readonly string[]): boolean {
  return markers.some((marker) => value.includes(marker));
}
