# TSK-20260630-player-web-renderer-purity: Declarative UI action binding and renderer purity

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Classification](#classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

partially-implemented (2026-07-04) — core declarative binding done; 2 sub-parts deferred

Выполнено ядро ADR-055: удалена game-specific привязка действий и ветка по CSS-классу
из generic-рендерера, введена декларативная привязка через UI-манифест, расширен
инвариант `verify:game-agnostic`. **Отложены (отдельные срезы):** обобщение
`resolveAreaCssClass` (topbar structural classes) и перенос Antarctica state-резолверов
(`team`/`card`/`opening`) из `player-web/src/lib/game-content-resolvers.ts` в
`games/antarctica/plugins/*`. Полная e2e visual-проверка не запускалась в текущем
sandbox (3 dev-сервера не поднялись за отведённое время) — изменение поведение-сохраняющее
по построению (см. Handoff Log), запустить `npm run test:e2e` в целевой среде.

## Understanding

Работа понята так: нужно убрать game-specific логику Antarctica из универсального
рендерера `player-web` и перенести «какой элемент несёт какое действие» в декларативные
поля UI-манифеста по ADR-055. Рендерер должен лишь исполнять декларацию.

## Architecture Source

- `docs/architecture/adrs/055-player-renderer-purity-and-declarative-ui-action-binding.md`
- `docs/architecture/adrs/001-model-view-presenter.md`
- `docs/architecture/adrs/013-logical-vs-ui-manifest.md`
- `docs/architecture/adrs/054-game-ui-manifest-boundary-and-metric-projection.md`
- `docs/architecture/schemas/ui-manifest.schema.json`
- `docs/reviews/2026-06-27-full-project-review.md` (раздел 1.1.A)

## Why

Generic renderer сейчас знает конкретную игру: ID кнопок, CSS-класс и русские подписи
Antarctica. Это нарушает platform purity (CLAUDE §10) и ADR-001/013/054, и заставит
новые игры и каналы расходиться.

## Current Findings

1. `apps/player-web/src/components/manifest/ui-component-node.tsx:27-28,51-85,154`
   хардкод `nav-right`/`btn-advance`/`btn-finish` и переписывание дерева UI.
2. `ui-component-node.tsx:263` ветка по `cssClass.includes("info-screen-shell")`.
3. `apps/player-web/src/lib/layout-helpers.ts:29-39` `resolveButtonId` по русским
   подписям; `:17-22` `resolveAreaCssClass` по структурным классам Antarctica.
4. `apps/player-web/src/lib/game-content-resolvers.ts:41-72,201-235` Antarctica-формы
   состояния (team/card/opening) в platform player lib (документировано в
   `universality-analysis.md §4`, переносится здесь).

## Target State

1. UI manifest schema получает декларативные поля привязки действия/навигации
   (`actionRole`, `navSlot` или финальные имена по schema review).
2. UI authoring-манифест Antarctica назначает forward-действие нужному элементу
   декларативно; перенос действия в коде рендерера удаляется.
3. Условный декоративный фон управляется declarative prop, не CSS-классом игры.
4. `resolveButtonId` (русские подписи) удалён; `resolveAreaCssClass` обобщён или удалён.
5. Antarctica-резолверы состояния перенесены в `games/antarctica/plugins/*`; в player
   lib остаются только game-agnostic ридеры.
6. `verify:game-agnostic` расширен проверкой отсутствия game-specific signals.

## Classification

General: декларативная схема привязки действий/навигации, чистый рендерер, CI-инвариант.
Game-specific: конкретные роли/значения Antarctica в её UI-манифесте и плагине.

## Scope

- Расширение UI manifest schema и регенерация TS (через TSK manifest-contract-parity).
- Изменение generic renderer и player lib (удаление game-specific веток).
- Миграция UI authoring-манифеста Antarctica на новые поля + перекомпиляция.
- Перенос Antarctica state-резолверов в плагин.
- Расширение `verify:game-agnostic`.

## Non-Goals

- Не менять визуал Antarctica.
- Не менять игровую логику и тексты.
- Не вводить per-game renderer plugin для базовой навигации.
- Не чинить баг форс-disabled здесь, если он уже закрыт в correctness TSK.

## Execution Plan

### Phase 1. Schema and contract

1. Добавить поля привязки действия/навигации в `ui-manifest.schema.json`.
2. Регенерировать/обновить TS-контракты (см. ADR-056).
3. Тесты схемы на новые поля.

### Phase 2. Renderer purity

1. Заменить `moveAdvanceActionToForwardNavigation` на связывание по `actionRole`/`navSlot`.
2. Заменить проверку `info-screen-shell` на declarative prop.
3. Удалить `resolveButtonId`; обобщить/удалить `resolveAreaCssClass`.

### Phase 3. Antarctica migration

1. Назначить forward-действие в UI authoring-манифесте Antarctica декларативно.
2. Перекомпилировать UI manifest и source map; проверить отсутствие runtime UI diff.
3. Перенести team/card/opening резолверы в Antarctica plugin; обновить plugin API.

### Phase 4. Invariant and tests

1. Расширить `scripts/ci/validate-game-agnostic.js` запретом game-specific signals в
   generic player layers.
2. Обновить тесты player-web.

### Phase 5. Closeout

1. Обновить статус, Handoff Log, `NEXT_STEPS.md`.

## Acceptance

- В generic renderer и player lib нет идентификаторов кнопок, CSS-классов и подписей,
  специфичных для конкретной игры.
- Forward/advance-навигация Antarctica работает через декларативную привязку.
- Декоративный фон управляется declarative prop.
- Antarctica-резолверы состояния живут в плагине, не в player lib.
- `verify:game-agnostic` падает при появлении game-specific signal в рендерере.
- Player-web tests и canonical slice зелёные, визуального регресса Antarctica нет.

## Validation

```text
npm run verify:game-agnostic
npm run verify:manifest-authoring
npm run typecheck --workspace @cubica/player-web && npm test --workspace @cubica/player-web
npm run test:e2e
```

## Risks

- Перенос действия в манифест может изменить порядок/состояние навигации - проверить e2e.
- Расширение инварианта может выявить иные скрытые утечки - фиксировать как долг.

## Handoff Log

- 2026-06-30: задача создана по результатам полного ревью; зависит от ADR-055 и
  (для регенерации TS) TSK manifest-contract-parity.
- 2026-07-04: реализовано ядро декларативной привязки (Phases 1–2 частично, 3–4).
  - **Мёртвый `resolveButtonId`** (сопоставление русских подписей → id кнопок) удалён
    из `apps/player-web/src/lib/layout-helpers.ts` — ноль потребителей в репозитории.
  - **Хардкод привязки действия удалён:** из `ui-component-node.tsx` убраны
    `FORWARD_NAV_BUTTON_ID`/`ADVANCE_BUTTON_IDS` и функция
    `moveAdvanceActionToForwardNavigation`, переписывавшая дерево по game-specific id.
    Рендерер теперь рендерит объявленные `children` как есть.
  - **Декларативная привязка в манифесте:** в UI authoring-манифесте Antarctica
    (`games/antarctica/authoring/ui/web.authoring.json`) стрелка `nav-right` теперь
    сама несёт `onClick: advance`, отдельная кнопка `btn-advance` удалена. Манифест
    перекомпилирован (`compile:manifests`); diff `ui.manifest.json` ТОЧНО повторяет
    прежний runtime-результат переноса (nav-right сохраняет свои props, btn-advance
    исчезает) → нет визуального изменения.
  - **Декоративный фон — declarative prop:** ветка `cssClass.includes("info-screen-shell")`
    заменена на `props.decorativeBackground === true`; топбар-случай оставлен как
    платформенный (`layoutMode === "topbar"`, эквивалент прежнего
    `topbar-screen-shell`, который добавляет сам рендерер). Экран Antarctica получил
    `decorativeBackground: true`. Добавлено поле `decorativeBackground?: boolean` в
    `GameUiScreenComponentProps` (props — открытый object в схеме, изменение схемы не
    требуется).
  - **Инвариант:** `scripts/ci/validate-game-agnostic.js` теперь запрещает `nav-right`,
    `btn-advance`, `btn-finish`, `info-screen-shell` в `ui-component-node.tsx` и русские
    подписи `журнал`/`подсказ` в `layout-helpers.ts`.
  - **Тесты:** `ui-component-node.test.tsx` переписан под декларативную модель
    (прямая привязка действия, отсутствие переписывания дерева, `decorativeBackground`).
  - **Проверки:** `verify:game-agnostic`, `verify:manifest-authoring` (compiled drift),
    `verify:contracts-manifest` (ui.manifest валиден по схеме), player-web typecheck +
    130 тестов — зелёные. e2e не завершился в sandbox (dev-сервера не поднялись);
    поведение-сохранение доказано diff-построением, запустить `test:e2e` в целевой среде.
- 2026-07-04 (sub-part 2/2): **state-резолверы перенесены в плагин (ADR-055 §5).**
  Четыре game-specific ридера (`readTeamFlags`/`readCardObjects`/`readTeamSelection`/
  `readSelectedCardId`) и Antarctica-типы состояния (`TeamFlagState`,
  `TeamSelectionState`, `flags.team`/`objects.cards`/`teamSelection`,
  `opening.selectedCardId`) перенесены из `apps/player-web/src/lib/
  game-content-resolvers.ts` в `games/antarctica/plugins/antarctica-player/src/
  state-resolvers.ts` (читают через generic `readPublicState`/`readSecretState`).
  В player-web остались только generic ридеры; `player-plugin-api.ts` больше не
  реэкспортирует game-specific ридеры (экспонирует generic `readPublicState`/
  `readSecretState`). Направление зависимости строго plugin → player-web generic API.
  Тесты обновлены. Бандл плагина пересобран. Проверки: player-web typecheck+130,
  runtime-api 127, verify:game-agnostic — зелёные.
  - **Осталось (единственный отдельный срез):** `resolveAreaCssClass`
    (`layout-helpers.ts:6-24`) ещё ветвится по структурным классам Antarctica для
    topbar-модификаторов. Требует CSS-рефакторинга: **72** правила `topbar-*` в
    `globals.css` (включая вложенные `.topbar-board-title .game-card:hover` и т.п.)
    нужно перевести на descendant-селекторы от `.game-renderer--topbar` и убрать
    JS-навешивание классов. Визуальный риск → выполнять с e2e-приёмкой.
