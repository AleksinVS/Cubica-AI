import type {
  CubicaJsonValue,
  CubicaSurface,
  CubicaSurfaceAction,
  CubicaSurfaceComponent
} from "@cubica/contracts-ai";

interface CubicaSurfaceRendererProps {
  readonly surface: CubicaSurface;
  readonly isPending?: boolean;
  readonly onAction: (action: CubicaSurfaceAction) => void;
}

interface SurfaceComponentRendererProps {
  readonly component: CubicaSurfaceComponent;
  readonly isPending: boolean;
  readonly onAction: (action: CubicaSurfaceAction) => void;
}

/**
 * Web renderer for validated `CubicaSurface` payloads.
 *
 * The renderer consumes JSON-only Cubica contracts. It never executes HTML,
 * scripts, React component references or provider-specific messages produced
 * by an AI agent.
 */
export function CubicaSurfaceRenderer({ surface, isPending = false, onAction }: CubicaSurfaceRendererProps) {
  return (
    <section className="cubica-surface" aria-busy={isPending}>
      {surface.title ? <h1>{surface.title}</h1> : null}
      <SurfaceComponentRenderer component={surface.root} isPending={isPending} onAction={onAction} />
    </section>
  );
}

function SurfaceComponentRenderer({ component, isPending, onAction }: SurfaceComponentRendererProps) {
  switch (component.kind) {
    case "cubica.text":
      return <TextComponent component={component} />;
    case "cubica.button":
      return <ButtonComponent component={component} isPending={isPending} onAction={onAction} />;
    case "cubica.choiceList":
      return <ChoiceListComponent component={component} isPending={isPending} onAction={onAction} />;
    case "cubica.metricsBar":
      return <MetricsBarComponent component={component} />;
    case "cubica.hintPanel":
      return <HintPanelComponent component={component} isPending={isPending} onAction={onAction} />;
    case "cubica.cardGrid":
      return <CardGridComponent component={component} isPending={isPending} onAction={onAction} />;
    default:
      return <UnsupportedComponent kind={component.kind} />;
  }
}

function TextComponent({ component }: { readonly component: CubicaSurfaceComponent }) {
  const text = readString(component.props.text) ?? readString(component.props.label) ?? readString(component.props.title);
  if (!text) {
    return null;
  }
  return <p className="cubica-surface-text">{text}</p>;
}

function ButtonComponent({ component, isPending, onAction }: SurfaceComponentRendererProps) {
  const action = component.actions?.[0];
  const label = action?.label ?? readString(component.props.label) ?? readString(component.props.caption) ?? component.id;
  const executable = isPlayerWebSurfaceAction(action);
  return (
    <button
      className="action-button cubica-surface-button"
      type="button"
      disabled={isPending || !executable}
      onClick={() => executable && onAction(action)}
    >
      {label}
    </button>
  );
}

function ChoiceListComponent({ component, isPending, onAction }: SurfaceComponentRendererProps) {
  const label = readString(component.props.label) ?? readString(component.props.title);
  const choices = readRecordArray(component.props.choices);
  const actions = component.actions ?? [];

  return (
    <div className="cubica-choice-list">
      {label ? <p className="cubica-choice-list-label">{label}</p> : null}
      <div className="cubica-choice-list-options">
        {choices.length > 0 ? choices.map((choice, index) => {
          const action = actions[index] ?? actions[0];
          const choiceLabel = readString(choice.label) ?? readString(choice.title) ?? readString(choice.id) ?? `Choice ${index + 1}`;
        return (
            <button
              className="action-button cubica-choice-option"
              type="button"
              key={readString(choice.id) ?? `${component.id}-${index}`}
              disabled={isPending || !isPlayerWebSurfaceAction(action)}
              onClick={() => isPlayerWebSurfaceAction(action) && onAction(action)}
            >
              {choiceLabel}
            </button>
          );
        }) : (
          <UnsupportedComponent kind="cubica.choiceList:empty" />
        )}
      </div>
      <RenderChildren component={component} isPending={isPending} onAction={onAction} />
    </div>
  );
}

function MetricsBarComponent({ component }: { readonly component: CubicaSurfaceComponent }) {
  const metrics = readRecordArray(component.props.metrics);
  if (metrics.length === 0) {
    return null;
  }

  return (
    <dl className="cubica-metrics-bar">
      {metrics.map((metric, index) => (
        <div className="cubica-metric-item" key={readString(metric.id) ?? `metric-${index}`}>
          <dt>{readString(metric.label) ?? readString(metric.id) ?? `Metric ${index + 1}`}</dt>
          <dd>{displayJsonValue(metric.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function HintPanelComponent({ component, isPending, onAction }: SurfaceComponentRendererProps) {
  const title = readString(component.props.title) ?? readString(component.props.label);
  const body = readString(component.props.body) ?? readString(component.props.text);

  return (
    <aside className="cubica-hint-panel">
      {title ? <h2>{title}</h2> : null}
      {body ? <p>{body}</p> : null}
      <RenderChildren component={component} isPending={isPending} onAction={onAction} />
    </aside>
  );
}

function CardGridComponent({ component, isPending, onAction }: SurfaceComponentRendererProps) {
  const cards = readRecordArray(component.props.cards);
  const actions = component.actions ?? [];

  return (
    <div className="cubica-card-grid">
      {cards.map((card, index) => {
        const action = actions[index] ?? actions[0];
        const executable = isPlayerWebSurfaceAction(action);
        return (
          <button
            className="cubica-surface-card"
            type="button"
            key={readString(card.id) ?? `${component.id}-${index}`}
            disabled={isPending || !executable}
            onClick={() => executable && onAction(action)}
          >
            <strong>{readString(card.title) ?? readString(card.label) ?? `Card ${index + 1}`}</strong>
            {readString(card.summary) ? <span>{readString(card.summary)}</span> : null}
          </button>
        );
      })}
      <RenderChildren component={component} isPending={isPending} onAction={onAction} />
    </div>
  );
}

function RenderChildren({ component, isPending, onAction }: SurfaceComponentRendererProps) {
  if (!component.children?.length) {
    return null;
  }
  return (
    <>
      {component.children.map((child) => (
        <SurfaceComponentRenderer
          key={child.id}
          component={child}
          isPending={isPending}
          onAction={onAction}
        />
      ))}
    </>
  );
}

export function isPlayerWebSurfaceAction(
  action: CubicaSurfaceAction | undefined
): action is CubicaSurfaceAction {
  return action?.kind === "agentTurn" || action?.kind === "runtimeAction";
}

function UnsupportedComponent({ kind }: { readonly kind: string }) {
  return (
    <div className="cubica-surface-diagnostic" role="status">
      Компонент Cubica Surface не поддержан в player-web: <strong>{kind}</strong>
    </div>
  );
}

function readString(value: CubicaJsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRecordArray(value: CubicaJsonValue | undefined): Array<Record<string, CubicaJsonValue>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isJsonRecord);
}

function isJsonRecord(value: CubicaJsonValue): value is Record<string, CubicaJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function displayJsonValue(value: CubicaJsonValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
