import type {
  GameUiComponent,
  GameUiButtonComponentProps
} from "@cubica/contracts-manifest";
import { resolvePayloadExpressions } from "@/lib/expression-resolver";
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
  const { caption, variant, disabled } = component.props;
  const command = (component as GameUiComponent).actions?.onClick?.command;
  const basePayload = (component as GameUiComponent).actions?.onClick?.payload ?? {};
  const resolvedPayload = resolvePayloadExpressions(basePayload, gameState, localContext);

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
      disabled={!command || disabled}
      aria-label={caption}
    >
      {variant === "nav" ? null : caption}
    </button>
  );
}

function appendClassName(base: string, extra: string): string {
  return base ? `${base} ${extra}` : extra;
}
