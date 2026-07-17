import type { PlayerFacingContent, PlayerFacingMockup } from "@cubica/contracts-manifest";

import type { DispatchActionResponse, GetSessionResponse } from "@cubica/contracts-session";

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

/** Browser-safe snapshot after the BFF has removed the one-time credential. */
export type SessionSnapshot = GetSessionResponse<Record<string, unknown>>;
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

/**
 * Generic shape of the public session state that the platform itself reads.
 *
 * Only the truly cross-game buckets live here: `timeline` (step/screen cursor)
 * and `ui` (runtime UI hints). Any further, game-defined buckets (for example
 * Antarctica's `flags.team`, `objects.cards` or `teamSelection`) are NOT typed
 * here on purpose — per ADR-055 §5 the generic player-web layer must stay
 * agnostic to game state shapes. Game plugins read those buckets through the
 * generic accessors below and cast the result to their own state types.
 */
type PublicState = {
  timeline?: TimelineState;
  ui?: {
    activePanel?: string;
    activeScreen?: string;
    lastCapabilityFamily?: string;
    lastCapability?: string;
    serverRequested?: boolean;
  };
};

/**
 * Generic shape of the secret (per-player, hidden) session state.
 *
 * The platform does not interpret secret state; it is an open, game-defined
 * bag. Game plugins cast the accessor result to their own secret-state type
 * (ADR-055 §5).
 */
type SecretState = Record<string, unknown>;

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
 * Читает canAdvance из timeline session snapshot.
 * Обобщённая утилита для плагинов: canAdvance — это общий признак «можно
 * перейти к следующему шагу», не привязанный к конкретной игре.
 */
export function readCanAdvance(session: SessionSnapshot | null): boolean {
  return Boolean(readPublicState(session)?.timeline?.canAdvance);
}
