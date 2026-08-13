/**
 * Validate the only source that the local preview may materialize.
 *
 * Preview is an isolated delivery of an already publishable package. It must
 * never turn an authoring draft into a runtime-ready source or hide a blocker.
 */
export function assertReadyPreviewSourceManifest(manifest) {
  const config = manifest?.config;
  if (config?.runtimeReady !== true) {
    throw new Error(
      "Cards Money Trains preview requires a source with config.runtimeReady === true."
    );
  }
  if (Object.hasOwn(config, "runtimeBlockers")) {
    throw new Error(
      "Cards Money Trains preview requires runtimeBlockers to be absent from the source."
    );
  }
  return manifest;
}
