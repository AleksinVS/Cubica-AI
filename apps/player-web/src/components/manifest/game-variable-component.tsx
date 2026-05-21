import type { CSSProperties } from "react";
import type {
  GameUiComponent,
  GameUiGameVariableComponentProps
} from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";
import { resolveMetricBinding } from "@/lib/metric-resolvers";
import { resolveMetricBackgroundImage } from "@/lib/layout-helpers";

/**
 * Renders gameVariableComponent (metric display in sidebar or topbar).
 *
 * The `layout` prop on component.props controls visual treatment:
 * - "prominent": larger display with fixed dimensions (for primary score metrics)
 * - "default" or undefined: standard metric display
 */
export function GameVariableComponent({
  component,
  metrics,
  backgroundImage,
  layoutMode,
  metricBackgroundImages
}: {
  component: GameUiComponent<GameUiGameVariableComponentProps>;
  metrics: MetricsSnapshot;
  backgroundImage?: string;
  layoutMode?: "leftsidebar" | "topbar";
  metricBackgroundImages?: Record<string, string>;
}) {
  const { caption, description, value } = component.props;
  const resolvedValue = resolveMetricBinding(value, metrics);
  const id = (component as GameUiComponent).id;
  const resolvedBackgroundImage = resolveMetricBackgroundImage(id, backgroundImage, layoutMode, metricBackgroundImages);
  const isProminent = component.props.layout === "prominent";

  if (layoutMode === "topbar") {
    const prominentStyle: CSSProperties | undefined = isProminent
      ? {
          display: "block",
          position: "relative",
          width: "107px",
          minWidth: "107px",
          height: "80px",
          minHeight: "80px",
          padding: "1px 0 0 16px",
          boxSizing: "border-box"
        }
      : undefined;
    const prominentCaptionStyle: CSSProperties | undefined = isProminent
      ? {
          display: "block",
          width: "75px",
          margin: "4px 0 0",
          textAlign: "center"
        }
      : undefined;

    return (
      <div
        className={`game-variable ${id ? `game-variable--${id}` : ""} game-variable--topbar${isProminent ? " game-variable--prominent" : ""}`}
        style={prominentStyle}
      >
        {resolvedBackgroundImage && (
          <div
            className="game-variable-image game-variable-visual"
            style={
              isProminent
                ? {
                    backgroundImage: `url(${resolvedBackgroundImage})`,
                    width: "75px",
                    minWidth: "75px",
                    height: "47px",
                    minHeight: "47px",
                    flex: "0 0 75px",
                    alignSelf: "flex-start"
                  }
                : { backgroundImage: `url(${resolvedBackgroundImage})` }
            }
          >
            <strong className="game-variable-value">{resolvedValue}</strong>
          </div>
        )}
        {!resolvedBackgroundImage && (
          <strong className="game-variable-value game-variable-value--plain">{resolvedValue}</strong>
        )}
        <span className="game-variable-caption" style={prominentCaptionStyle}>
          {caption}
        </span>
        {description && <p className="game-variable-description">{description}</p>}
      </div>
    );
  }

  return (
    <div className={`game-variable ${id ? `game-variable--${id}` : ""}${isProminent ? " game-variable--prominent" : ""}`}>
      {resolvedBackgroundImage && (
        <div className="game-variable-image" style={{ backgroundImage: `url(${resolvedBackgroundImage})` }} />
      )}
      <div className="game-variable-content">
        <span className="game-variable-caption">{caption}</span>
        <strong className="game-variable-value">{resolvedValue}</strong>
        {description && <p className="game-variable-description">{description}</p>}
      </div>
    </div>
  );
}
