# Cubica current canonical slice architecture review

**Date:** 21 March 2026  
**Author:** Codex  
**Type:** Architecture review of the current canonical slice and the `$cubica` operating model

## Findings

1. High: the canonical documentation still describes a system model that is no longer current, so new agents can start from the wrong architecture. `repo-manifest.json` still points agents to [PROJECT_OVERVIEW.md](/home/abc/projects/Cubica-AI/PROJECT_OVERVIEW.md#L207), [PROJECT_STRUCTURE.md](/home/abc/projects/Cubica-AI/PROJECT_STRUCTURE.md), and [PROJECT_ARCHITECTURE.md](/home/abc/projects/Cubica-AI/docs/architecture/PROJECT_ARCHITECTURE.md#L37), but those documents still mix the old `LLM-first` service stack, legacy player references, and target architecture language with the current canonical slice. That conflicts with [NEXT_STEPS.md](/home/abc/projects/Cubica-AI/NEXT_STEPS.md#L5) and [services/runtime-api/HANDOFF.md](/home/abc/projects/Cubica-AI/services/runtime-api/HANDOFF.md#L5), which describe the actual runtime-api + player-web slice. Improvement: split `current canonical architecture` from `target architecture`, then rewrite the overview docs around the real runtime slice.

2. High: the legacy Antarctica player path still leaks into the repository contract. The root workspace in [package.json](/home/abc/projects/Cubica-AI/package.json#L6) still contains `games/antarctica-nextjs-player`, but that directory is gone. At the same time, canonical UI manifests still point assets at the dead path in [games/antarctica/ui/web/ui.manifest.json](/home/abc/projects/Cubica-AI/games/antarctica/ui/web/ui.manifest.json#L219) and [games/antarctica/ui/telegram/ui.manifest.json](/home/abc/projects/Cubica-AI/games/antarctica/ui/telegram/ui.manifest.json#L60). Improvement: remove the dead workspace entry and move assets to a canonical location such as `games/antarctica/assets` or `apps/player-web/public`.

3. Medium-High: `runtime-api` is framed as a modular monolith, but the module boundaries are still mostly folder-level. [services/runtime-api/src/modules/player-api/httpServer.ts](/home/abc/projects/Cubica-AI/services/runtime-api/src/modules/player-api/httpServer.ts#L17) owns a process-global in-memory store, and the transport layer also loads manifests directly from the repo filesystem during request handling: [httpServer.ts](/home/abc/projects/Cubica-AI/services/runtime-api/src/modules/player-api/httpServer.ts#L49), [services/runtime-api/src/modules/content/manifestLoader.ts](/home/abc/projects/Cubica-AI/services/runtime-api/src/modules/content/manifestLoader.ts#L13). Improvement: introduce explicit ports for `SessionStore`, `ContentRepository`, and `Clock/EventLog`, wire them in bootstrap, and keep HTTP handlers thin.

4. Medium: the current deterministic runtime proves plumbing, but not real game mechanics. The Antarctica manifest currently defines capability toggles in [games/antarctica/game.manifest.json](/home/abc/projects/Cubica-AI/games/antarctica/game.manifest.json#L137) more than domain transitions, and [services/runtime-api/src/modules/runtime/deterministicHandlers.ts](/home/abc/projects/Cubica-AI/services/runtime-api/src/modules/runtime/deterministicHandlers.ts#L117) mainly logs actions and flips UI/runtime markers. Improvement: add a separate domain-mechanics layer for `Antarctica` so manifest actions drive explicit transitions over `timeline`, `metrics`, `flags`, and hidden state, while capability routing stays a platform concern.

5. Medium: `player-web` is canonical, but it still depends on monorepo filesystem layout rather than a stable content/runtime boundary. [apps/player-web/src/lib/antarctica.ts](/home/abc/projects/Cubica-AI/apps/player-web/src/lib/antarctica.ts#L20) reads `games/antarctica/*` directly from the repository, and [apps/player-web/src/lib/antarctica.ts](/home/abc/projects/Cubica-AI/apps/player-web/src/lib/antarctica.ts#L58) assumes a local runtime URL by default. Improvement: add a versioned content-bundle boundary so the client consumes a stable bundle API instead of repo paths.

6. Medium: the `$cubica` process layer is useful, but it is currently over-constrained and tool-coupled. [SKILL.md](/home/abc/ai-agents/.codex/skills/cubica/SKILL.md#L23) and [AGENTS.md](/home/abc/projects/Cubica-AI/AGENTS.md#L21) hardcode a split between built-in Codex subagents for architecture/review and `opencode` with `minimax/M2.7` for coding. That is brittle because the repo-local rules are not a portable execution contract for `opencode`, and the exact model id may not match the runnable provider name. Improvement: make the repo-local process contract capability-based, add a fallback policy, and keep `$cubica` as a Codex wrapper rather than a hard dependency.

7. Medium: the manifest validation layer is already useful, but it still bakes Antarctica-specific structure into a generic contract layer. `services/runtime-api/src/modules/content/manifestValidation.ts` requires `state.public.timeline.stepIndex`, `stageId`, `screenId`, `flags.cards`, and other Antarctica-specific shapes. That is acceptable for the current game, but it is not yet a scalable generic manifest validator. Improvement: split core protocol validation from per-game validation profiles.

## Remediation Order

1. Repair the truth model first.
2. Remove legacy workspace and asset-path leaks.
3. Harden `runtime-api` boundaries around explicit ports and bootstrap wiring.
4. Promote `Antarctica` from plumbing demo to domain mechanics.
5. Relax `$cubica` into a capability-based process policy with fallback rules.
6. Separate core manifest validation from game-specific validation profiles.

## Bottom Line

The project has a real canonical slice now, but the docs, repo index, runtime boundaries, and process rules are not fully aligned with it yet. The main risk is not missing code, but contradictory source-of-truth layers that still tell new agents to reason about an older architecture.
