# ADR-053: Game-Defined UI Panels

- **Дата**: 2026-06-15
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: UI manifests, game manifests, `apps/player-web`, `games/*/plugins/*`, manifest schemas, authoring compiler
- **Связанные решения**: ADR-013, ADR-016, ADR-019, ADR-025, ADR-026, ADR-027, ADR-030, ADR-037, ADR-040, ADR-050

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Принятое решение](#4-принятое-решение)
- [5. Проверка game manifest](#5-проверка-game-manifest)
- [6. Целевая модель UI-манифеста](#6-целевая-модель-ui-манифеста)
- [7. Runtime и Presenter](#7-runtime-и-presenter)
- [8. Миграция без legacy fallback](#8-миграция-без-legacy-fallback)
- [9. Архитектурные инварианты](#9-архитектурные-инварианты)
- [10. Отклоненные альтернативы](#10-отклоненные-альтернативы)
- [11. Последствия](#11-последствия)

## 1. Понимание решения

Решение понято так: журнал ходов в `Antarctica` не должен быть платформенным UI-компонентом. Платформа может знать общий механизм открытия дополнительной панели, но внешний вид, состав данных, подписи, группировка записей и метрики журнала должны принадлежать UI-манифесту конкретной игры и ее player-web плагину.

Также принято ограничение по миграции: работу нужно делать последовательно, но без сохранения постоянного legacy fallback. После перевода `Antarctica` на манифестную панель старый платформенный `JournalRenderer` и специальные команды вида `showHistory` должны быть удалены, а не оставлены вторым путем.

## 2. Контекст

Предыдущая нормализация web UI-манифеста `Antarctica` сократила сценарные screen keys до переиспользуемых вариантов:

- `S1`;
- `S1_LEFT`;
- `board-topbar`;
- `info-topbar`.

После этого возник вопрос, почему в списке нет журнала ходов. Текущий ответ в коде: журнал существует не как `screens.*`, а как платформенный React-компонент `JournalRenderer`, который открывается через `activePanel === "history"`.

Это нарушает границу ADR-013:

- game manifest должен описывать игровую модель и исполнимую логику;
- UI manifest должен описывать channel-specific отображение;
- player-web может дать generic renderer and lifecycle, но не должен владеть предметным UI конкретной игры.

## 3. Термины

- **Панель** - временный слой интерфейса поверх текущего игрового экрана. Панель не является шагом сценария и не меняет `timeline.stepIndex`.
- **Overlay** - способ показа панели поверх текущего экрана без замены основного игрового состояния.
- **UI-only action** - действие интерфейса, которое меняет только локальное отображение, например открывает панель журнала. Оно не является игровым ходом и не должно попадать в game manifest как deterministic game action.
- **Player-facing projection** - модель данных для отображения игроку, которую Presenter или игровой плагин строит из game content и session state.
- **Legacy fallback** - старый запасной путь исполнения. В этой миграции он запрещен как постоянный результат: если `Antarctica` переведена на `ui.panels.history`, старый `JournalRenderer` должен быть удален.

## 4. Принятое решение

Cubica вводит game-defined UI panels:

1. UI-манифест получает отдельный registry `panels`.
2. `screens` остаются основными игровыми visual states: старт, инфо, доска, сайдбар и подобные состояния.
3. `panels` описывает временные слои UI: журнал ходов, подсказки, инвентарь, справку, модальные игровые панели.
4. Платформа знает общий lifecycle панели: открыть, закрыть, найти `gameUi.panels[panelId]`, отрендерить через декларативный manifest renderer.
5. Платформа не содержит специального `history` renderer, специальной верстки карточек журнала или game-specific текста.
6. Game-specific данные для панели готовит plugin или default Presenter projection.
7. UI-only actions живут в UI-манифесте как команды presenter/view layer, а не как deterministic actions в game manifest.
8. Если игра хочет открыть панель как следствие настоящего игрового хода, это должно быть явно описано как runtime capability and schema-defined effect. Обычная кнопка "Журнал ходов" таким игровым ходом не является.

## 5. Проверка game manifest

Первичная проверка `games/antarctica/game.manifest.json` показала похожий архитектурный разрыв:

- `showHistory` является action в game manifest и открывает `panelId: "history"` через `ui.panel.open`;
- `showHint` открывает `panelId: "hint"`;
- `showTopBar` открывает `panelId: "top-bar"`;
- `showScreenWithLeftSideBar` открывает UI screen/layout через `ui.screen.open`;
- эти actions дополнительно пишут `log.append` с `kind: "ui-panel-open"` или `kind: "ui-screen-open"`.

Это не UI-разметка журнала внутри game manifest, но это UI-only behavior внутри логического манифеста. Для целевой модели это тоже проблема.

Принятое правило:

- game manifest может хранить игровые log events, например выбор карточки, изменение метрик, переход сценария;
- game manifest не должен хранить UI-only actions для открытия журнала или других purely visual panels;
- открытие журнала не должно загрязнять игровой журнал ходов записью `ui-panel-open`;
- данные, которые журнал показывает, должны оставаться игровыми событиями (`log.append` карточек, metric snapshots, selected objects), но layout журнала и фильтрация записей должны описываться в UI manifest/player-facing projection.

## 6. Целевая модель UI-манифеста

UI manifest должен поддерживать отдельный map-like registry. JSON Schema должна описывать его декларативно, через typed values for arbitrary keys, not TypeScript-only guards.

Пример shape:

```json
{
  "screens": {
    "S1": {},
    "S1_LEFT": {},
    "board-topbar": {},
    "info-topbar": {}
  },
  "panels": {
    "history": {
      "type": "panel",
      "mode": "overlay",
      "design_artifact_id": "moves-journal",
      "root": {}
    }
  }
}
```

Для `Antarctica` журнал ходов должен быть именно `panels.history`, потому что:

- он не является step in timeline;
- он не должен занимать отдельный `screenId`;
- он переиспользуется поверх разных текущих экранов;
- его внешний вид зависит от дизайна конкретной игры.

Кнопки должны использовать общий command:

```json
{
  "command": "showPanel",
  "payload": { "panelId": "history" }
}
```

Старый command `showHistory` не является целевым контрактом.

## 7. Runtime и Presenter

Presenter owns transient UI state. В первом срезе открытая панель может храниться в client-side state player-web, потому что это состояние отображения конкретного игрока.

Если потребуется серверно-синхронизированная панель, это должно быть отдельное решение:

- с явным scope: session, player или facilitator;
- с JSON Schema для effects;
- с правилами replay/audit;
- без implicit coupling к `history`.

Для текущей миграции:

- `showPanel/history` не должен отправляться в runtime-api как game action;
- `showPanel/hint` не должен отправляться в runtime-api как game action;
- `showPanel/history` не должен менять authoritative game state;
- runtime log остается источником данных журнала, но не способом открыть саму панель.

## 8. Миграция без legacy fallback

Миграция должна идти последовательными шагами, но каждый шаг должен оставлять один целевой путь:

1. Добавить `panels` в UI manifest schema and contracts.
2. Добавить manifest rendering path for active panel.
3. Описать `panels.history` в `games/antarctica/authoring/ui/web.authoring.json`.
4. Подготовить `journalEntries` или эквивалентную projection in Antarctica plugin.
5. Перевести кнопку журнала на `showPanel` with `panelId: "history"`.
6. Удалить `showHistory` из Antarctica game authoring/runtime manifests.
7. Удалить platform-specific `JournalRenderer`, его прямую ветку `activePanel === "history"` and dedicated tests.
8. Повторить тот же cleanup для `showHint`, `showTopBar` and `showScreenWithLeftSideBar`.
9. Обновить tests to assert manifest-defined panel rendering.
10. Пересобрать authoring manifests and published Antarctica player bundle.

Не допускается финальное состояние, где:

- `gameUi.panels.history` существует, но `JournalRenderer` остается fallback;
- `showHistory` поддерживается как второй постоянный command;
- `showHint`, `showTopBar` or `showScreenWithLeftSideBar` поддерживаются как постоянные runtime actions for local UI;
- game manifest продолжает содержать UI-only action for history;
- journal UI rendering still lives in platform-specific React component.

## 9. Архитектурные инварианты

- `screens` are not panels.
- `panels` are not scenario timeline steps.
- UI-only action must not be a game action.
- Journal UI is game-defined, not platform-owned.
- Platform may own generic panel lifecycle and generic manifest renderer only.
- JSON Schema remains the source of truth for manifest structures.
- Game-specific journal projection belongs in game plugin/default presenter projection, not `runtime-api`.
- Opening a local panel must not create runtime audit log entries.
- Runtime log entries remain domain events and may be rendered by panels.
- Removing legacy is part of the migration, not a follow-up.

## 10. Отклоненные альтернативы

### Добавить журнал как `screens.history`

Отклонено. Журнал не является сценарным экраном и не должен увеличивать count of primary screen variants.

### Оставить `JournalRenderer` как platform fallback

Отклонено для этой миграции. Это сохраняет второй источник UI truth and hides game-specific design in platform code.

### Оставить `showHistory` в game manifest

Отклонено. Открытие журнала из кнопки является UI-only action. Game manifest должен хранить игровые события, а не commands for local visual panels.

### Сделать весь panel system game-specific

Отклонено. Механизм открытия и закрытия панели полезен для класса игр, поэтому lifecycle and schema support belong to the platform. Game-specific остается layout, data projection and content.

## 11. Последствия

- UI manifest schema получает новую first-class секцию `panels`.
- Player-web должен рендерить active panel through ManifestRenderer.
- `Antarctica` получает explicit `panels.history`.
- `Antarctica` получает explicit `panels.hint`.
- Старые platform `JournalRenderer` and `HintRenderer` удаляются.
- Game manifest cleanup removes UI-only history, hint, topbar and left-sidebar actions.
- Tests must cover absence of history/hint UI in platform-specific code and absence of UI-only local panel/layout actions in game manifest.
- Existing journal data model may remain based on runtime log entries, but its display is controlled by game-defined UI.
