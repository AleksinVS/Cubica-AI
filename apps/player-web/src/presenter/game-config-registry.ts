import type { GameConfigData, GameConfig, ResolverFactory } from "./game-config";
import { createDefaultGameConfig } from "./game-config";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";

/**
 * Реестр фабрик резолверов для конфигураций игр.
 *
 * Generic-модуль — не содержит импортов конкретных игр.
 * Каждая сложная игра регистрирует свою фабрику через публичный plugin API
 * из project-local plugin, например `games/<gameId>/plugins/<pluginId>`.
 *
 * Платформенные компоненты (GamePlayer, GamePresenter) получают
 * GameConfigData через пропсы от Server Component и собирают
 * полный GameConfig через buildGameConfig(), который находит
 * нужную фабрику в реестре по gameId.
 */
const registry = new Map<string, ResolverFactory>();
const configDataRegistry = new Map<string, GameConfigData>();

/**
 * Регистрирует фабрику резолверов для игры.
 * Вызывается через публичный player plugin API на этапе инициализации
 * клиентского приложения.
 */
export function registerGameResolvers(
  gameId: string,
  factory: ResolverFactory
): void {
  registry.set(gameId, factory);
}

/**
 * Registers serializable config data supplied by a player plugin.
 *
 * Preview bundles use this to replace stale server-side defaults after the
 * browser imports the session-scoped plugin module.
 */
export function registerGameConfigData(data: GameConfigData): void {
  configDataRegistry.set(data.gameId, data);
}

export function resolveRegisteredGameConfigData(
  content: PlayerFacingContent,
  fallback: GameConfigData
): GameConfigData {
  return configDataRegistry.get(content.gameId) ?? fallback;
}

/**
 * Собирает полный GameConfig из сериализуемых данных,
 * находя зарегистрированную фабрику резолверов по gameId.
 *
 * Вызывается в клиентском компоненте (GamePlayer) после получения
 * GameConfigData от Server Component. Если игра не зарегистрировала plugin,
 * используется default-конфиг: он работает для манифестов с data-driven
 * screen routing и явными actionId в UI payload.
 */
export function buildGameConfig(data: GameConfigData): GameConfig {
  const factory = registry.get(data.gameId);
  if (!factory) {
    return createDefaultGameConfig(data);
  }
  return factory(data);
}
