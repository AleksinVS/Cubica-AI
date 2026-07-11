# Game-Agnostic Architecture Simplification Execution Matrix

## Оглавление

- [Purpose](#purpose)
- [Terms](#terms)
- [Finding Matrix](#finding-matrix)
- [Execution Matrix](#execution-matrix)
- [Implementation Evidence](#implementation-evidence)
- [Validation Matrix](#validation-matrix)
- [Risk Register](#risk-register)
- [Execution Notes](#execution-notes)

## Purpose

This document turns the 2026-05-21 architecture analysis into executable work. It complements `docs/tasks/archive/TSK-20260521-game-agnostic-architecture-simplification.md` and should be updated after every implementation slice.

## Terms

- Generic layer - общий слой платформы, который должен работать для разных игр.
- Game-specific layer - слой конкретной игры: game bundle, UI manifest или plugin.
- Acceptance evidence - проверяемое доказательство, что изменение действительно выполнено.
- Drift - расхождение между текущей реализацией и целевой архитектурой.

## Finding Matrix

| ID | Finding | Severity | Classification | Primary files | Decision |
| --- | --- | --- | --- | --- | --- |
| GA-001 | `player-web` always passes `ANTARCTICA_GAME_CONFIG_DATA` even for another `gameId`. | critical | Architectural bug | `apps/player-web/app/page.tsx`, `apps/player-web/src/presenter/*` | Implement default config selection by `content.gameId`. |
| GA-002 | `deterministicHandlers.ts` contains platform-level semantic fields for `opening`, cards, team selection and board transitions. | high | Risk of game-specific drift | `services/runtime-api/src/modules/runtime/deterministicHandlers.ts`, manifest schema, contracts | Replace with neutral primitives or register as explicit reusable capability/legacy gap. |
| GA-003 | `scaffold-game.js` generates resolvers that disable data-driven routing. | high | Tooling contradiction | `scripts/dev/scaffold-game.js`, generated plugin files | Do not generate no-op routing/layout resolvers. |
| GA-004 | Generic journal filters Antarctica action prefixes and log kinds. | high | UI game-specific leak | `apps/player-web/src/components/panels/journal-renderer.tsx` | Add neutral log metadata and move Antarctica specifics to plugin/data. |
| GA-005 | Manifest validation still uses Ajv `strict: false` and manual `templateId` cross-validation. | medium | Existing planned drift | `services/runtime-api/src/modules/content/manifestValidation.ts`, strict-validation TSK | Keep under strict-validation task; do not add more manual validators. |
| GA-006 | Contracts/schema/runtime support different deterministic fields and operators. | medium | Contract drift | `packages/contracts/manifest/src/index.ts`, `docs/architecture/schemas/game-manifest.schema.json`, runtime tests | Synchronize as part of runtime semantics neutrality. |
| GA-007 | `gameId` is accepted as any non-empty string before local file path resolution. | medium | Boundary hardening issue | `requestValidation.ts`, `localFileRepository.ts` | Add safe id pattern or catalog lookup before repository access. |
| GA-008 | Only Antarctica proves the platform path. | high | Missing architecture proof | `games/*`, `apps/player-web/e2e`, runtime tests | Add a small second game as an architecture conformance fixture. |

## Execution Matrix

| Phase | Work item | Owner area | File set | Acceptance evidence | Dependencies |
| --- | --- | --- | --- | --- | --- |
| 1 | Add default `GameConfigData` builder. | player-web presenter | `apps/player-web/src/presenter/game-config.ts`, `apps/player-web/app/page.tsx` | Non-Antarctica content can boot with default config. | Existing `PlayerFacingContent.ui.metricSpecs`. |
| 1 | Make plugin lookup optional for data-driven games. | player-web registry | `game-config-registry.ts`, `GamePlayer`, tests | Missing plugin no longer fails when UI manifest is sufficient. | Default config builder. |
| 1 | Add unit test for `gameId=simple-choice` config path. | player-web tests | `apps/player-web/src/components/*test.tsx` or presenter tests | Test proves `ANTARCTICA_GAME_CONFIG_DATA` is not used. | Test fixture content. |
| 2 | Fix scaffold no-op resolvers. | developer tooling | `scripts/dev/scaffold-game.js` | Generated plugin relies on generic screen router by default. | None. |
| 2 | Add scaffold output check. | developer tooling tests | script test or snapshot fixture | Scaffold fails if it reintroduces empty `resolveScreenKey`. | Chosen test runner. |
| 3 | Classify each runtime semantic field. | runtime/contracts | `deterministicHandlers.ts`, schema, contracts | Table in task handoff lists keep/replace/legacy decision per field. | ADR-024 and ADR-029. |
| 3 | Replace easy fields with `stateConditions` and `statePatches`. | runtime/content | manifest and runtime tests | Antarctica flow remains green; second game can reuse neutral primitives. | Strict schema updates. |
| 3 | Register remaining bounded gaps. | governance | `docs/legacy/debt-log.csv`, `stubs-register.md` | `node scripts/ci/validate-legacy.js` passes. | If field cannot be removed safely. |
| 4 | Add neutral journal metadata. | contracts/runtime/player-web | contracts, manifest schema, runtime log builder, journal renderer | Journal uses metadata, not action prefixes. | Runtime log compatibility plan. |
| 4 | Move remaining hardcoded panel strings to locale. | player-web UI | panel components and locale files | `rg` finds no user-facing Russian strings outside manifest/test/locale/plugin. | None. |
| 5 | Add simple example game. | games/content | `games/<id>/`, `.desc.json`, UI manifest | Runtime creates session and dispatches at least one action. | Schema and default config path. |
| 5 | Add multi-game e2e smoke. | e2e | `apps/player-web/e2e/*`, Playwright config if needed | CI proves Antarctica and simple example both boot. | Example game. |
| 6 | Update architecture docs and structure index. | docs/governance | `PROJECT_OVERVIEW.md`, `PROJECT_ARCHITECTURE.md`, `PROJECT_STRUCTURE.yaml` | Docs match actual code and `generate-structure` passes. | Implementation phases complete. |

## Implementation Evidence

| Work item | Status | Evidence |
| --- | --- | --- |
| Default `GameConfigData` builder | done | `createDefaultGameConfigData()` and `createDefaultGameConfig()` in `apps/player-web/src/presenter/game-config.ts`. |
| Optional plugin lookup | done | `buildGameConfig()` now falls back to default config when no factory is registered. |
| Page config selection by loaded content | done | `apps/player-web/app/page.tsx` uses `resolveGameConfigData(content)` instead of passing Antarctica config directly. |
| Scaffold no-op resolver removal | done | `scripts/dev/scaffold-game.js` no longer emits `resolveScreenKey` or `resolveLayoutMode`. |
| Runtime semantic registration | done | Bounded fields are typed in `packages/contracts/manifest/src/index.ts` and JSON Schema. |
| Generic journal neutrality | done | `JournalRenderer` uses `entityType`/`displayMode` and no longer checks Antarctica prefixes. |
| Second game proof | done | `games/simple-choice/` plus runtime, unit and e2e tests. |
| CI invariant | done | `scripts/ci/validate-game-agnostic.js` is included in `npm run verify:canonical`. |

## Validation Matrix

| Check | Command | Expected result |
| --- | --- | --- |
| Canonical verification | `npm run verify:canonical` | Runtime, player-web and governance checks pass. |
| E2E verification | `npm run test:e2e` | Antarctica and example game browser flows pass. |
| Legacy/stub governance | `node scripts/ci/validate-legacy.js` | No undocumented runtime semantics gap remains. |
| Structure index | `node scripts/dev/generate-structure.js` | `PROJECT_STRUCTURE.yaml` includes new game/docs directories. |
| Game-specific leak review | `rg -n 'ANTARCTICA_GAME_CONFIG_DATA|opening\\.card|opening-card-resolution|gameId ===' apps/player-web services/runtime-api packages/contracts` | Remaining hits are only Antarctica plugin, fixtures, tests or registered legacy. |
| Schema strictness | strict-validation task command set | No new manual manifest validators were added. |

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Over-generalizing runtime into a large workflow engine too early. | More complexity without proof from multiple games. | Prefer Tier 1 templates, Tier 2 JsonLogic and small neutral primitives. Escalate DSL changes to ADR. |
| Breaking Antarctica while removing game-specific leaks. | Regression in current canonical game. | Keep Antarctica e2e and runtime tests as required checks. |
| Creating a fake second game that does not exercise real boundaries. | False confidence in game-agnostic architecture. | Example game must create session, render UI manifest and dispatch a runtime action. |
| Leaving semantic fields in runtime undocumented. | Hidden drift returns. | Register every deferred field in legacy debt or schema/contracts. |
| Making plugin optional but failing silently for complex games. | Hard-to-debug UI failures. | Default path must produce explicit errors when UI manifest lacks required data. |

## Execution Notes

- Do Phase 1 before adding the example game; otherwise the example will inherit the Antarctica config bug.
- Avoid changing `ADR-030` authoring compiler scope during this work. That compiler is a later authoring optimization, not a prerequisite for game-agnostic runtime.
- Do not remove Antarctica plugin just to prove generic behavior. The target is plugin-optional for simple games and plugin-supported for complex games.
- Keep all new game fixtures small enough for review. The second game is an architecture conformance fixture, not a production content pack.
