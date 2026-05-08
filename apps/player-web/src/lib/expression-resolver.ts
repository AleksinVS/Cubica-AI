/**
 * Контекстный резолвер выражений привязки данных.
 *
 * Поддерживает три вида выражений:
 * 1. Path binding: {{game.state.public.metrics.score}} — доступ к вложенным полям state
 * 2. Context binding: {{card.title}}, {{info.body}} — доступ к локальному контексту (itemTemplate)
 * 3. Fallback values: {{state.public.metrics.score || 0}} — значение по умолчанию
 *
 * Expression format:
 *   {{<path>}}              — простой path
 *   {{<path> || <value>}}  — path с fallback
 *
 * Path resolution order:
 *   1. localContext (если передан) — для итерации в itemTemplate
 *   2. state — глобальное состояние игры
 *   3. metrics — shortcut для state.public.metrics
 */
export function resolveExpression(
  expression: string,
  state: Record<string, unknown>,
  localContext?: Record<string, unknown>
): string {
  // Не-expression — вернуть как есть
  if (!expression.startsWith("{{") || !expression.endsWith("}}")) {
    return expression;
  }

  const inner = expression.slice(2, -2).trim();

  // Поддержка fallback: {{path || fallback}}
  const pipeIndex = inner.indexOf("||");
  if (pipeIndex !== -1) {
    const path = inner.slice(0, pipeIndex).trim();
    const fallback = inner.slice(pipeIndex + 2).trim();
    const value = resolvePath(path, state, localContext);
    if (value !== undefined && value !== null) {
      return String(value);
    }
    // Fallback может быть числом или строкой
    return fallback.startsWith("'") || fallback.startsWith('"')
      ? fallback.slice(1, -1)
      : fallback;
  }

  const value = resolvePath(inner, state, localContext);
  return value !== undefined && value !== null ? String(value) : "";
}

/**
 * Резолвит множество выражений в строке.
 * Поддерживает множественные {{...}} в одной строке.
 * Если строка содержит ровно одно выражение — возвращает распакованное значение (число, строку).
 * Если строка содержит текст вперемешку с выражениями — возвращает строку.
 */
export function resolveExpressions(
  text: string,
  state: Record<string, unknown>,
  localContext?: Record<string, unknown>
): string | number | unknown {
  // Быстрый путь: одно выражение занимает всю строку
  const singleMatch = text.match(/^\{\{(.+?)\}\}$/);
  if (singleMatch) {
    return resolvePath(singleMatch[1].trim(), state, localContext) ?? "";
  }

  // Множественные выражения или текст вперемешку
  return text.replace(/\{\{(.+?)\}\}/g, (_match, expr: string) => {
    const value = resolvePath(expr.trim(), state, localContext);
    return value !== undefined && value !== null ? String(value) : "";
  });
}

/**
 * Резолвит dot-notation path против state и localContext.
 *
 * Priority:
 *   1. localContext (card.title, info.body, etc.)
 *   2. state (game.state.public.metrics.score, state.public.timeline.screenId, etc.)
 *   3. convenience aliases (metrics.score → state.public.metrics.score)
 */
function resolvePath(
  path: string,
  state: Record<string, unknown>,
  localContext?: Record<string, unknown>
): unknown {
  // 1. Проверить localContext первым (itemTemplate context)
  if (localContext) {
    const localValue = getByPath(localContext, path);
    if (localValue !== undefined) {
      return localValue;
    }
  }

  // 2. Convenience alias: game.state.public.* → state.public.*
  if (path.startsWith("game.state.public.")) {
    const statePath = path.slice("game.state.public.".length);
    return getByPath(state, `public.${statePath}`);
  }

  // 3. Convenience alias: game.state.secret.* → state.secret.*
  if (path.startsWith("game.state.secret.")) {
    const statePath = path.slice("game.state.secret.".length);
    return getByPath(state, `secret.${statePath}`);
  }

  // 4. Convenience alias: metrics.* → state.public.metrics.*
  if (path.startsWith("metrics.")) {
    const metricPath = path.slice("metrics.".length);
    return getByPath(state, `public.metrics.${metricPath}`);
  }

  // 5. Прямой путь в state
  if (path.startsWith("state.")) {
    return getByPath(state, path.slice("state.".length));
  }

  // 6. Прямой путь в state без префикса
  return getByPath(state, path);
}

/**
 * Резолвит {{...}} выражения в значениях payload-объекта.
 *
 * Для action-пайлоадов компонентов (cardComponent, buttonComponent),
 * где значения вида `"{{card.selectActionId}}"` должны быть
 * разрешены против gameState и localContext перед отправкой.
 *
 * Non-string значения проходят как есть.
 */
export function resolvePayloadExpressions(
  payload: Record<string, unknown>,
  state: Record<string, unknown> | undefined,
  localContext?: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      if (value.startsWith("{{") && value.endsWith("}}")) {
        resolved[key] = resolveExpression(value, state ?? {}, localContext);
      } else if (value.includes("{{")) {
        resolved[key] = resolveExpressions(value, state ?? {}, localContext);
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Получает вложенное значение по dot-notation path.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}