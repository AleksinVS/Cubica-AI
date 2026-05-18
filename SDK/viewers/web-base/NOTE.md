# SDK/viewers/web-base — DEPRECATED

**Status:** @deprecated — This package is not used by any active application.

The ManifestLoader, StateManager, and ActionRouter components defined here
have been superseded by the presenter layer in `apps/player-web/src/presenter/`
and the manifest renderer in `apps/player-web/src/components/manifest/`.

The type definitions (GameManifest, UIManifest, etc.) are superseded by the
contracts package in `packages/contracts/manifest/`.

This package is retained for reference only. Do not import it in new code.
For future SDK components, see ADR-014 (Viewers Library Architecture).

**Removal target:** After ADR-026 (Game-Agnostic Plugin Architecture) is fully implemented.