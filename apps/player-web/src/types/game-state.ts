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
  capability?: string;
  capabilityFamily?: string;
  functionName?: string;
  at?: string;
  payload?: unknown;
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
