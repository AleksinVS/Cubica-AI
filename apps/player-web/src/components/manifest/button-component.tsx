import type {
  GameUiComponent,
  GameUiButtonComponentProps
} from "@cubica/contracts-manifest";
import { resolveButtonId } from "@/lib/layout-helpers";

/**
 * Рендерит buttonComponent (кнопка действия в UI манифеста).
 */
export function ButtonComponent({
  component,
  onAction,
  layoutMode
}: {
  component: GameUiComponent<GameUiButtonComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  layoutMode?: "leftsidebar" | "topbar";
}) {
  const { caption } = component.props;
  const command = (component as GameUiComponent).actions?.onClick?.command;
  const id = resolveButtonId(caption, (component as GameUiComponent).id);
  const isTopbarArrow = layoutMode === "topbar" && (id === "nav-left" || id === "nav-right");

  return (
    <button
      id={id}
      className={`action-button game-button${isTopbarArrow ? " topbar-nav-button" : ""}`}
      type="button"
      onClick={() => command && onAction(command, (component as GameUiComponent).actions?.onClick?.payload ?? {})}
      disabled={!command}
      aria-label={caption}
    >
      {isTopbarArrow ? null : caption}
    </button>
  );
}
