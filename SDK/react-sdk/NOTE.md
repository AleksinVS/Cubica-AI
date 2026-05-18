# SDK/react-sdk — DEPRECATED

**Status:** @deprecated — This package is not used by any active application.

The hooks (useCubicaSession, useViewState) and GameCanvas component defined here
have been superseded by the presenter layer in `apps/player-web/src/presenter/`
(GamePresenter, ReactViewGateway).

The router client (createRouterClient) is superseded by the runtime client
in `apps/player-web/src/presenter/runtime-client.ts`.

This package is retained for reference only. Do not import it in new code.
For future SDK components, see ADR-014 (Viewers Library Architecture).

**Removal target:** After ADR-026 (Game-Agnostic Plugin Architecture) is fully implemented.