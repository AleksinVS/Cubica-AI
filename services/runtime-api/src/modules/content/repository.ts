export interface IGameRepository {
  getManifestRaw(gameId: string): Promise<string>;
  getUiManifestRaw(gameId: string): Promise<string | undefined>;
  getMockupFiles(gameId: string): Promise<Array<{ filename: string; raw: string }>>;
}
