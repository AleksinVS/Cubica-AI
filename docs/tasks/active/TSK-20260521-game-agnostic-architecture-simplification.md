# TSK-20260521-game-agnostic-architecture-simplification: Game-Agnostic Architecture Simplification

## Оглавление

- [Status](#status)
- [Why](#why)
- [Terms](#terms)
- [Architecture Baseline](#architecture-baseline)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Requirements](#requirements)
- [Plan](#plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

implemented

## Why

Архитектурный анализ от 2026-05-21 показал, что текущий canonical slice уже движется в правильную сторону: исполнимая логика живёт в `games/<id>/game.manifest.json`, `services/runtime-api` владеет runtime boundary, а `apps/player-web` получает player-facing content через API. При этом создание второй и следующих игр всё ещё требует слишком много ручных и Antarctica-specific действий.

Задача нужна, чтобы сделать добавление новой игры повторяемым процессом на основе уже созданных примеров, без необоснованного усложнения платформы и без потери качества текущей игры `Antarctica`.

## Terms

- Game-agnostic - независимый от конкретной игры подход, при котором общий слой платформы не содержит правил, названий и ветвлений одной игры.
- Runtime - исполняющий слой, который создаёт сессии, применяет действия и возвращает новое состояние.
- Plugin - подключаемый модуль игры в `player-web`, который содержит только game-specific резолверы, то есть функции преобразования общего контента и состояния в удобную для UI форму.
- Scaffold - генератор стартовых файлов для новой игры.
- JSON Schema - декларативная схема JSON-документа; в Cubica она является single source of truth для структуры манифеста.
- Single source of truth - единый источник истины, то есть один авторитетный документ или файл, с которым сверяются остальные слои.
- ADR - Architecture Decision Record, документ с устойчивым архитектурным решением и его последствиями.
- DSL - предметно-ориентированный язык правил, то есть небольшой язык описания логики для конкретной области.
- CI - автоматическая проверка изменений перед слиянием.

## Architecture Baseline

Работа реализует уже принятые решения, а не вводит новую целевую архитектуру:

- ADR-018: исполнимая логика игры хранится в JSON-манифесте.
- ADR-019: `runtime-api` владеет загрузкой game content и player-facing content API.
- ADR-024: bounded gameplay mechanics описываются явно в манифесте и deterministic state.
- ADR-026: `player-web` должен оставаться game-agnostic, а game-specific state живёт в plugin.
- ADR-027: screen routing, layout и metric specs должны быть data-driven, когда игре не нужен custom resolver.
- ADR-029: новые механики выбирают самый простой уровень из Tier 1 templates, Tier 2 JsonLogic и Tier 3 scripts.

Если реализация потребует нового runtime semantics layer, нового DSL или обязательного authoring compiler, нужно сначала создать отдельный ADR. Эта задача не должна скрыто менять архитектуру через код.

## Scope

Входит в работу:

- убрать обязательную привязку `apps/player-web/app/page.tsx` к `ANTARCTICA_GAME_CONFIG_DATA`;
- сделать default game config builder, который строит минимальную конфигурацию из `PlayerFacingContent` и `GamePlayerUiContent`;
- исправить `scripts/dev/scaffold-game.js`, чтобы generated plugin не отключал data-driven routing пустыми resolver methods;
- отделить game-specific journal/hint behavior от generic panel components;
- сузить game-specific runtime semantics в `services/runtime-api/src/modules/runtime/deterministicHandlers.ts` или зарегистрировать их как явный legacy gap;
- усилить контрактную нейтральность `packages/contracts/manifest`;
- добавить минимум одну small example game, которая запускается без Antarctica-specific правок platform layer;
- добавить проверку, что новая игра не требует изменений в generic runtime/player files без явной задачи и ADR.

## Non-Goals

Не входит в работу:

- внедрение полноценного authoring compiler из ADR-030;
- переписывание `runtime-api` в отдельные Router/Game Engine/Game Repository сервисы;
- перенос session persistence на PostgreSQL;
- полная замена UI-манифеста или renderer;
- удаление `Antarctica` plugin до полного покрытия всех экранов манифестом.

## Requirements

### R1. Default Game Path

Простая новая игра должна запускаться через:

1. `games/<gameId>/game.manifest.json`;
2. `games/<gameId>/ui/web/ui.manifest.json`;
3. generic `player-web` default config.

Custom plugin допускается только для конкретной game-specific логики, которую нельзя выразить через manifest routing, metric specs, state patches или JsonLogic.

### R2. Platform Purity

Generic files в `services/runtime-api`, `packages/contracts/*` и `apps/player-web/src/components/*` не должны получать новые проверки вида `if (gameId === "...")`, hardcoded action prefixes одной игры или semantic fields без схемы и ADR.

### R3. Lowest-Tier Logic

Новая механика должна классифицироваться перед реализацией:

- general - полезна классу игр или платформе;
- game-specific - нужна только одной игре или сценарию.

General mechanics идут в schema/contracts/reusable handlers. Game-specific mechanics остаются в game bundle, UI manifest или plugin.

### R4. Schema-As-Truth

Manifest validation должна оставаться декларативной. По справке Ajv strict mode помогает ловить неизвестные или игнорируемые ключи схемы; поэтому новые поля runtime semantics нельзя добавлять только через TypeScript `any` и ручные проверки.

### R5. Multi-Game Verification

CI или canonical verification должны запускать минимум один сценарий второй игры, чтобы game-agnostic поведение проверялось фактом, а не только документацией.

## Plan

### Phase 1. Project Boundary And Config Cleanup

1. Ввести default `GameConfigData` builder для `player-web`.
2. Изменить `apps/player-web/app/page.tsx`, чтобы config выбирался по `content.gameId`, а не всегда из `ANTARCTICA_GAME_CONFIG_DATA`.
3. Обновить plugin registry behavior: если plugin не зарегистрирован, использовать default renderer/config для games with data-driven UI.
4. Добавить тест на запуск неизвестной простой игры без Antarctica config.

### Phase 2. Scaffold Repair

1. Исправить `scripts/dev/scaffold-game.js`:
   - не генерировать `resolveScreenKey` и `resolveLayoutMode`, если они только возвращают fallback;
   - генерировать `.desc.json` для нового plugin directory, если создаётся значимый каталог;
   - печатать validation checklist после генерации.
2. Добавить fixture/test для scaffold output.
3. Обновить документацию `apps/player-web/README.md` с коротким сценарием добавления игры.

### Phase 3. Runtime Semantics Neutrality

1. Проверить, что runtime semantics описаны нейтральными guard/effect возможностями, а не полями под одну игру.
2. Для каждого поля выбрать один путь:
   - заменить на `effects[]`, guard, JsonLogic или template params;
   - оформить как reusable named capability в schema/contracts;
   - зарегистрировать bounded legacy gap с plan removal.
3. Убрать `any` там, где поле уже является частью manifest contract.
4. Синхронизировать `docs/architecture/schemas/game-manifest.schema.json`, `packages/contracts/manifest/src/index.ts` и tests.

### Phase 4. Generic Panels And Player UX

1. Убрать Antarctica action-prefix checks из generic `JournalRenderer`.
2. Ввести manifest/runtime metadata для journal visibility, например `log.displayMode` или `log.entityType`.
3. Перевести hardcoded panel strings в locale provider там, где они ещё остались.
4. Проверить, что `Antarctica` journal не деградировал.

### Phase 5. Multi-Game Proof

1. Добавить маленькую example game, например `games/examples/simple-choice` или `games/simple-choice`.
2. Описать для неё:
   - минимальный `game.manifest.json`;
   - `ui/web/ui.manifest.json`;
   - expected start/action flow.
3. Добавить runtime/player tests и e2e smoke.
4. Добавить CI check или расширить `npm run verify:canonical`.

### Phase 6. Documentation And Governance

1. Обновить `PROJECT_OVERVIEW.md` и `docs/architecture/PROJECT_ARCHITECTURE.md`, если фактическая game-agnostic модель изменилась.
2. Обновить `docs/tasks/active/TSK-20260518-contracts-neutrality-cleanup.md`, если часть scope закрыта этой задачей.
3. Обновить `docs/legacy/debt-log.csv`, если runtime semantics временно остаются как documented gap.
4. Запустить `node scripts/dev/generate-structure.js` после структурных изменений.

## Acceptance

- Новая simple game запускается в `player-web` без импорта Antarctica config и без изменений в `runtime-api` action dispatcher.
- `apps/player-web/app/page.tsx` выбирает config по gameId или использует default config.
- `scripts/dev/scaffold-game.js` создаёт plugin, который не отключает manifest-driven routing пустыми методами.
- Generic journal не проверяет `opening.card.*` или `opening-card-resolution` напрямую.
- Runtime semantics либо выражены neutral primitives, либо отражены в schema/contracts, либо зарегистрированы как legacy debt.
- Contract/schema/runtime не расходятся по поддерживаемым operators и deterministic fields.
- `npm run verify:canonical` и e2e/simple-game check проходят.

## Validation

```text
npm run verify:canonical
npm run test:e2e
node scripts/dev/generate-structure.js
node scripts/ci/validate-legacy.js
rg -n 'ANTARCTICA_GAME_CONFIG_DATA|opening\\.card|opening-card-resolution|gameId ===|strict: false' apps/player-web services/runtime-api packages/contracts docs/tasks/active
```

The final `rg` command is a review aid, not an automatic pass/fail gate. Expected remaining hits must be either game plugin/test fixtures, documented legacy rows, or active strict-validation work.

## Artifacts

- `docs/tasks/artifacts/TSK-20260521-game-agnostic-architecture-simplification/execution-matrix.md`

## Handoff Log

### 2026-05-21 - AI agent

- Created project and execution documentation from the 2026-05-21 architecture analysis.
- Bound the work to existing ADR-018, ADR-019, ADR-024, ADR-026, ADR-027 and ADR-029.
- Next safe implementation step: Phase 1 default config path, because it removes the current strongest blocker for adding a second game.

### 2026-05-21 - AI agent implementation

- Implemented the default `player-web` config path:
  - `apps/player-web/app/page.tsx` now resolves config from loaded `PlayerFacingContent`.
  - `buildGameConfig()` falls back to generic config when no plugin is registered.
  - Generic manifest commands dispatch explicit `payload.actionId` values.
- Added `games/simple-choice/` as a second game fixture with `game.manifest.json` and `ui/web/ui.manifest.json`.
- Fixed `scripts/dev/scaffold-game.js` so generated plugins do not include no-op `resolveScreenKey` or `resolveLayoutMode`.
- Replaced generic journal action-prefix filtering with neutral runtime log metadata:
  - `log.entityType`;
  - `log.displayMode`.
- Registered bounded runtime semantic fields in `packages/contracts/manifest` and `docs/architecture/schemas/game-manifest.schema.json` instead of leaving them runtime-only.
- Hardened `gameId` validation before local repository path resolution.
- Added `scripts/ci/validate-game-agnostic.js` and included it in `npm run verify:canonical`.

Runtime semantic decisions:

| Area | Decision |
| --- | --- |
| Guard checks | Registered in manifest contracts/schema as bounded reusable deterministic guard fields. |
| State changes | Migrated to schema-defined `effects[]`; runtime no longer carries the transitional state-update field set. |
| Collection thresholds and branching | Expressed through generic `when` conditions plus allowed effects. |
| `log.kind` display filtering | Replaced in generic journal by `log.entityType` and `log.displayMode`; Antarctica template now emits the neutral metadata. |

Validation evidence:

- `npm run verify:canonical` passed.
- `CI=1 E2E_RUNTIME_PORT=3331 E2E_PLAYER_PORT=3330 npm run test:e2e` passed.
- `node scripts/dev/generate-structure.js` passed and regenerated `PROJECT_STRUCTURE.yaml`.
- `node scripts/ci/validate-legacy.js` passed.
- `node scripts/ci/validate-game-agnostic.js` passed.
