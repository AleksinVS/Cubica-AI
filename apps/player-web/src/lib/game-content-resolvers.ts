import type { PlayerFacingContent, PlayerFacingMockup } from "@cubica/contracts-manifest";

import type { CreateSessionResponse, DispatchActionResponse } from "@cubica/contracts-session";

export type { PlayerFacingMockup as GameMockup };

export interface GamePlayerSourceData {
  content: PlayerFacingContent;
  runtimeApiUrl: string;
}

export interface LoadGamePlayerContentOptions {
  retries?: number;
  delayMs?: number;
  contentSourceId?: string;
}

export interface ActionEntry {
  actionId: string;
  displayName: string;
  capabilityFamily: string | null;
  capability: string | null;
}

export type SessionSnapshot = CreateSessionResponse<Record<string, unknown>>;
export type ActionSnapshot = DispatchActionResponse<Record<string, unknown>>;

/**
 * Внутренние типы для чтения state — обобщённые, не привязанные к конкретной игре.
 * Плагины используют свои типы для конкретных структур (например, AntarcticaGameState).
 */
type TimelineState = {
  stepIndex?: number;
  step_index?: number;
  screenId?: string;
  screen_id?: string;
  activeInfoId?: string;
  canAdvance?: boolean;
};

type TeamFlagState = {
  selected?: boolean;
};

type TeamSelectionState = {
  pickCount?: number;
  selectedMemberIds?: Array<string>;
};

type PublicState = {
  timeline?: TimelineState;
  flags?: {
    team?: Record<string, TeamFlagState>;
  };
  objects?: {
    cards?: Record<string, any>;
  };
  teamSelection?: TeamSelectionState;
  ui?: {
    activePanel?: string;
    activeScreen?: string;
    lastCapabilityFamily?: string;
    lastCapability?: string;
    serverRequested?: boolean;
  };
};

type SecretState = {
  opening?: {
    selectedCardId?: string;
  };
};

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";

const parseJson = <TValue,>(raw: string): TValue => JSON.parse(raw) as TValue;

/**
 * Читает stepIndex из timeline, поддерживая и camelCase и snake_case варианты.
 */
export const readStepIndex = (timeline: TimelineState | undefined) =>
  typeof timeline?.stepIndex === "number"
    ? timeline.stepIndex
    : typeof timeline?.step_index === "number"
      ? timeline.step_index
      : null;

/**
 * Читает screenId из timeline, поддерживая и camelCase и snake_case варианты.
 */
export const readScreenId = (timeline: TimelineState | undefined) =>
  typeof timeline?.screenId === "string"
    ? timeline.screenId
    : typeof timeline?.screen_id === "string"
      ? timeline.screen_id
      : null;

/**
 * Загружает PlayerFacingContent с retry-логикой.
 */
export async function loadGamePlayerContent(
  gameId: string,
  options: LoadGamePlayerContentOptions = {}
): Promise<PlayerFacingContent> {
  const retries = options.retries ?? 3;
  const delay = options.delayMs ?? 1000;
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const url = new URL(`/games/${gameId}/player-content`, runtimeApiUrl);
      if (options.contentSourceId !== undefined) {
        url.searchParams.set("contentSourceId", options.contentSourceId);
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load player content: ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      return parseJson<PlayerFacingContent>(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (i < retries - 1) {
        // eslint-disable-next-line no-console
        console.warn(`Attempt ${i + 1} to load player content failed, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Unknown error loading player content");
}

export function getRuntimeApiUrl() {
  return runtimeApiUrl;
}

/**
 * Извлекает fallback-действия из PlayerFacingContent.
 */
export function getFallbackActionEntries(content: PlayerFacingContent): Array<ActionEntry> {
  return content.actions.map((action) => ({
    actionId: action.actionId,
    displayName: action.displayName,
    capabilityFamily: action.capabilityFamily,
    capability: action.capability
  }));
}

/**
 * Извлекает game-specific контент из PlayerFacingContent.
 * Возвращает unknown — плагин приводит к своему типу.
 * Предпочитает универсальный ключ 'data', но поддерживает обратную совместимость с ключом на базе gameId.
 */
export function resolveGameContent(content: PlayerFacingContent): unknown {
  return content.content?.data ?? content.content?.[content.gameId] ?? null;
}

/**
 * Читает public state из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readPublicState(session: SessionSnapshot | null): PublicState | undefined {
  return session?.state?.public as PublicState | undefined;
}

/**
 * Читает secret state из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readSecretState(session: SessionSnapshot | null): SecretState | undefined {
  return session?.state?.secret as SecretState | undefined;
}

/**
 * Читает timeline из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readTimeline(session: SessionSnapshot | null): TimelineState | undefined {
  return readPublicState(session)?.timeline;
}

/**
 * Читает UI state из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readRuntimeUi(session: SessionSnapshot | null): {
  activePanel?: string;
  activeScreen?: string;
  lastCapabilityFamily?: string;
  lastCapability?: string;
  serverRequested?: boolean;
} | undefined {
  return readPublicState(session)?.ui;
}

/**
 * Читает team flags из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readTeamFlags(session: SessionSnapshot | null): Record<string, TeamFlagState> {
  return readPublicState(session)?.flags?.team ?? {};
}

/**
 * Читает card objects из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readCardObjects(session: SessionSnapshot | null): Record<string, any> {
  return readPublicState(session)?.objects?.cards ?? {};
}

/**
 * Читает team selection state из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readTeamSelection(session: SessionSnapshot | null): TeamSelectionState {
  return readPublicState(session)?.teamSelection ?? {};
}

/**
 * Читает canAdvance из session snapshot.
 * Обобщённая утилита для плагинов.
 */
export function readCanAdvance(session: SessionSnapshot | null): boolean {
  return Boolean(readPublicState(session)?.timeline?.canAdvance);
}

/**
 * Читает selectedCardId из secret state.
 * Обобщённая утилита для плагинов.
 */
export function readSelectedCardId(session: SessionSnapshot | null): string | null {
  return readSecretState(session)?.opening?.selectedCardId ?? null;
}
