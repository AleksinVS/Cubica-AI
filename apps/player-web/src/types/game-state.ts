import type {
  PlayerFacingContent,
  PlayerFacingMockup
} from "@cubica/contracts-manifest";
import type { ActionSnapshot, SessionSnapshot } from "@/lib/game-content-resolvers";


export type GameSession = SessionSnapshot & {
  gameId?: string;
};

export type RuntimeLogEntry = {
  actionId: string;
  /** Runtime event kind from the backend audit log. */
  kind?: string;
  /** Neutral player-facing render mode from manifest log effect data. */
  displayMode?: string;
  /** Neutral entity category from manifest log effect data. */
  entityType?: string;
  /** Manifest card identifier when the event belongs to a card choice. */
  cardId?: string;
  capability?: string;
  capabilityFamily?: string;
  functionName?: string;
  at?: string;
  payload?: unknown;
  /** Front text of the card that was selected (for journal display). */
  frontText?: string;
  /** Back (flipped/result) text of the card that was selected. */
  backText?: string;
  /** Metric snapshot before the action was applied. */
  metricsBefore?: MetricsSnapshot;
  /** Metric snapshot after the action was applied. */
  metricsAfter?: MetricsSnapshot;
  /** Computed metric changes for this action. */
  metricChanges?: Array<{ metricId: string; delta: number }>;
};

export type MetricsSnapshot = Record<string, unknown>;

export type RuntimeUiState = {
  activePanel?: string;
  activeScreen?: string;
  lastCapabilityFamily?: string;
  lastCapability?: string;
  serverRequested?: boolean;
};

export type MetricSpec = {
  id: string;
  caption: string;
  description?: string;
  aliases: Array<string>;
  sidebarImage: string;
  topbarImage: string;
};

export type RichTextProps = {
  html: string;
  className?: string;
};

export type { PlayerFacingMockup as GameMockup } from "@cubica/contracts-manifest";
export type { ActionSnapshot, SessionSnapshot } from "@/lib/game-content-resolvers";
