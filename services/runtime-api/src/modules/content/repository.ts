export interface IGameRepository {
  getManifestRaw(gameId: string): Promise<string>;
  getUiManifestRaw(gameId: string): Promise<string | undefined>;
  getMockupFiles(gameId: string): Promise<Array<{ filename: string; raw: string }>>;
  getPublishedPlayerWebPluginBundlesRaw(gameId: string): Promise<string | undefined>;
  getPublishedPlayerWebPluginBundleRaw(gameId: string, gameRootRelativeFilePath: string): Promise<string>;
}
