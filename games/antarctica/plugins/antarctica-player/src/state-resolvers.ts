/**
 * Antarctica-specific state resolvers.
 *
 * These functions know the shape of Antarctica content: boards, info entries,
 * cards and team-selection scenes. Generic helpers still come from the public
 * player plugin API facade.
 */

import type { GameManifestMetricDefinition, PlayerFacingContent } from "@cubica/contracts-manifest";

import type {
  AntarcticaGameState,
  GamePlayerBoard,
  GamePlayerBoardCard,
  GamePlayerContent,
  GamePlayerInfoEntry,
  GamePlayerJournalEntry,
  GamePlayerJournalMetricRow,
  GamePlayerTeamSelectionScene
} from "./contracts";
import type { FallbackMetricSpec, SessionSnapshot } from "@cubica/player-web/plugin-api";
import {
  getFallbackActionEntries,
  readCanAdvance as readCanAdvanceGeneric,
  readPublicState,
  readScreenId,
  readStepIndex,
  resolveGameContent
} from "@cubica/player-web/plugin-api";

type CardObjectState = {
  objectType: string;
  facets: {
    selection?: "idle" | "selected";
    resolution?: "idle" | "resolved";
    availability?: "available" | "locked" | "hidden";
    face?: "front" | "back";
  };
};

/**
 * Antarctica-specific state-shape types (moved out of the generic player-web
 * lib per ADR-055 §5).
 *
 * The platform stores this game-owned data inside opaque public session state
 * but must not know its shape. The plugin owns the shape and casts the generic
 * readPublicState accessor result below.
 */
type TeamFlagState = {
  selected?: boolean;
};

type TeamSelectionState = {
  pickCount?: number;
  selectedMemberIds?: Array<string>;
};

/** Antarctica view over the generic public session state. */
type AntarcticaPublicState = {
  flags?: {
    team?: Record<string, TeamFlagState>;
  };
  objects?: {
    cards?: Record<string, CardObjectState>;
  };
  opening?: {
    selectedCardId?: string;
  };
  teamSelection?: TeamSelectionState;
};

/**
 * Reads the Antarctica-shaped public state from a session snapshot.
 *
 * We go through the generic readPublicState accessor so the plugin never
 * reaches into the raw snapshot structure directly, then cast to the
 * game-owned shape.
 */
function readAntarcticaPublicState(session: SessionSnapshot | null): AntarcticaPublicState | undefined {
  return readPublicState(session) as AntarcticaPublicState | undefined;
}

/**
 * One ADR-092 metric snapshot pair as it arrives on a runtime log entry:
 * `before`/`after` are the whole-transaction metric values.
 */
type RuntimeMetricChange = { metricId?: string; before?: number; after?: number };

type RuntimeLogLike = Record<string, unknown> & {
  at?: string;
  cardId?: string;
  displayMode?: string;
  entityType?: string;
  frontText?: string;
  backText?: string;
  metricsBefore?: Record<string, unknown>;
  metricsAfter?: Record<string, unknown>;
  metricChanges?: Array<RuntimeMetricChange>;
  summary?: string;
  /**
   * Game-defined event payload. The runtime nests everything except `summary`
   * inside `data` (see runtime `core.event.emit`), so the journal card fields
   * (`cardId`, `entityType`, `displayMode`, …) live here, not at the top level.
   * `metricChanges` is a top-level platform field (ADR-092), not part of `data`,
   * but we still accept a nested copy for mock/legacy robustness.
   */
  data?: Record<string, unknown>;
};

/**
 * Fields the journal projection reads from a single runtime log entry.
 *
 * This is a flattened view: the runtime stores game-defined fields nested inside
 * `entry.data`, but older/mock entries kept them at the top level. Normalizing
 * once here means the rest of the resolver never has to know which shape it got.
 */
type NormalizedJournalEntry = {
  at?: string;
  cardId?: string;
  displayMode?: string;
  entityType?: string;
  frontText?: string;
  backText?: string;
  summary?: string;
  metricsBefore?: Record<string, unknown>;
  metricsAfter?: Record<string, unknown>;
  metricChanges?: Array<RuntimeMetricChange>;
};

/** Reads a nested record value, returning `undefined` for non-record inputs. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Flattens a runtime log entry into the shape the journal projection expects.
 *
 * Why this exists: the runtime `core.event.emit` step keeps game-defined data
 * nested under `entry.data` so a generic Presenter never has to guess which
 * arbitrary field names are platform journal metadata. A real Antarctica card
 * resolution therefore arrives as
 * `{ eventType, audience, summary, data: { cardId, entityType, displayMode, … } }`.
 * The previous flat lookups (`entry.cardId`) always missed, so every card entry
 * was filtered out and the journal rendered empty. We prefer any top-level field
 * (mock/legacy flat form) and fall back to the nested `data` field so both
 * shapes work.
 */
function normalizeLogEntry(entry: RuntimeLogLike): NormalizedJournalEntry {
  const data = asRecord(entry.data) ?? {};
  const readString = (key: string): string | undefined => {
    const flat = entry[key];
    if (typeof flat === "string") {
      return flat;
    }
    const nested = data[key];
    return typeof nested === "string" ? nested : undefined;
  };

  return {
    at: readString("at"),
    cardId: readString("cardId"),
    displayMode: readString("displayMode"),
    entityType: readString("entityType"),
    frontText: readString("frontText"),
    backText: readString("backText"),
    // The runtime keeps `summary` at the top level; it carries the card
    // resolution ("back") text, so we treat it as a back-text fallback below.
    summary: readString("summary"),
    metricsBefore: asRecord(entry.metricsBefore) ?? asRecord(data.metricsBefore),
    metricsAfter: asRecord(entry.metricsAfter) ?? asRecord(data.metricsAfter),
    metricChanges: Array.isArray(entry.metricChanges)
      ? (entry.metricChanges as Array<RuntimeMetricChange>)
      : Array.isArray(data.metricChanges)
        ? (data.metricChanges as Array<RuntimeMetricChange>)
        : undefined
  };
}

type HintSourceState = Pick<AntarcticaGameState, "currentInfo" | "currentBoard" | "currentTeamSelection">;

/**
 * Extracts Antarctica-specific content from the generic player DTO.
 */
export function resolveAntarcticaContent(content: PlayerFacingContent): GamePlayerContent | null {
  return resolveGameContent(content) as GamePlayerContent | null;
}

function isMetricDefinition(value: unknown): value is GameManifestMetricDefinition {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { metricId?: unknown }).metricId === "string" &&
    typeof (value as { label?: unknown }).label === "string" &&
    ((value as { kind?: unknown }).kind === "state" || (value as { kind?: unknown }).kind === "computed")
  );
}

/**
 * Builds metric summary specs for the moves journal from game-owned metadata.
 *
 * The journal summarizes authoritative runtime metric changes. Computed values
 * such as remainingDays are intentionally excluded because runtime logs contain
 * changes to the source metric `time`, not to independently stored projection
 * values.
 */
export function resolveJournalMetricSpecs(
  content: PlayerFacingContent,
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>
): ReadonlyArray<FallbackMetricSpec> {
  const contentData = content.content?.data;
  const metrics = contentData && typeof contentData === "object" && !Array.isArray(contentData)
    ? (contentData as { metrics?: unknown }).metrics
    : undefined;

  if (!Array.isArray(metrics)) {
    return fallbackMetrics;
  }

  const stateMetrics = metrics
    .filter(isMetricDefinition)
    .filter((metric) => metric.kind === "state")
    .map((metric) => ({
      id: metric.metricId,
      caption: metric.label,
      description: metric.description,
      aliases: [metric.metricId, ...(metric.aliases ?? [])],
      sidebarImage: "",
      topbarImage: ""
    }));

  return stateMetrics.length > 0 ? stateMetrics : fallbackMetrics;
}

/**
 * Resolves the current info screen from timeline state.
 */
export function resolveCurrentInfoEntry(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined
): GamePlayerInfoEntry | null {
  if (!gameContent) {
    return null;
  }

  const timeline = (publicState as { timeline?: unknown })?.timeline as
    | { stepIndex?: number; step_index?: number; screenId?: string; screen_id?: string; activeInfoId?: string }
    | undefined;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);
  const activeInfoId = timeline?.activeInfoId;

  if (stepIndex === null || !screenId || !activeInfoId) {
    if (stepIndex === null || !screenId) {
      return null;
    }

    const entriesForStep = gameContent.infos.filter(
      (entry) => entry.stepIndex === stepIndex && entry.screenId === screenId
    );
    return entriesForStep.length === 1 ? entriesForStep[0] : null;
  }

  const explicitMatch =
    gameContent.infos.find(
      (entry) =>
        entry.id === activeInfoId && entry.stepIndex === stepIndex && entry.screenId === screenId
    ) ?? null;

  if (explicitMatch) {
    return explicitMatch;
  }

  const entriesForStep = gameContent.infos.filter(
    (entry) => entry.stepIndex === stepIndex && entry.screenId === screenId
  );
  return entriesForStep.length === 1 ? entriesForStep[0] : null;
}

/**
 * Resolves the current board from timeline state.
 */
export function resolveCurrentBoard(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined
): GamePlayerBoard | null {
  if (!gameContent) {
    return null;
  }

  const timeline = (publicState as { timeline?: unknown })?.timeline as
    | { stepIndex?: number; step_index?: number; screenId?: string; screen_id?: string }
    | undefined;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return gameContent.boards.find((board) => board.stepIndex === stepIndex && board.screenId === screenId) ?? null;
}

/**
 * Resolves the current team-selection scene from timeline state.
 */
export function resolveCurrentTeamSelectionScene(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined
): GamePlayerTeamSelectionScene | null {
  if (!gameContent?.teamSelections) {
    return null;
  }

  const timeline = (publicState as { timeline?: unknown })?.timeline as
    | { stepIndex?: number; step_index?: number; screenId?: string; screen_id?: string }
    | undefined;
  const stepIndex = readStepIndex(timeline);
  const screenId = readScreenId(timeline);

  if (stepIndex === null || !screenId) {
    return null;
  }

  return (
    gameContent.teamSelections.find((scene) => scene.stepIndex === stepIndex && scene.screenId === screenId) ?? null
  );
}

/**
 * Resolves visible cards for the current board by card ids and session object state.
 */
export function resolveBoardCards(
  gameContent: GamePlayerContent | null,
  board: GamePlayerBoard | null,
  cardObjects?: Record<string, CardObjectState>
): Array<GamePlayerBoardCard> {
  if (!gameContent || !board) {
    return [];
  }

  const cardsById = new Map(gameContent.cards.map((card) => [card.cardId, card]));
  return board.cardIds
    .map((cardId) => cardsById.get(cardId))
    .filter((card): card is GamePlayerBoardCard => {
      if (!card) {
        return false;
      }

      const contentAvailable = (card as GamePlayerBoardCard & { available?: boolean }).available;
      const cardState = cardObjects?.[card.cardId];

      // Hidden cards are not visible
      if (cardState?.facets?.availability === "hidden") {
        return false;
      }

      return contentAvailable !== false;
    });
}

function isCardJournalEntry(entry: NormalizedJournalEntry): boolean {
  const hasVisibleCardText = Boolean(entry.frontText || entry.backText || entry.summary);
  const isCardEntry = entry.displayMode === "card" || entry.entityType === "card";
  return Boolean(entry.cardId && (isCardEntry || hasVisibleCardText));
}

function metricValue(metrics: Record<string, unknown> | undefined, spec: FallbackMetricSpec): number | null {
  if (!metrics) {
    return null;
  }

  for (const key of [spec.id, ...spec.aliases]) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function formatSignedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * Builds a caption lookup keyed by both the metric id and each declared alias.
 *
 * The runtime `metricChanges` block keys metrics by their canonical `metricId`
 * (for example `time`), while game-owned specs may also list aliases; matching
 * on either keeps captions coming from the catalog/`metric_specs` rather than
 * being hard-coded in the template.
 */
function buildMetricCaptions(metricSpecs: ReadonlyArray<FallbackMetricSpec>): Map<string, string> {
  const captions = new Map<string, string>();
  for (const spec of metricSpecs) {
    captions.set(spec.id, spec.caption);
    for (const alias of spec.aliases) {
      captions.set(alias, spec.caption);
    }
  }
  return captions;
}

/**
 * Builds the per-metric badge rows shown under one journal entry (ADR-092).
 *
 * Prefers the authoritative `metricChanges` block (before/after of the whole
 * turn); falls back to the legacy `metricsBefore/After` snapshots for mock
 * entries. Every declared public metric is emitted (matching the reference
 * journal, which shows all metrics), and `hasDelta` marks the ones that actually
 * changed so the template can hide the delta superscript for unchanged metrics.
 */
function resolveMetricRows(
  entry: NormalizedJournalEntry,
  metricSpecs: ReadonlyArray<FallbackMetricSpec>
): Array<GamePlayerJournalMetricRow> {
  const captions = buildMetricCaptions(metricSpecs);

  if (Array.isArray(entry.metricChanges) && entry.metricChanges.length > 0) {
    return entry.metricChanges
      .filter((change): change is { metricId: string; before?: number; after?: number } =>
        typeof change.metricId === "string"
      )
      .map((change) => {
        const before = typeof change.before === "number" ? change.before : 0;
        const after = typeof change.after === "number" ? change.after : before;
        const delta = after - before;
        return {
          caption: captions.get(change.metricId) ?? change.metricId,
          value: after,
          previousValue: before,
          delta: formatSignedDelta(delta),
          hasDelta: delta !== 0
        };
      });
  }

  // Legacy/mock fallback: derive rows from full before/after metric snapshots.
  const rows: Array<GamePlayerJournalMetricRow> = [];
  for (const spec of metricSpecs) {
    const before = metricValue(entry.metricsBefore, spec);
    const after = metricValue(entry.metricsAfter, spec);
    if (before === null && after === null) {
      continue;
    }
    const beforeValue = before ?? 0;
    const afterValue = after ?? beforeValue;
    const delta = afterValue - beforeValue;
    rows.push({
      caption: spec.caption,
      value: afterValue,
      previousValue: beforeValue,
      delta: formatSignedDelta(delta),
      hasDelta: delta !== 0
    });
  }
  return rows;
}

/**
 * One-line textual metric summary (changed metrics only), kept for accessibility
 * and any consumer that wants a compact string rather than the badge rows.
 */
function resolveMetricSummary(rows: ReadonlyArray<GamePlayerJournalMetricRow>): string {
  return rows
    .filter((row) => row.hasDelta)
    .map((row) => `${row.caption}: ${row.delta}`)
    .join(" · ");
}

/**
 * Builds the game-defined journal projection used by the UI manifest panel.
 *
 * The platform should not know Antarctica journal semantics. This projection
 * keeps only visible card choices and resolves card texts from game content.
 */
export function resolveJournalEntries(
  gameContent: GamePlayerContent | null,
  publicState: Record<string, unknown> | undefined,
  metricSpecs: ReadonlyArray<FallbackMetricSpec>
): Array<GamePlayerJournalEntry> {
  if (!gameContent || !Array.isArray(publicState?.log)) {
    return [];
  }

  const cardsById = new Map(gameContent.cards.map((card) => [card.cardId, card]));
  return publicState.log
    .filter((entry): entry is RuntimeLogLike => !!entry && typeof entry === "object")
    // Flatten the runtime `{ summary, data: { … } }` envelope before filtering so
    // the card fields (nested under `data`) are visible to the projection.
    .map((entry) => normalizeLogEntry(entry))
    .filter(isCardJournalEntry)
    .map((entry) => {
      const cardId = entry.cardId ?? "";
      const card = cardsById.get(cardId);
      const frontText = entry.frontText ?? card?.summary ?? "";
      // The runtime emits the card resolution ("back") text as the top-level
      // `summary`; keep the explicit `backText` and card content as fallbacks.
      const backText = entry.backText ?? entry.summary ?? card?.backText ?? "";
      const metricRows = resolveMetricRows(entry, metricSpecs);
      const metricSummary = resolveMetricSummary(metricRows);

      if (!frontText && !backText) {
        return null;
      }

      return {
        frontText,
        backText,
        metricSummary,
        hasMetricSummary: metricSummary.length > 0,
        metricRows,
        hasMetricRows: metricRows.length > 0,
        at: entry.at ?? ""
      };
    })
    .filter((entry): entry is GamePlayerJournalEntry => entry !== null);
}

/**
 * Antarctica hint fallback: when no dedicated hint is open, show the last story
 * info screen the player has reached. This is game-specific presentation logic.
 */
export function resolveLastInfoHintText(
  gameContent: GamePlayerContent | null,
  gameState: HintSourceState
): string | null {
  if (gameState.currentInfo?.body || gameState.currentInfo?.title) {
    return [gameState.currentInfo.title, gameState.currentInfo.body].filter(Boolean).join("\n\n");
  }

  const currentStepIndex = gameState.currentBoard?.stepIndex ?? gameState.currentTeamSelection?.stepIndex;
  if (!gameContent || typeof currentStepIndex !== "number") {
    return null;
  }

  const lastInfo = gameContent.infos
    .filter((entry) => entry.stepIndex <= currentStepIndex)
    .sort((left, right) => left.stepIndex - right.stepIndex)
    .at(-1);

  if (!lastInfo?.body && !lastInfo?.title) {
    return null;
  }

  return [lastInfo.title, lastInfo.body].filter(Boolean).join("\n\n");
}

/**
 * Reads Antarctica card object state (`public.objects.cards`) from the snapshot.
 */
export function readCardObjects(session: SessionSnapshot | null): Record<string, CardObjectState> {
  return readAntarcticaPublicState(session)?.objects?.cards ?? {};
}

/**
 * Reads Antarctica team flags (`public.flags.team`) from the snapshot.
 */
export function readTeamFlags(session: SessionSnapshot | null): Record<string, TeamFlagState> {
  return readAntarcticaPublicState(session)?.flags?.team ?? {};
}

/**
 * Reads Antarctica team-selection state (`public.teamSelection`) from the snapshot.
 */
export function readTeamSelection(session: SessionSnapshot | null): TeamSelectionState {
  return readAntarcticaPublicState(session)?.teamSelection ?? {};
}

/**
 * canAdvance is a generic timeline flag; the plugin re-exports the platform
 * accessor unchanged so game code keeps a single import surface.
 */
export function readCanAdvance(session: SessionSnapshot | null): boolean {
  return readCanAdvanceGeneric(session);
}

/**
 * Reads the Antarctica selected go-card id (`public.opening.selectedCardId`).
 *
 * The selected card drives visible UI, so it is public game state. Keeping it
 * outside `secret` also lets the runtime omit the whole secret branch from
 * every player-facing snapshot.
 */
export function readSelectedCardId(session: SessionSnapshot | null): string | null {
  return readAntarcticaPublicState(session)?.opening?.selectedCardId ?? null;
}

export { getFallbackActionEntries };
