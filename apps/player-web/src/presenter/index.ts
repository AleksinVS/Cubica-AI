export { GamePresenter } from "./game-presenter";
export { ReactViewGateway } from "./react-view-gateway";
export { createNewSession, resumeSession, dispatchAction } from "./runtime-client";
export type { ClientRequest, PlayerState } from "./types";
export type { GameConfig, GameConfigData, GameConfigResolvers, FallbackMetricSpec, ResolverFactory } from "./game-config";
export { buildGameConfig, registerGameResolvers } from "./game-config-registry";
export { ANTARCTICA_GAME_CONFIG_DATA } from "./antarctica-config-data";