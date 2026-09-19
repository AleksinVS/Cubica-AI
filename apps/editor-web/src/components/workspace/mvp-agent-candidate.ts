import {
  createSchemaRegistry,
  parseJsonPointer,
  type EditorChangeSet,
  type JsonValue
} from "@cubica/editor-engine";
import editorMutationSchema from "../../../../../docs/architecture/schemas/editor-mutation.schema.json";
import type { EditorMessageSender } from "./mvp-agent-message";

const schemaId = "https://cubica.platform/schemas/editor-mutation.schema.json";
const changeSetSchemaId = `${schemaId}#/definitions/EditorChangeSet`;
const schemaRegistry = createSchemaRegistry();
schemaRegistry.registerSchema(schemaId, editorMutationSchema);

export interface MvpAgentCandidateScope {
  readonly token: string;
  readonly gameId: string;
  readonly sessionId: string;
  readonly sources: readonly { readonly filePath: string; readonly pointer: string; readonly revision: string }[];
}

export interface MvpAgentCandidateLiveContext {
  readonly gameId: string;
  readonly sessionId: string | undefined;
  readonly revisions: ReadonlyMap<string, string>;
}

export type MvpAgentCandidateResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet }
  | { readonly ok: false; readonly reason: string };

export function resolveMvpAgentCandidateScope(
  captured: MvpAgentCandidateScope | null,
  contextToken: string | undefined
): { readonly ok: true; readonly scope: MvpAgentCandidateScope } | { readonly ok: false; readonly reason: string } {
  if (captured === null) {
    return { ok: false, reason: "Контекст запроса отсутствует или устарел. Выберите элемент и отправьте запрос через панель правки." };
  }
  if (contextToken === undefined || contextToken !== captured.token) {
    return { ok: false, reason: "Токен контекста не совпадает. Повторите запрос для выбранного источника." };
  }
  return { ok: true, scope: captured };
}

export function isMvpAgentCandidateScopeCurrent(
  scope: MvpAgentCandidateScope,
  live: MvpAgentCandidateLiveContext
): boolean {
  return scope.gameId === live.gameId && scope.sessionId === live.sessionId &&
    scope.sources.every((source) => live.revisions.get(source.filePath) === source.revision);
}

export async function forwardMvpAgentRequest(
  sender: EditorMessageSender | null,
  prompt: string,
  context: string
): Promise<{ readonly forwarded: boolean; readonly message: string }> {
  if (sender === null) return { forwarded: false, message: "Агент не подключён. Текст сохранён в поле; откройте чат после подключения." };
  if (prompt.length > 12_000) return { forwarded: false, message: "Запрос слишком длинный. Сократите текст до 12 000 символов." };
  try {
    await sender({ text: prompt, context });
    return { forwarded: true, message: "Запрос отправлен агенту. Следите за ответом в чате." };
  } catch (error) {
    return { forwarded: false, message: error instanceof Error ? error.message : "Агент не принял запрос." };
  }
}

/** The local planner only handles a single explicit text/name replacement. */
export function isMvpExactTextOrNamePrompt(prompt: string): boolean {
  const quoted = /[«“"']([^»”"']{1,160})[»”"']\s*[.!?]?$/u.exec(prompt.trim());
  if (quoted === null) return false;
  const prefix = prompt.trim().slice(0, quoted.index).trim().toLowerCase();
  return /^(?:(?:измени|замени|поменяй|установи|поставь)\s+(?:текст|надпись|подпись|название|имя|заголовок)(?:\s+(?:этого\s+)?(?:элемента|кнопки|поля|узла|заголовка))?\s+на|(?:переименуй|назови)\s+(?:элемент|кнопку|поле|узел)\s+(?:в|как)|(?:текст|надпись|подпись|название|имя)\s+на|(?:change|replace|set)\s+(?:the\s+)?(?:text|label|caption|name|title)(?:\s+(?:of\s+the\s+)?(?:element|button|field))?\s+to|rename\s+(?:the\s+)?(?:element|button|field)\s+to)$/u.test(prefix);
}

/** JSON Schema owns shape; these checks only narrow the selected source and side effects. */
export function parseMvpAgentCandidate(
  changeSetJson: string,
  scope: MvpAgentCandidateScope,
  live: MvpAgentCandidateLiveContext
): MvpAgentCandidateResult {
  if (changeSetJson.length > 64_000) return { ok: false, reason: "Предложение слишком велико для одной правки." };
  if (!isMvpAgentCandidateScopeCurrent(scope, live)) {
    return { ok: false, reason: "Игра, сессия или выбранный источник изменились. Повторите запрос." };
  }
  let value: unknown;
  try { value = JSON.parse(changeSetJson); }
  catch { return { ok: false, reason: "Предложение не является корректным JSON." }; }
  const diagnostics = schemaRegistry.validateValue({ schemaId: changeSetSchemaId, value: value as JsonValue });
  if (diagnostics.length > 0) return { ok: false, reason: `Неверная структура предложения: ${diagnostics[0]?.message ?? "ошибка схемы"}` };
  const changeSet = value as EditorChangeSet;
  if ((changeSet.textPatches?.length ?? 0) > 0 || (changeSet.fileCreates?.length ?? 0) > 0 ||
      (changeSet.fileDeletes?.length ?? 0) > 0 || (changeSet.fileRenames?.length ?? 0) > 0) {
    return { ok: false, reason: "Агент может предлагать только JSON-правки выбранного источника." };
  }
  const operationCount = changeSet.jsonPatches.reduce((count, patch) => count + patch.operations.length, 0);
  if (scope.sources.length === 0 || scope.sources.length > 8 || changeSet.jsonPatches.length === 0 ||
      changeSet.jsonPatches.length > 8 || operationCount === 0 || operationCount > 32 ||
      !changeSet.jsonPatches.some((patch) => patch.operations.some((operation) => operation.op !== "test"))) {
    return { ok: false, reason: "Предложение должно содержать ограниченный набор изменений выбранного источника." };
  }
  for (const patch of changeSet.jsonPatches) {
    for (const operation of patch.operations) {
      try { parseJsonPointer(operation.path); }
      catch { return { ok: false, reason: "Предложение содержит неверный JSON-указатель." }; }
      if (!scope.sources.some((source) => source.filePath === patch.filePath && source.pointer !== "" &&
          (operation.path === source.pointer || operation.path.startsWith(`${source.pointer}/`)))) {
        return { ok: false, reason: `Правка вне выбранного источника: ${patch.filePath}#${operation.path}` };
      }
    }
  }
  return { ok: true, changeSet };
}
