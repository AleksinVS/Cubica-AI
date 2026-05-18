# SDK/shared — DEPRECATED

**Status:** @deprecated — This package is not used by any active application.

The UI components (GameButton, GameScreen, GameCard, GameVariable, GameArea, JournalVariable, HelperComponent) 
defined here have been superseded by local implementations in `apps/player-web/src/components/manifest/`.

The actions system (ViewAction, ActionBinding, ActionDispatcher) is superseded by the manifest action adapter
in `apps/player-web/src/lib/manifest-action-adapter.ts`.

This package is retained for reference only. Do not import it in new code.
For future SDK components, see ADR-014 (Viewers Library Architecture).

**Removal target:** After ADR-026 (Game-Agnostic Plugin Architecture) is fully implemented.