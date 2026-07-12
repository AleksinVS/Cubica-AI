import type {
  GameUiComponent,
  GameUiButtonComponentProps
} from "@cubica/contracts-manifest";
import { resolveExpressions, resolvePayloadExpressions } from "@/lib/expression-resolver";
import type { PreviewElementAttributes } from "./preview-metadata";

/**
 * Рендерит buttonComponent (кнопка действия в UI манифесте).
 *
 * Поддерживает variant для стилизации:
 * - "action" (default): основная кнопка действия (action-button game-button)
 * - "helper": кнопка панели — журнал/подсказка (button-helper)
 * - "nav": кнопка навигации — стрелки (button-helper-arrow)
 */
export function ButtonComponent({
  component,
  onAction,
  layoutMode,
  localContext,
  gameState,
  previewAttributes,
}: {
  component: GameUiComponent<GameUiButtonComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  layoutMode?: "leftsidebar" | "topbar";
  localContext?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  previewAttributes?: PreviewElementAttributes;
}) {
  // The UI schema permits an ordinary component to omit props entirely.
  // A malformed/incomplete button then renders disabled instead of crashing.
  const props: Partial<GameUiButtonComponentProps> = component.props ?? {};
  const { caption, variant, disabled } = props;
  const command = (component as GameUiComponent).actions?.onClick?.command;
  const basePayload = (component as GameUiComponent).actions?.onClick?.payload ?? {};
  const resolvedPayload = resolvePayloadExpressions(basePayload, gameState, localContext);
  const resolvedCaption = resolveStringProp(caption, gameState, localContext);
  const resolvedDisabled = resolveBooleanProp(disabled, false, gameState, localContext);

  // Определяем CSS классы по variant
  let className: string;
  if (variant === "helper") {
    className = "button-helper";
  } else if (variant === "nav") {
    className = "button-helper-arrow";
  } else {
    // variant === "action" или не указан
    className = "action-button game-button";
  }

  // Для nav-кнопок в topbar — дополнительный класс
  const isTopbarArrow = variant === "nav" && layoutMode === "topbar";
  if (isTopbarArrow) {
    className = appendClassName(className, "topbar-nav-button");
  }

  return (
    <button
      {...previewAttributes}
      id={(component as GameUiComponent).id}
      className={className}
      type="button"
      onClick={() => command && onAction(command, resolvedPayload)}
      disabled={!command || resolvedDisabled}
      aria-label={resolvedCaption}
    >
      {variant === "nav" ? null : resolvedCaption}
    </button>
  );
}

function appendClassName(base: string, extra: string): string {
  return base ? `${base} ${extra}` : extra;
}

function resolveStringProp(
  value: string | undefined,
  gameState: Record<string, unknown> | undefined,
  localContext: Record<string, unknown> | undefined
): string | undefined {
  if (!value || !value.includes("{{")) {
    return value;
  }
  return String(resolveExpressions(value, gameState ?? {}, localContext));
}

function resolveBooleanProp(
  value: boolean | string | undefined,
  fallback: boolean,
  gameState: Record<string, unknown> | undefined,
  localContext: Record<string, unknown> | undefined
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const resolved = value.includes("{{")
    ? resolveExpressions(value, gameState ?? {}, localContext)
    : value;
  if (typeof resolved === "boolean") {
    return resolved;
  }
  if (typeof resolved === "string") {
    return resolved !== "false" && resolved !== "";
  }
  return Boolean(resolved);
}
