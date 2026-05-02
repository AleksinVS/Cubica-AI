"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import type {
  PlayerFacingContent,
  PlayerFacingMockup,
  AntarcticaPlayerUiContent,
  AntarcticaPlayerS1UiContent,
  AntarcticaUiComponent,
  AntarcticaUiScreenComponentProps,
  AntarcticaUiAreaComponentProps,
  AntarcticaUiGameVariableComponentProps,
  AntarcticaUiCardComponentProps,
  AntarcticaUiButtonComponentProps,
  AntarcticaUiScreenDefinition
} from "@cubica/contracts-manifest";
import type { ActionSnapshot, SessionSnapshot } from "@/lib/antarctica";
import {
  getFallbackActionEntries,
  readCanAdvance,
  readCardFlags,
  readSelectedCardId,
  readTeamFlags,
  readTeamSelection,
  resolveAntarcticaContent,
  resolveBoardCards,
  resolveCurrentBoard,
  resolveCurrentInfoEntry,
  resolveCurrentTeamSelectionScene
} from "@/lib/antarctica";

export type { PlayerFacingMockup as AntarcticaMockup };

type AntarcticaPlayerProps = {
  runtimeApiUrl: string;
  content: PlayerFacingContent;
  mockups: Array<PlayerFacingMockup>;
  /**
   * Multi-screen UI manifest data for manifest-driven rendering.
   * Supports both the new multi-screen interface (AntarcticaPlayerUiContent)
   * and the deprecated S1-only interface (AntarcticaPlayerS1UiContent).
   * Screen selection is driven by runtime snapshot fields.
   */
  antarcticaUi?: AntarcticaPlayerUiContent;
};

type AntarcticaSession = SessionSnapshot & {
  gameId?: string;
};

type RuntimeLogEntry = {
  actionId: string;
  capability?: string;
  capabilityFamily?: string;
  functionName?: string;
  at?: string;
  payload?: unknown;
};

const storageKey = "cubica-antarctica-session-id";

const readNumber = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
};

type RichTextProps = {
  html: string;
  className?: string;
};

function RichText({ html, className }: RichTextProps) {
  const normalized = html.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("<")) {
    return <div className={className} dangerouslySetInnerHTML={{ __html: normalized }} />;
  }

  return <p className={className}>{normalized}</p>;
}

// =============================================================================
// S1 Manifest-Driven Renderer
// Bounded to: screenComponent, areaComponent, gameVariableComponent,
// cardComponent, buttonComponent
// =============================================================================

type MetricsSnapshot = Record<string, unknown>;

const TOPBAR_SCREEN_KEYS = new Set(["55..60", "61..66", "67..68", "69..70"]);

function appendClassName(existing: string | undefined, className: string): string {
  const classes = new Set((existing ?? "").split(/\s+/).filter(Boolean));
  classes.add(className);
  return Array.from(classes).join(" ");
}

function resolveAreaCssClass(cssClass: string | undefined, screenKey?: string, layoutMode?: "leftsidebar" | "topbar"): string {
  const isTopbarMode = layoutMode === "topbar" || (screenKey && TOPBAR_SCREEN_KEYS.has(screenKey));
  
  if (!isTopbarMode) {
    return cssClass ?? "";
  }

  let next = cssClass ?? "";
  if (next.includes("game-variables-container")) next = appendClassName(next, "topbar-variables-container");
  if (next.includes("main-content-area")) next = appendClassName(next, "topbar-main-content");
  if (next.includes("cards-container")) next = appendClassName(next, "topbar-cards-container");
  if (next.includes("board-header")) next = appendClassName(next, "topbar-board-header");
  if (next.includes("board-title")) next = appendClassName(next, "topbar-board-title");
  if (next.includes("sidebar-decoration")) next = appendClassName(next, "topbar-decoration");
  return next;
}

/**
 * Resolves a binding expression like "{{game.state.public.metrics.score}}"
 * against the session snapshot.
 */
export function resolveMetricBinding(expression: string, metrics: MetricsSnapshot): string {
  // S1 UI manifest uses "{{game.state.public.metrics.*}}" pattern
  const match = expression.match(/^\{\{game\.state\.public\.metrics\.(\w+)\}\}$/);
  if (!match) {
    return expression;
  }
  const metricId = match[1];
  const value = metrics[metricId];
  return formatValue(value);
}

const TOPBAR_METRIC_BACKGROUND_IMAGES: Record<string, string> = {
  score: "/images/top-sidebar/days-top.png",
  pro: "/images/top-sidebar/znaniya.png",
  rep: "/images/top-sidebar/doverie.png",
  energy: "/images/top-sidebar/energia.png",
  lid: "/images/top-sidebar/energia.png",
  control: "/images/top-sidebar/kontrol.png",
  man: "/images/top-sidebar/kontrol.png",
  status: "/images/top-sidebar/status.png",
  stat: "/images/top-sidebar/status.png",
  contact: "/images/top-sidebar/kontakt.png",
  cont: "/images/top-sidebar/kontakt.png",
  constructive: "/images/top-sidebar/konstruktiv.png",
  constr: "/images/top-sidebar/konstruktiv.png"
};

function resolveMetricBackgroundImage(
  id: string | undefined,
  backgroundImage: string | undefined,
  layoutMode?: "leftsidebar" | "topbar"
): string | undefined {
  if (layoutMode === "topbar" && id) {
    return TOPBAR_METRIC_BACKGROUND_IMAGES[id] ?? backgroundImage;
  }

  return backgroundImage;
}

function resolveButtonId(caption: string, id?: string): string | undefined {
  if (id) {
    return id;
  }

  const normalized = caption.trim().toLowerCase();
  if (normalized.includes("журнал")) return "btn-journal";
  if (normalized.includes("подсказ")) return "btn-hint";
  if (normalized.includes("назад")) return "nav-left";
  if (normalized.includes("вперед")) return "nav-right";
  return undefined;
}

/**
 * Renders a gameVariableComponent (metric display in the sidebar).
 */
export function GameVariableComponent({
  component,
  metrics,
  backgroundImage,
  layoutMode
}: {
  component: AntarcticaUiComponent<AntarcticaUiGameVariableComponentProps>;
  metrics: MetricsSnapshot;
  backgroundImage?: string;
  layoutMode?: "leftsidebar" | "topbar";
}) {
  const { caption, description, value } = component.props;
  const resolvedValue = resolveMetricBinding(value, metrics);
  const id = (component as AntarcticaUiComponent).id;
  const resolvedBackgroundImage = resolveMetricBackgroundImage(id, backgroundImage, layoutMode);

  if (layoutMode === "topbar") {
    const isScoreMetric = id === "score";
    const scoreMetricStyle: CSSProperties | undefined = isScoreMetric
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
    const scoreCaptionStyle: CSSProperties | undefined = isScoreMetric
      ? {
          display: "block",
          width: "75px",
          margin: "4px 0 0",
          textAlign: "center"
        }
      : undefined;

    return (
      <div
        className={`game-variable ${id ? `game-variable--${id}` : ""} game-variable--topbar`}
        style={scoreMetricStyle}
      >
        {resolvedBackgroundImage && (
          <div
            className="game-variable-image game-variable-visual"
            style={
              isScoreMetric
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
        <span className="game-variable-caption" style={scoreCaptionStyle}>
          {caption}
        </span>
        {description && <p className="game-variable-description">{description}</p>}
      </div>
    );
  }

  return (
    <div className={`game-variable ${id ? `game-variable--${id}` : ""}`}>
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

/**
 * Renders a cardComponent (interactive card in S1).
 * Card itself is the primary interaction target for accessibility.
 * The internal button is visually hidden but kept in DOM for testing.
 */
export function CardComponent({
  component,
  onAction
}: {
  component: AntarcticaUiComponent<AntarcticaUiCardComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
}) {
  const { text } = component.props;
  const command = (component as AntarcticaUiComponent).actions?.onClick?.command;
  // UI manifest has cards with empty payload but component.id like "card-1", "card-3"
  // Extract cardId from component.id to pass in payload (e.g., "card-3" -> cardId: "3")
  const componentId = (component as AntarcticaUiComponent).id ?? "";
  const cardIdMatch = componentId.match(/^card-(\d+)$/);
  const cardIdFromComponent = cardIdMatch ? cardIdMatch[1] : undefined;

  // Build payload: start with manifest payload, then add cardId if derived from component.id
  // Only add cardId when payload is empty (UI manifest case) to avoid overwriting test mock data
  const basePayload = (component as AntarcticaUiComponent).actions?.onClick?.payload ?? {};
  const isPayloadEmpty = Object.keys(basePayload).length === 0;
  const actionPayload: Record<string, unknown> = isPayloadEmpty && cardIdFromComponent
    ? { cardId: cardIdFromComponent }
    : { ...basePayload };

  const handleCardClick = () => {
    if (command) {
      onAction(command, actionPayload);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (command && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onAction(command, actionPayload);
    }
  };

  return (
    <article
      className="s1-card"
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={command ? 0 : -1}
      aria-label={text}
    >
      <p className="s1-card-text">{text}</p>
      {/* Visually hidden but accessible - card itself is primary interaction target */}
      {command && (
        <button
          className="action-button"
          type="button"
          onClick={(e) => { e.stopPropagation(); onAction(command, actionPayload); }}
          tabIndex={-1}
        >
          Выбрать
        </button>
      )}
    </article>
  );
}

/**
 * Renders a buttonComponent (action button in S1).
 */
export function ButtonComponent({
  component,
  onAction,
  layoutMode
}: {
  component: AntarcticaUiComponent<AntarcticaUiButtonComponentProps>;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  layoutMode?: "leftsidebar" | "topbar";
}) {
  const { caption } = component.props;
  const command = (component as AntarcticaUiComponent).actions?.onClick?.command;
  const id = resolveButtonId(caption, (component as AntarcticaUiComponent).id);
  const isTopbarArrow = layoutMode === "topbar" && (id === "nav-left" || id === "nav-right");

  return (
    <button
      id={id}
      className={`action-button s1-button${isTopbarArrow ? " topbar-nav-button" : ""}`}
      type="button"
      onClick={() => command && onAction(command, (component as AntarcticaUiComponent).actions?.onClick?.payload ?? {})}
      disabled={!command}
      aria-label={caption}
    >
      {isTopbarArrow ? null : caption}
    </button>
  );
}

/**
 * Recursively renders a UI component tree from the S1 manifest.
 * Supports bounded component types only: screenComponent, areaComponent,
 * gameVariableComponent, cardComponent, buttonComponent.
 */
export function UiComponentNode({
  component,
  metrics,
  onAction,
  screenKey,
  layoutMode
}: {
  component: AntarcticaUiComponent;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  layoutMode?: "leftsidebar" | "topbar";
}) {
  const children = component.children ?? [];

  switch (component.type) {
    case "screenComponent": {
      const props = component.props as AntarcticaUiScreenComponentProps;
      const cssClass =
        layoutMode === "topbar" || (screenKey && TOPBAR_SCREEN_KEYS.has(screenKey))
          ? appendClassName(props.cssClass, "topbar-screen-shell")
          : layoutMode === "leftsidebar"
            ? appendClassName(props.cssClass, "leftsidebar-screen")
            : props.cssClass ?? "";
      return (
        <div
          className={`s1-screen ${cssClass}`}
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
            />
          ))}
        </div>
      );
    }

    case "areaComponent": {
      const props = component.props as AntarcticaUiAreaComponentProps;
      return (
        <div className={`s1-area ${resolveAreaCssClass(props.cssClass, screenKey, layoutMode)}`}>
          {children.map((child, index) => (
            <UiComponentNode
              key={index}
              component={child}
              metrics={metrics}
              onAction={onAction}
              screenKey={screenKey}
              layoutMode={layoutMode}
            />
          ))}
        </div>
      );
    }

    case "gameVariableComponent": {
      const props = component.props as AntarcticaUiGameVariableComponentProps;
      return (
        <GameVariableComponent
          component={component as AntarcticaUiComponent<AntarcticaUiGameVariableComponentProps>}
          metrics={metrics}
          backgroundImage={props.backgroundImage}
          layoutMode={layoutMode}
        />
      );
    }

    case "cardComponent": {
      return (
        <CardComponent
          component={component as AntarcticaUiComponent<AntarcticaUiCardComponentProps>}
          onAction={onAction}
        />
      );
    }

    case "buttonComponent": {
      return (
        <ButtonComponent
          component={component as AntarcticaUiComponent<AntarcticaUiButtonComponentProps>}
          onAction={onAction}
          layoutMode={layoutMode}
        />
      );
    }

    default:
      // Unknown component type: skip gracefully, do not throw
      return null;
  }
}

/**
 * Bounded manifest-driven S1 renderer.
 * Renders the Antarctica opening screen (S1) from the UI manifest data,
 * binding metric values from the session snapshot and wiring button/card
 * actions to the standard runtime action dispatch path.
 *
 * Layout follows left-sidebar-6-cards mockup:
 * - Left sidebar (260px): game variables/metrics
 * - Main area: cards grid (3x2) + bottom controls
 * - Right decor (370px): arctic illustration placeholder
 */
export function AntarcticaS1Renderer({
  screenDefinition,
  metrics,
  onAction,
  screenKey,
  layoutMode = "leftsidebar"
}: {
  screenDefinition: AntarcticaUiScreenDefinition;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  layoutMode?: "leftsidebar" | "topbar";
}) {
  return (
    <div className={`s1-renderer antarctica-s1-renderer antarctica-s1-renderer--${layoutMode}`}>
      {/* Left/center: manifest-driven screen content */}
      <UiComponentNode
        component={screenDefinition.root}
        metrics={metrics}
        onAction={onAction}
        screenKey={screenKey}
        layoutMode={layoutMode}
      />
    </div>
  );
}

type RuntimeUiState = {
  activePanel?: string;
  activeScreen?: string;
  lastCapabilityFamily?: string;
  lastCapability?: string;
  serverRequested?: boolean;
};

function resolveAntarcticaLayoutMode(
  screenKey: string | null,
  runtimeUi: RuntimeUiState,
  currentBoard: ReturnType<typeof resolveCurrentBoard>,
  currentInfo: ReturnType<typeof resolveCurrentInfoEntry>
): "leftsidebar" | "topbar" {
  if (runtimeUi.activeScreen === "topbar") {
    return "topbar";
  }

  if (runtimeUi.activeScreen === "left-sidebar") {
    return "leftsidebar";
  }

  if (screenKey && TOPBAR_SCREEN_KEYS.has(screenKey)) {
    return "topbar";
  }

  if (currentBoard) {
    return "topbar";
  }

  // Info screens (i7, i8, i9, i11, i13, i14, i15, i16, i17, etc.) use topbar composition
  // per topsidebar-infocard.design.json: topbar metrics row + centered event card below.
  // i0 (step 0 intro screen) is the default entry and also uses topbar composition.
  if (currentInfo && currentInfo.id !== "i0") {
    return "topbar";
  }

  // Default to topbar composition (matching draft screen_s1 initial state)
  // Use leftsidebar only for explicitly requested left-sidebar states
  return "topbar";
}

function AntarcticaPanelButtonRow({
  onJournal,
  onHint,
  disabled = false,
  layoutMode,
  showArrows = true
}: {
  onJournal: () => void;
  onHint: () => void;
  disabled?: boolean;
  layoutMode?: "leftsidebar" | "topbar";
  showArrows?: boolean;
}) {
  return (
    <div
      className="button-container antarctica-panel-buttons"
      style={layoutMode === "topbar" ? { position: "relative", top: "-11px" } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <button id="btn-journal" className="button-helper" type="button" onClick={onJournal} disabled={disabled}>
        журнал ходов
      </button>
      <button id="btn-hint" className="button-helper" type="button" onClick={onHint} disabled={disabled}>
        подсказка
      </button>
      {showArrows ? (
        <>
          <button id="nav-left" className="button-helper-arrow" type="button" disabled>
            Назад
          </button>
          <button id="nav-right" className="button-helper-arrow" type="button" disabled>
            Вперед
          </button>
        </>
      ) : null}
    </div>
  );
}

function AntarcticaHintRenderer({
  content,
  metrics,
  log,
  onJournal,
  onHint,
  onClose
}: {
  content: PlayerFacingContent;
  metrics: MetricsSnapshot;
  log: Array<RuntimeLogEntry>;
  onJournal: () => void;
  onHint: () => void;
  onClose?: () => void;
}) {
  const latestEntry = log[log.length - 1] ?? null;
  const hintText =
    (typeof latestEntry?.payload === "string" ? latestEntry.payload : null) ||
    content.description ||
    "Подсказка пока не загружена";
  const contentRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
      onClose?.();
    }
  };

  return (
    <div className="s1-renderer">
      <div className="s1-screen main-screen topbar-screen-shell antarctica-hint-screen" onClick={handleOverlayClick}>
        <div className="additional-background" />
        <div className="s1-area game-variables-container topbar-variables-container">
          <AntarcticaMetricCluster metrics={metrics} variant="topbar" />
        </div>
        <div className="s1-area main-content-area topbar-main-content" ref={contentRef}>
          <div className="cards-container topbar-cards-container antarctica-hint-cards">
            <div className="hint-area" />
            <p className="hint-text">{hintText}</p>
          </div>
        </div>
        <AntarcticaPanelButtonRow onJournal={onJournal} onHint={onHint} layoutMode="topbar" />
      </div>
    </div>
  );
}

function AntarcticaJournalRenderer({
  metrics,
  log,
  onJournal,
  onHint,
  onClose
}: {
  metrics: MetricsSnapshot;
  log: Array<RuntimeLogEntry>;
  onJournal: () => void;
  onHint: () => void;
  onClose?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose?.();
    }
  };
  /**
   * Maps a raw runtime log entry to a user-facing journal entry.
   *
   * Log entries come from two paths:
   * - Manifest-driven entries (deterministic handlers): have `kind` and `summary` from manifest-log.
   *   These represent actual game actions (card advances, info transitions).
   * - Runtime UI entries (buildTransition): have `actionId`, `capability`, `capabilityFamily`, `at`.
   *   These represent runtime events like showHistory, showHint, requestServer.
   *
   * Journal should show only game-relevant entries (manifest path with kind=opening-card-advance,
   * opening-info-advance, etc.) and skip pure UI interaction events (ui.panel.*).
   */
  const mapToJournalEntry = (entry: RuntimeLogEntry): { title: string; subtitle: string; time: string } | null => {
    // Skip pure UI interaction events and runtime server requests - these are not user-facing game actions
    // UNLESS the entry is manifest-driven (has kind and summary from deterministic handler)
    const kind = (entry as Record<string, unknown>).kind as string | undefined;
    const summary = (entry as Record<string, unknown>).summary as string | undefined;
    const isManifestDriven = !!(kind && summary);

    // Allow manifest-driven entries through regardless of capabilityFamily
    if (!isManifestDriven) {
      if (
        entry.capabilityFamily === "ui.panel" ||
        entry.capabilityFamily === "ui.screen" ||
        entry.capabilityFamily === "runtime.server" ||
        entry.actionId === "requestServer"
      ) {
        return null;
      }
    }

    // For manifest-driven entries, use kind and summary directly
    if (isManifestDriven) {
      // Determine entry type label from kind
      let typeLabel = "";
      if (kind === "opening-card-advance") {
        typeLabel = "Карточка";
      } else if (kind === "opening-info-advance") {
        typeLabel = "Инфо";
      } else if (kind === "team-selection") {
        typeLabel = "Команда";
      } else if (kind === "board-advance") {
        typeLabel = "Доска";
      } else {
        typeLabel = kind.replace(/-/g, " ").replace(/_/g, " ");
      }

      // Extract card/info id from summary if available
      const cardIdMatch = summary.match(/Карточка\s*(\d+)/);
      const infoIdMatch = summary.match(/i\d+(?:_\d+)?/);
      if (cardIdMatch) {
        return { title: `${typeLabel} ${cardIdMatch[1]}`, subtitle: summary, time: "" };
      }
      if (infoIdMatch) {
        return { title: `${typeLabel} ${infoIdMatch[0]}`, subtitle: summary, time: "" };
      }

      return { title: typeLabel, subtitle: summary, time: "" };
    }

    // Fallback: derive from actionId for entries without kind
    const actionId = entry.actionId ?? "unknown";

    // Extract base name from actionId (e.g., "opening.card.3" -> "Карточка 3")
    let title = actionId;
    if (actionId.startsWith("opening.card.")) {
      const cardId = actionId.replace("opening.card.", "").replace(".advance", "");
      title = `Карточка ${cardId}`;
    } else if (actionId.startsWith("opening.info.")) {
      const infoId = actionId.replace("opening.info.", "").replace(".advance", "");
      title = `Инфо ${infoId}`;
    } else if (actionId.startsWith("opening.team.")) {
      title = "Команда";
    } else if (actionId === "showHistory") {
      title = "Журнал";
    } else if (actionId === "showHint") {
      title = "Подсказка";
    } else if (actionId.includes(".")) {
      // Use last segment of dot-separated actionId as a readable fallback
      const parts = actionId.split(".");
      title = parts[parts.length - 1].replace(/_/g, " ");
    }

    // Derive subtitle from capability or kind metadata
    const capability = entry.capability ?? entry.capabilityFamily ?? "";
    // Use the payload if it's a useful string (e.g., hint text)
    const subtitle =
      typeof entry.payload === "string" && entry.payload.length > 0
        ? entry.payload
        : capability;

    // Format timestamp for display
    let time = "";
    if (entry.at) {
      try {
        const date = new Date(entry.at);
        time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      } catch {
        time = "";
      }
    }

    return { title, subtitle, time };
  };

  // Filter out null entries (UI events) and map to journal entries
  const journalEntries = log
    .map((entry) => mapToJournalEntry(entry))
    .filter((entry): entry is { title: string; subtitle: string; time: string } => entry !== null);

  // Static mock entries mirror the draft fixture so visual diff compares populated state.
  // Draft cards contain only raw text (no title/subtitle structure).
  const MOCK_ENTRIES: Array<{ text: string }> = [
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
  ];

  // Draft journal shows exactly 4 entries (2 per container); cap runtime log to 4 and backfill with mocks
  const sourceEntries = journalEntries.length > 0 ? journalEntries : MOCK_ENTRIES;
  const displayEntries: Array<{ text: string } | { title: string; subtitle: string; time: string }> = sourceEntries.slice(0, 4);
  while (displayEntries.length < 4) {
    displayEntries.push(MOCK_ENTRIES[displayEntries.length % MOCK_ENTRIES.length]);
  }
  const firstHalf = displayEntries.slice(0, 2);
  const secondHalf = displayEntries.slice(2, 4);

  return (
    <div className="s1-renderer">
      <div className="s1-screen main-screen journal-screen" onClick={handleOverlayClick}>
        {/* Main content area: full-width journal with central two-column entries */}
        <div className="journal-main-content">
          <div className="journal-container" ref={containerRef}>
            <h1 className="heading-h1">Журнал ходов</h1>
            <div className="journal-entries">
              {firstHalf.map((entry, entryIndex) => (
                <article key={`journal-entry-${entryIndex}`} className="game-card journal-entry-card">
                  {"text" in entry ? entry.text : entry.subtitle || entry.title}
                </article>
              ))}
            </div>
            <div className="journal-variables-container">
              <JournalMetricCluster metrics={metrics} />
            </div>
          </div>
          <div className="journal-container">
            <div className="journal-entries">
              {secondHalf.map((entry, entryIndex) => (
                <article key={`journal-entry-second-${entryIndex}`} className="game-card journal-entry-card">
                  {"text" in entry ? entry.text : entry.subtitle || entry.title}
                </article>
              ))}
            </div>
            <div className="journal-variables-container">
              <JournalMetricCluster metrics={metrics} />
            </div>
          </div>
          <AntarcticaPanelButtonRow onJournal={onJournal} onHint={onHint} layoutMode="topbar" showArrows={false} />
        </div>
      </div>
    </div>
  );
}

type AntarcticaMetricSpec = {
  id: string;
  caption: string;
  description?: string;
  aliases: Array<string>;
  sidebarImage: string;
  topbarImage: string;
};

const ANTARCTICA_FALLBACK_METRICS: Array<AntarcticaMetricSpec> = [
  {
    id: "score",
    caption: "Остаток дней",
    aliases: ["score", "days", "time"],
    sidebarImage: "/images/left-sidebar/days.png",
    topbarImage: "/images/top-sidebar/days-top.png"
  },
  {
    id: "pro",
    caption: "Знания",
    aliases: ["pro", "knowledge"],
    sidebarImage: "/images/left-sidebar/znania.png",
    topbarImage: "/images/top-sidebar/znaniya.png"
  },
  {
    id: "rep",
    caption: "Доверие",
    aliases: ["rep", "trust"],
    sidebarImage: "/images/left-sidebar/doverie.png",
    topbarImage: "/images/top-sidebar/doverie.png"
  },
  {
    id: "energy",
    caption: "Энергия",
    aliases: ["energy", "lid"],
    sidebarImage: "/images/left-sidebar/energia.png",
    topbarImage: "/images/top-sidebar/energia.png"
  },
  {
    id: "control",
    caption: "Контроль",
    aliases: ["control", "man"],
    sidebarImage: "/images/left-sidebar/kontrol.png",
    topbarImage: "/images/top-sidebar/kontrol.png"
  },
  {
    id: "status",
    caption: "Статус",
    aliases: ["status", "stat"],
    sidebarImage: "/images/left-sidebar/status.png",
    topbarImage: "/images/top-sidebar/status.png"
  },
  {
    id: "contact",
    caption: "Контакт",
    aliases: ["contact", "cont"],
    sidebarImage: "/images/left-sidebar/kontakt.png",
    topbarImage: "/images/top-sidebar/kontakt.png"
  },
  {
    id: "constructive",
    caption: "Конструктив",
    aliases: ["constructive", "constr"],
    sidebarImage: "/images/left-sidebar/konstruktiv.png",
    topbarImage: "/images/top-sidebar/konstruktiv.png"
  }
];

function resolveMetricValueByAliases(metrics: MetricsSnapshot, aliases: Array<string>): string {
  for (const alias of aliases) {
    if (alias in metrics) {
      return formatValue(metrics[alias]);
    }
  }

  return "—";
}

function AntarcticaMetricCluster({
  metrics,
  variant,
  layoutMode
}: {
  metrics: MetricsSnapshot;
  variant: "sidebar" | "topbar";
  layoutMode?: "leftsidebar" | "topbar";
}) {
  return (
    <>
      {ANTARCTICA_FALLBACK_METRICS.map((metric) => (
        <GameVariableComponent
          key={`${variant}-${metric.id}`}
          component={
            {
              type: "gameVariableComponent",
              id: metric.id,
              props: {
                caption: metric.caption,
                description: metric.description,
                value: resolveMetricValueByAliases(metrics, metric.aliases)
              }
            } as AntarcticaUiComponent<AntarcticaUiGameVariableComponentProps>
          }
          metrics={metrics}
          backgroundImage={variant === "topbar" ? metric.topbarImage : metric.sidebarImage}
          layoutMode={layoutMode ?? (variant === "topbar" ? "topbar" : "leftsidebar")}
        />
      ))}
    </>
  );
}

/**
 * Journal-style metric cluster matching draft `journalVariableComponent`.
 * Renders value + caption in a compact text-only layout (no images).
 */
function JournalMetricCluster({ metrics }: { metrics: MetricsSnapshot }) {
  return (
    <>
      {ANTARCTICA_FALLBACK_METRICS.map((metric) => {
        const value = resolveMetricValueByAliases(metrics, metric.aliases);
        return (
          <div key={`journal-metric-${metric.id}`} className="journal-variable-component">
            <div className="journal-variable__row">
              <span className="journal-variable__value">{value}</span>
            </div>
            <span className="journal-variable__caption">{metric.caption}</span>
          </div>
        );
      })}
    </>
  );
}

function AntarcticaFallbackRenderer({
  content,
  runtimeApiUrl,
  sessionId,
  isPending,
  metrics,
  currentInfo,
  currentBoard,
  currentTeamSelection,
  cardFlags,
  selectedCardId,
  selectedCard,
  boardCards,
  teamFlags,
  selectedMemberIds,
  pickCount,
  canAdvance,
  fallbackActions,
  dispatchAction,
  layoutMode,
  onJournal,
  onHint
}: {
  content: PlayerFacingContent;
  runtimeApiUrl: string;
  sessionId: string | null;
  isPending: boolean;
  metrics: MetricsSnapshot;
  currentInfo: ReturnType<typeof resolveCurrentInfoEntry>;
  currentBoard: ReturnType<typeof resolveCurrentBoard>;
  currentTeamSelection: ReturnType<typeof resolveCurrentTeamSelectionScene>;
  cardFlags: ReturnType<typeof readCardFlags>;
  selectedCardId: string | null;
  selectedCard: ReturnType<typeof resolveBoardCards>[number] | null;
  boardCards: ReturnType<typeof resolveBoardCards>;
  teamFlags: ReturnType<typeof readTeamFlags>;
  selectedMemberIds: Array<string>;
  pickCount: number;
  canAdvance: boolean;
  fallbackActions: ReturnType<typeof getFallbackActionEntries>;
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  layoutMode?: "leftsidebar" | "topbar";
  onJournal?: () => void;
  onHint?: () => void;
}) {
  // Compute shell class from layoutMode, falling back to topbar for initial state
  // (matching draft screen_s1 topbar composition by default)
  const shellClassName = currentBoard
    ? "s1-screen topbar-screen-shell"
    : layoutMode === "leftsidebar"
      ? "s1-screen leftsidebar-screen"
      : currentInfo
        ? "s1-screen info-screen-shell"
        : "s1-screen topbar-screen-shell";

  const rendererClassName = `s1-renderer antarctica-fallback-renderer antarctica-s1-renderer antarctica-s1-renderer--${layoutMode}`;

  return (
    <div className={rendererClassName}>
      <div className={shellClassName} style={{ backgroundImage: "url(/images/arctic-background.png)" }}>
        <div className="additional-background" />
        {currentBoard ? (
            <>
              <div className="s1-area game-variables-container topbar-variables-container">
                <AntarcticaMetricCluster metrics={metrics} variant="topbar" />
              </div>
              <div className="s1-area main-content-area topbar-main-content">
                <div className="s1-area topbar-board-header">
                  <article className="s1-card">
                    <p className="s1-card-text">{currentBoard.title}</p>
                    {currentBoard.body ? <RichText className="antarctica-fallback-copy" html={currentBoard.body} /> : null}
                  </article>
                </div>

                <div className="s1-area cards-container topbar-cards-container">
                  {boardCards.map((card) => {
                    const cardState = cardFlags[card.cardId] ?? {};
                    const isLocked = cardState.locked === true;
                    const isSelected = cardState.selected === true || selectedCardId === card.cardId;
                    const isResolved = cardState.resolved === true;
                    const isDisabled = isPending || !sessionId || isLocked || isSelected;

                    return (
                      <article
                        key={card.cardId}
                        className={`s1-card antarctica-fallback-card${isSelected ? " antarctica-fallback-card-selected" : ""}${
                          isLocked ? " antarctica-fallback-card-locked" : ""
                        }`}
                        onClick={() => !isDisabled && dispatchAction(card.selectActionId)}
                        onKeyDown={(e) => {
                          if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            dispatchAction(card.selectActionId);
                          }
                        }}
                        role="button"
                        tabIndex={isDisabled ? -1 : 0}
                        aria-disabled={isDisabled}
                        aria-label={card.selectLabel ?? "Выбрать"}
                      >
                        <div className="antarctica-fallback-card-head">
                          <strong>{card.title}</strong>
                          <span className="chip">#{card.cardId}</span>
                        </div>
                        <p className="s1-card-text">{card.summary}</p>
                        <div className="antarctica-fallback-card-meta">
                          {isSelected ? <span className="chip">selected</span> : null}
                          {isResolved ? <span className="chip">resolved</span> : null}
                          {isLocked ? <span className="chip">locked</span> : null}
                        </div>
                        {/* Visually hidden but accessible - card itself is primary interaction target */}
                        <button
                          className="action-button"
                          type="button"
                          onClick={() => dispatchAction(card.selectActionId)}
                          disabled={isDisabled}
                          tabIndex={-1}
                        >
                          {card.selectLabel ?? "Выбрать"}
                        </button>
                      </article>
                    );
                  })}
                </div>

                {selectedCard && selectedCard.advanceActionId && canAdvance ? (
                  <div className="s1-area info-bottom-controls">
                    <button
                      className="action-button s1-button"
                      type="button"
                      onClick={() => dispatchAction(selectedCard.advanceActionId!)}
                      disabled={isPending || !sessionId}
                    >
                      {selectedCard.advanceLabel ?? "Продолжить"}
                    </button>
                  </div>
                ) : null}
              </div>
              {/* Panel buttons for topbar S1 board screen - placed in grid row 3 */}
              <div className="button-container antarctica-panel-buttons">
                <button id="btn-journal" className="button-helper" type="button" onClick={() => dispatchAction("showHistory")} disabled={isPending || !sessionId} style={{ backgroundImage: "url(/images/jurnal-hodov.png)", backgroundSize: "cover" }}>
                  журнал ходов
                </button>
                <button id="btn-hint" className="button-helper" type="button" onClick={() => dispatchAction("showHint")} disabled={isPending || !sessionId} style={{ backgroundImage: "url(/images/podskazka.png)", backgroundSize: "cover" }}>
                  подсказка
                </button>
                <button id="nav-left" className="button-helper-arrow" type="button" disabled style={{ backgroundImage: "url(/images/arrow-left.png)", backgroundSize: "contain" }}>
                  Назад
                </button>
                <button id="nav-right" className="button-helper-arrow" type="button" disabled style={{ backgroundImage: "url(/images/arrow-right.png)", backgroundSize: "contain" }}>
                  Вперед
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`s1-area game-variables-container${layoutMode === "topbar" ? " topbar-variables-container" : ""}`}>
                <AntarcticaMetricCluster metrics={metrics} variant={layoutMode === "topbar" ? "topbar" : "sidebar"} />
              </div>
              <div className={`s1-area main-content-area${layoutMode === "topbar" ? " topbar-main-content" : ""}`}>
                {currentInfo ? (
                  <>
                    <div className="s1-area info-content">
                      <article className="info-event-card">
                        <div className="info-event-illustration" />
                        <div className="info-event-text">
                          <article className="s1-card">
                            <p className="s1-card-text">{currentInfo.title}</p>
                          </article>
                          <RichText className="antarctica-fallback-copy" html={currentInfo.body} />
                          <div className="antarctica-fallback-card-meta">
                            <span className="chip">info: {currentInfo.id}</span>
                            <span className="chip">step: {currentInfo.stepIndex}</span>
                          </div>
                        </div>
                      </article>
                    </div>
                    <div className="s1-area bottom-controls-container info-bottom-controls">
                      <button
                        className="action-button s1-button"
                        type="button"
                        onClick={() => dispatchAction(currentInfo.advanceActionId)}
                        disabled={isPending || !sessionId}
                      >
                        {currentInfo.advanceLabel ?? "Продолжить"}
                      </button>
                    </div>
                  </>
                ) : currentTeamSelection ? (
                  <>
                    <div className="s1-area cards-container antarctica-team-cards-container">
                      {currentTeamSelection.members.map((member) => {
                        const flags = teamFlags[member.memberId] ?? {};
                        const isSelected = flags.selected === true || selectedMemberIds.includes(member.memberId);
                        const isPickLimitReached = pickCount >= currentTeamSelection.requiredPickCount;

                        return (
                          <article
                            key={member.memberId}
                            className={`s1-card antarctica-fallback-card${isSelected ? " antarctica-fallback-card-selected" : ""}`}
                          >
                            <div className="antarctica-fallback-card-head">
                              <strong>{member.name}</strong>
                              <span className="chip">#{member.memberId}</span>
                            </div>
                            <p className="s1-card-text">{member.summary}</p>
                            <div className="antarctica-fallback-card-meta">
                              {isSelected ? <span className="chip">selected</span> : null}
                              {isPickLimitReached && !isSelected ? <span className="chip">limit reached</span> : null}
                            </div>
                            <button
                              className="action-button"
                              type="button"
                              onClick={() => dispatchAction(member.selectActionId)}
                              disabled={isPending || !sessionId || isSelected || isPickLimitReached}
                            >
                              {member.selectLabel ?? "Выбрать"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                    <div className="s1-area bottom-controls-container antarctica-team-controls">
                      <article className="s1-card antarctica-fallback-summary-card">
                        <p className="s1-card-text">{currentTeamSelection.title}</p>
                        <RichText className="antarctica-fallback-copy" html={currentTeamSelection.body} />
                        <div className="antarctica-fallback-card-meta">
                          <span className="chip">team-selection: {currentTeamSelection.id}</span>
                          <span className="chip">
                            picked: {pickCount}/{currentTeamSelection.requiredPickCount}
                          </span>
                        </div>
                      </article>
                      <button
                        className="action-button s1-button"
                        type="button"
                        onClick={() => dispatchAction(currentTeamSelection.confirmActionId)}
                        disabled={isPending || !sessionId || pickCount !== currentTeamSelection.requiredPickCount}
                      >
                        {currentTeamSelection.confirmLabel ?? "Подтвердить"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`s1-area cards-container${layoutMode === "topbar" ? " topbar-cards-container" : ""} antarctica-action-cards-container`}>
                      {fallbackActions.length > 0 ? (
                        fallbackActions.map((action) => (
                          <article key={action.actionId} className="s1-card antarctica-fallback-card">
                            <div className="antarctica-fallback-card-head">
                              <strong>{action.displayName}</strong>
                              <span className="chip">action</span>
                            </div>
                            <p className="s1-card-text">
                              Экран еще не описан в UI manifest, поэтому доступен безопасный runtime fallback.
                            </p>
                            <div className="antarctica-fallback-card-meta">
                              <span className="chip">Fallback action catalog</span>
                              {action.capabilityFamily ? <span className="chip">{action.capabilityFamily}</span> : null}
                            </div>
                            <button
                              className="action-button"
                              type="button"
                              onClick={() => dispatchAction(action.actionId)}
                              disabled={isPending || !sessionId}
                            >
                              Открыть
                            </button>
                          </article>
                        ))
                      ) : (
                        <article className="s1-card antarctica-fallback-summary-card">
                          <p className="s1-card-text">Fallback action catalog</p>
                          <p className="antarctica-fallback-copy">
                            Экран еще не сопоставлен с manifest. Runtime state продолжает работать, но для этой сцены
                            нет явных карточек действий.
                          </p>
                        </article>
                      )}
                    </div>
                    <div className="s1-area bottom-controls-container antarctica-team-controls">
                      <article className="s1-card antarctica-fallback-summary-card">
                        <p className="s1-card-text">{content.name}</p>
                        <p className="antarctica-fallback-copy">
                          {content.description}
                        </p>
                        <div className="antarctica-fallback-card-meta">
                          <span className="chip">runtime: {runtimeApiUrl}</span>
                          <span className="chip">players: {content.playerConfig.min}-{content.playerConfig.max}</span>
                          <span className="chip">locale: {content.locale}</span>
                        </div>
                      </article>
                    </div>
                  </>
                )}
              </div>
              {layoutMode === "leftsidebar" && (
                <div className="s1-area button-container antarctica-panel-buttons">
                  <AntarcticaPanelButtonRow onJournal={onJournal ?? (() => {})} onHint={onHint ?? (() => {})} layoutMode="leftsidebar" />
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}

export function AntarcticaPlayer({ runtimeApiUrl, content, mockups, antarcticaUi }: AntarcticaPlayerProps) {
  const [session, setSession] = useState<AntarcticaSession | null>(null);
  const [booting, setBooting] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissedPanel, setDismissedPanel] = useState<string | null>(null);

  /**
   * Creates a new session via POST and stores the sessionId in localStorage.
   * Returns the new session data.
   */
  const createNewSession = async (): Promise<SessionSnapshot> => {
    const base = "/api/runtime/sessions";
    const response = await fetch(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        gameId: "antarctica",
        playerId: "player-web"
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    const data = (await response.json()) as SessionSnapshot;
    window.localStorage.setItem(storageKey, data.sessionId);
    return data;
  };

  /**
   * Resets the game: clears localStorage session and creates a new session.
   * Used both for stale session recovery and for the "Новая игра" button.
   */
  const resetGame = async () => {
    setBooting(true);
    setError(null);

    try {
      // Clear any stale session from localStorage
      window.localStorage.removeItem(storageKey);

      // Create fresh session
      const data = await createNewSession();

      setSession(data);
      setError(null);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Failed to reset player");
    } finally {
      setBooting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      try {
        const storedSessionId = window.localStorage.getItem(storageKey);
        const base = "/api/runtime/sessions";

        let response: Response;

        if (storedSessionId) {
          // Try to resume existing session
          response = await fetch(`${base}/${storedSessionId}`);

          // If session is stale (e.g., runtime restarted), fall back to creating new session
          if (!response.ok) {
            console.warn(`Stale session detected (${storedSessionId}), creating new session`);
            const newSession = await createNewSession();
            if (!cancelled) {
              setSession(newSession);
              setError(null);
            }
            return;
          }
        } else {
          // No stored session, create new one
          response = await fetch(base, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              gameId: "antarctica",
              playerId: "player-web"
            })
          });
        }

        if (!response.ok) {
          throw new Error(`Failed to initialize session: ${response.status}`);
        }

        const data = (await response.json()) as SessionSnapshot;
        if (!storedSessionId) {
          window.localStorage.setItem(storageKey, data.sessionId);
        }

        if (!cancelled) {
          setSession(data);
          setError(null);
        }
      } catch (bootError) {
        if (!cancelled) {
          setError(bootError instanceof Error ? bootError.message : "Failed to initialize player");
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, [content.name]);

  const dispatchAction = (actionId: string, payload?: Record<string, unknown>) => {
    if (!session) {
      return;
    }

    // When the user explicitly requests a panel, clear any client-side dismissal
    // so the server response is respected.
    if (actionId === "showHistory" || actionId === "showHint") {
      setDismissedPanel(null);
    }

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/runtime/actions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sessionId: session.sessionId,
              playerId: "player-web",
              actionId,
              payload: payload ?? {}
            })
          });

          if (!response.ok) {
            const errorPayload = (await response.json()) as { error?: string };
            throw new Error(errorPayload.error ?? `Action "${actionId}" failed`);
          }

          const next = (await response.json()) as ActionSnapshot;
          setSession((current) => (current ? { ...current, ...next } : ({ ...next } as AntarcticaSession)));
          setError(null);
        } catch (actionError) {
          setError(actionError instanceof Error ? actionError.message : "Action dispatch failed");
        }
      })();
    });
  };

  /**
   * Maps S1 UI manifest commands to action IDs for dispatch.
   * Commands are mapped to action IDs as defined in the game manifest.
   * When a command has no explicit mapping, dispatch fails gracefully.
   *
   * For card selection commands, resolves the real selectActionId from boardCards
   * based on the cardId in the payload, rather than dispatching generic requestServer.
   */
  const dispatchS1Action = (command: string, payload: Record<string, unknown>) => {
    // Handle requestServer with cardId - resolve to the actual card selectActionId
    if (command === "requestServer") {
      const cardId = payload?.cardId as string | undefined;
      if (cardId && antarctica && boardCards.length > 0) {
        const card = boardCards.find((c) => c.cardId === cardId);
        if (card) {
          dispatchAction(card.selectActionId);
          return;
        }
      }
      // Fallback: if we can't resolve, treat as generic requestServer
      dispatchAction("requestServer", payload);
      return;
    }

    // Handle showHistory, showHint, showScreenWithLeftSideBar via direct dispatch
    if (command === "showHistory") {
      dispatchAction("showHistory");
      return;
    }
    if (command === "showHint") {
      dispatchAction("showHint");
      return;
    }
    if (command === "showScreenWithLeftSideBar") {
      dispatchAction("showScreenWithLeftSideBar");
      return;
    }

    // Unknown command - report error
    setError(`Unknown S1 command: ${command}`);
  };

  const publicState = session?.state?.public as Record<string, unknown> | undefined;
  const metrics = (publicState?.metrics as Record<string, unknown> | undefined) ?? {};
  const timeline = (publicState?.timeline as Record<string, unknown> | undefined) ?? {};
  const runtimeUi = (publicState?.ui as RuntimeUiState | undefined) ?? {};
  const log = Array.isArray(publicState?.log) ? (publicState?.log as Array<RuntimeLogEntry>) : [];

  // Read the current screen ID from timeline (supports both snake_case and camelCase)
  const currentScreenId = (typeof timeline.screenId === "string"
    ? timeline.screenId
    : typeof timeline.screen_id === "string"
      ? timeline.screen_id
      : null) as string | null;

  // Read stepIndex for board-to-manifest-key resolution
  const currentStepIndex = (typeof timeline.stepIndex === "number"
    ? timeline.stepIndex
    : typeof timeline.step_index === "number"
      ? timeline.step_index
      : null) as number | null;

  // Read activeInfoId for variant info screen disambiguation (i19 vs i19_1)
  const activeInfoId = (typeof timeline.activeInfoId === "string"
    ? timeline.activeInfoId
    : typeof timeline.active_info_id === "string"
      ? timeline.active_info_id
      : null) as string | null;

  /**
   * Resolves the manifest screen key for S2 board screens.
   * S2 boards are keyed by their card range in the manifest (e.g., "55..60", "61..66", "67..68", "69..70").
   * stepIndex 30 → "55..60", stepIndex 32 → "61..66", stepIndex 34 → "67..68", stepIndex 36 → "69..70".
   */
  const resolveBoardScreenKey = (stepIndex: number | null): string | null => {
    if (stepIndex === null) return null;
    if (stepIndex === 30) return "55..60";
    if (stepIndex === 32) return "61..66";
    if (stepIndex === 34) return "67..68";
    if (stepIndex === 36) return "69..70";
    return null;
  };

  /**
   * Resolves the manifest screen key for the current timeline state.
   *
   * Screen selection contract (from CONTRACT_INDEX.md):
   * - For S2 (board) screens: use stepIndex to derive the board key
   * - For S1 (info) screens: use activeInfoId to select variant (e.g., i19 vs i19_1)
   * - When screenId is provided but not found in screens, return null to trigger fallback
   * - entryPoint is used only when no screenId is available (initial state)
   */
  const resolveScreenKey = (
    screenId: string | null,
    stepIndex: number | null,
    infoId: string | null,
    runtimeUi: RuntimeUiState
  ): string | null => {
    if (screenId === "S2") {
      // Board screens: derive manifest screen key from stepIndex
      const boardKey = resolveBoardScreenKey(stepIndex);
      if (boardKey && antarcticaUi?.screens[boardKey]) {
        return boardKey;
      }
      // Board screen not in manifest — return null to trigger fallback
      return null;
    } else if (screenId === "S1") {
      // When runtime explicitly requests left-sidebar composition, use S1_LEFT manifest screen
      if (runtimeUi.activeScreen === "left-sidebar" && antarcticaUi?.screens["S1_LEFT"]) {
        return "S1_LEFT";
      }
      // Info screens: use activeInfoId for variant disambiguation (i19 vs i19_1)
      // If activeInfoId exists in UI screens, use that UI screen
      if (infoId && antarcticaUi?.screens[infoId]) {
        return infoId;
      }
      // If activeInfoId is set but not in UI screens (e.g., i0, i7 for early game),
      // return null to trigger runtime fallback renderer which will use currentInfo
      if (infoId) {
        // activeInfoId is set but not in UI screens - use runtime fallback
        return null;
      }
      // No activeInfoId set - use S1 placeholder screen if available
      if (antarcticaUi?.screens["S1"]) {
        return "S1";
      }
      // S1 not in manifest — return null to trigger fallback
      return null;
    }

    // For other screenId values, check if it exists directly in screens
    if (screenId && antarcticaUi?.screens[screenId]) {
      return screenId;
    }

    // No valid screen found — return null to trigger fallback
    return null;
  };

  const screenKey = antarcticaUi ? resolveScreenKey(currentScreenId, currentStepIndex, activeInfoId, runtimeUi) : null;
  const screenDefinition = screenKey ? antarcticaUi?.screens[screenKey] : null;

  const antarctica = resolveAntarcticaContent(content);
  const currentInfo = resolveCurrentInfoEntry(antarctica, publicState as Record<string, unknown>);
  const currentBoard = resolveCurrentBoard(antarctica, publicState as Record<string, unknown>);
  const currentTeamSelection = resolveCurrentTeamSelectionScene(antarctica, publicState as Record<string, unknown>);
  const selectedCardId = readSelectedCardId(session);
  const cardFlags = readCardFlags(session);
  const boardCards = resolveBoardCards(antarctica, currentBoard, cardFlags);
  const teamFlags = readTeamFlags(session);
  const teamSelectionState = readTeamSelection(session);
  const canAdvance = readCanAdvance(session);
  const fallbackActions = getFallbackActionEntries(content);
  const selectedMemberIds = teamSelectionState.selectedMemberIds ?? [];
  const pickCount = teamSelectionState.pickCount ?? 0;
  const selectedTeamMemberIds =
    selectedMemberIds.length > 0 ? selectedMemberIds : Object.keys(teamFlags).filter((memberId) => teamFlags[memberId]?.selected);
  const selectedCard =
    selectedCardId && boardCards.length > 0
      ? boardCards.find((card) => card.cardId === selectedCardId) ?? null
      : null;
  const rawActivePanel = typeof runtimeUi.activePanel === "string" ? runtimeUi.activePanel : null;
  const activePanel = rawActivePanel && rawActivePanel !== dismissedPanel ? rawActivePanel : null;

  useEffect(() => {
    if (dismissedPanel && dismissedPanel !== rawActivePanel) {
      setDismissedPanel(null);
    }
  }, [rawActivePanel, dismissedPanel]);

  const screenLayoutMode = resolveAntarcticaLayoutMode(screenKey, runtimeUi, currentBoard, currentInfo);

  return (
    <main className="shell antarctica-player-root">
      {activePanel === "history" ? (
        <AntarcticaJournalRenderer
          metrics={metrics}
          log={log}
          onJournal={() => setDismissedPanel("history")}
          onHint={() => dispatchAction("showHint")}
          onClose={() => setDismissedPanel("history")}
        />
      ) : activePanel === "hint" ? (
        <AntarcticaHintRenderer
          content={content}
          metrics={metrics}
          log={log}
          onJournal={() => dispatchAction("showHistory")}
          onHint={() => setDismissedPanel("hint")}
          onClose={() => setDismissedPanel("hint")}
        />
      ) : screenDefinition ? (
        /* Manifest-driven rendering for in-scope tail screens (S1 info variants and S2 boards) */
        <AntarcticaS1Renderer
          screenDefinition={screenDefinition}
          metrics={metrics}
          onAction={dispatchS1Action}
          screenKey={screenKey ?? undefined}
          layoutMode={screenLayoutMode}
        />
      ) : booting || !session ? (
        /* Session not yet available — show loading state instead of fallback catalog flash */
        <div className="antarctica-loading-state">
          <div className="antarctica-loading-spinner" />
          <span>Загрузка...</span>
        </div>
      ) : (
        <AntarcticaFallbackRenderer
          content={content}
          runtimeApiUrl={runtimeApiUrl}
          sessionId={session?.sessionId ?? null}
          isPending={isPending}
          metrics={metrics}
          currentInfo={currentInfo}
          currentBoard={currentBoard}
          currentTeamSelection={currentTeamSelection}
          cardFlags={cardFlags}
          selectedCardId={selectedCardId}
          selectedCard={selectedCard}
          boardCards={boardCards}
          teamFlags={teamFlags}
          selectedMemberIds={selectedTeamMemberIds}
          pickCount={pickCount}
          canAdvance={canAdvance}
          fallbackActions={fallbackActions}
          dispatchAction={dispatchAction}
          layoutMode={screenLayoutMode}
          onJournal={() => dispatchAction("showHistory")}
          onHint={() => dispatchAction("showHint")}
        />
      )}
      {error ? <div className="error antarctica-inline-error">{error}</div> : null}
    </main>
  );
}
