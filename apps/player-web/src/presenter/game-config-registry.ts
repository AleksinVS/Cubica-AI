import type { GameConfigData, GameConfig, ResolverFactory } from "./game-config";

/**
 * Реестр фабрик резолверов для конфигураций игр.
 *
 * Generic-модуль — не содержит импортов конкретных игр.
 * Каждая игра регистрирует свою фабрику через registerGameResolvers()
 * в своём модуле регистрации (например, plugins/antarctica/register.ts).
 *
 * Платформенные компоненты (GamePlayer, GamePresenter) получают
 * GameConfigData через пропсы от Server Component и собирают
 * полный GameConfig через buildGameConfig(), который находит
 * нужную фабрику в реестре по gameId.
 */
const registry = new Map<string, ResolverFactory>();

/**
 * Регистрирует фабрику резолверов для игры.
 * Вызывается модулями регистрации игр (plugins/<gameId>/register.ts)
 * на этапе инициализации клиентского приложения.
 */
export function registerGameResolvers(
  gameId: string,
  factory: ResolverFactory
): void {
  registry.set(gameId, factory);
}

/**
 * Собирает полный GameConfig из сериализуемых данных,
 * находя зарегистрированную фабрику резолверов по gameId.
 *
 * Вызывается в клиентском компоненте (GamePlayer) после получения
 * GameConfigData от Server Component. Бросает ошибку, если фабрика
 * для указанного gameId не зарегистрирована.
 */
export function buildGameConfig(data: GameConfigData): GameConfig {
  const factory = registry.get(data.gameId);
  if (!factory) {
    throw new Error(
      `No resolver factory registered for game: "${data.gameId}". ` +
      `Ensure the game plugin registers its resolvers before the component renders.`
    );
  }
  return factory(data);
}