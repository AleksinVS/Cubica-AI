export interface ManifestBundleRef {
  gameId: string;
  version?: string;
  channel?: string;
}

export interface ManifestBundle<TManifest = Record<string, unknown>, TUiManifest = Record<string, unknown>> {
  gameId: string;
  manifest: TManifest;
  uiManifest?: TUiManifest;
}
