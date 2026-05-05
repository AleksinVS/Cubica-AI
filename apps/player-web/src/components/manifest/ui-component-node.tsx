import type {
  GameUiComponent,
  GameUiAreaComponentProps,
  GameUiButtonComponentProps,
  GameUiCardComponentProps,
  GameUiGameVariableComponentProps,
  GameUiScreenComponentProps
} from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";
import { appendClassName } from "@/lib/classname-utils";
import { resolveAreaCssClass } from "@/lib/layout-helpers";
import { GameVariableComponent } from "./game-variable-component";
import { CardComponent } from "./card-component";
import { ButtonComponent } from "./button-component";

/**
 * Рекурсивно рендерит дерево UI-компонентов из манифеста.
 * Поддерживает ограниченный набор типов: screenComponent, areaComponent,
 * gameVariableComponent, cardComponent, buttonComponent.
 */
export function UiComponentNode({
  component,
  metrics,
  onAction,
  screenKey,
  layoutMode,
  metricBackgroundImages
}: {
  component: GameUiComponent;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  layoutMode?: "leftsidebar" | "topbar";
  metricBackgroundImages?: Record<string, string>;
}) {
  const children = component.children ?? [];

  switch (component.type) {
    case "screenComponent": {
      const props = component.props as GameUiScreenComponentProps;
      const cssClass =
        layoutMode === "topbar"
          ? appendClassName(props.cssClass, "topbar-screen-shell")
          : layoutMode === "leftsidebar"
            ? appendClassName(props.cssClass, "leftsidebar-screen")
            : props.cssClass ?? "";
      return (
        <div
          className={`game-screen ${cssClass}`}
          style={props.backgroundImage ? { backgroundImage: `url(${props.backgroundImage})` } : undefined}
        >
          {(cssClass.includes("topbar-screen-shell") || cssClass.includes("info-screen-shell")) && (
            <div className="additional-background" />
          )}
          {children.map((child, index) => (
            <UiComponentNode
              key={index}
              component={child}
              metrics={metrics}
              onAction={onAction}
              screenKey={screenKey}
              layoutMode={layoutMode}
              metricBackgroundImages={metricBackgroundImages}
            />
          ))}
        </div>
      );
    }

    case "areaComponent": {
      const props = component.props as GameUiAreaComponentProps;
      return (
        <div className={`game-area ${resolveAreaCssClass(props.cssClass, screenKey, layoutMode)}`}>
          {children.map((child, index) => (
            <UiComponentNode
              key={index}
              component={child}
              metrics={metrics}
              onAction={onAction}
              screenKey={screenKey}
              layoutMode={layoutMode}
              metricBackgroundImages={metricBackgroundImages}
            />
          ))}
        </div>
      );
    }

    case "gameVariableComponent": {
      const props = component.props as GameUiGameVariableComponentProps;
      return (
        <GameVariableComponent
          component={component as GameUiComponent<GameUiGameVariableComponentProps>}
          metrics={metrics}
          backgroundImage={props.backgroundImage}
          layoutMode={layoutMode}
          metricBackgroundImages={metricBackgroundImages}
        />
      );
    }

    case "cardComponent": {
      return (
        <CardComponent
          component={component as GameUiComponent<GameUiCardComponentProps>}
          onAction={onAction}
        />
      );
    }

    case "buttonComponent": {
      return (
        <ButtonComponent
          component={component as GameUiComponent<GameUiButtonComponentProps>}
          onAction={onAction}
          layoutMode={layoutMode}
        />
      );
    }

    default:
      // Неизвестный тип компонента — пропускаем, не бросаем ошибку
      return null;
  }
}
