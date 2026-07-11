export interface IGameRepository {
  /**
   * Lists the ids of games that have a loadable manifest in this repository.
   *
   * Used by readiness probes to discover a game to load without hardcoding a
   * concrete game id (platform purity: no game-specific ids in core layers).
   * Order is repository-defined but should be stable across calls so probes
   * behave deterministically.
   */
  listGameIds(): Promise<readonly string[]>;
  getManifestRaw(gameId: string): Promise<string>;
  getUiManifestRaw(gameId: string): Promise<string | undefined>;
  getMockupFiles(gameId: string): Promise<Array<{ filename: string; raw: string }>>;
  getPublishedPlayerWebPluginBundlesRaw(gameId: string): Promise<string | undefined>;
  getPublishedPlayerWebPluginBundleRaw(gameId: string, gameRootRelativeFilePath: string): Promise<string>;
  /** Returns the optional ADR-063 registry. Absence means this game has no channel assets. */
  getGameAssetsRegistryRaw(gameId: string): Promise<string | undefined>;
  /** Reads metadata after enforcing containment inside games/<id>/assets/. */
  getGameAssetFileMetadata(gameId: string, relativeFilePath: string): Promise<GameAssetFileMetadata>;
  /** Reads bytes after enforcing the same containment check as metadata access. */
  getGameAssetFileBytes(gameId: string, relativeFilePath: string): Promise<Buffer>;
}

export interface GameAssetFileMetadata {
  readonly mtimeMs: number;
  readonly size: number;
  readonly extension: string;
}
