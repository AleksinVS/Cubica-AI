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
- [5. Целевая модель UI-манифеста](#5-целевая-модель-ui-манифеста)
- [6. Runtime и Presenter](#6-runtime-и-presenter)
- [7. Архитектурные инварианты](#7-архитектурные-инварианты)
- [8. Отклоненные альтернативы](#8-отклоненные-альтернативы)
- [9. Последствия](#9-последствия)

## 1. Понимание решения

Решение понято так: предметная панель конкретной игры не должна быть
платформенным UI-компонентом. Платформа знает общий механизм открытия панели,
но внешний вид, состав данных, подписи и группировка принадлежат UI-манифесту
игры и её player-facing проекции.

После перехода на манифестную панель прежний game-specific renderer или команда
не могут оставаться постоянным fallback: это создало бы второй источник UI truth.

## 2. Контекст

Размещение предметной панели в платформенном renderer нарушает границу ADR-013:

- game manifest должен описывать игровую модель и исполнимую логику;
- UI manifest должен описывать channel-specific отображение;
- player-web может дать generic renderer and lifecycle, но не должен владеть предметным UI конкретной игры.

## 3. Термины

- **Панель** - временный слой интерфейса поверх текущего игрового экрана. Панель не является шагом сценария и не меняет `timeline.stepIndex`.
- **Overlay** - способ показа панели поверх текущего экрана без замены основного игрового состояния.
- **UI-only action** - действие интерфейса, которое меняет только локальное отображение, например открывает панель журнала. Оно не является игровым ходом и не должно попадать в game manifest как deterministic game action.
- **Player-facing projection** - модель данных для отображения игроку, которую Presenter или игровой плагин строит из game content и session state.
- **Legacy fallback** - старый запасной путь исполнения, запрещённый как
  постоянный результат после перехода на manifest-defined panel.

## 4. Принятое решение

Cubica вводит game-defined UI panels:

1. UI-манифест получает отдельный registry `panels`.
2. `screens` остаются основными игровыми visual states: старт, инфо, доска, сайдбар и подобные состояния.
3. `panels` описывает временные слои UI: журнал, подсказки, инвентарь, справку
   и другие модальные игровые панели.
4. Платформа знает общий lifecycle панели: открыть, закрыть, найти `gameUi.panels[panelId]`, отрендерить через декларативный manifest renderer.
5. Платформа не содержит специального `history` renderer, специальной верстки карточек журнала или game-specific текста.
6. Game-specific данные для панели готовит plugin или default Presenter projection.
7. UI-only actions живут в UI-манифесте как команды presenter/view layer, а не как deterministic actions в game manifest.
8. Если игра открывает панель как следствие игрового хода, это явно описывается
   как runtime capability и schema-defined effect. Локальная UI-команда не
   является игровым ходом.

## 5. Целевая модель UI-манифеста

UI manifest должен поддерживать отдельный map-like registry. JSON Schema должна описывать его декларативно, через typed values for arbitrary keys, not TypeScript-only guards.

Пример shape:

```json
{
  "screens": {
    "primary": {},
    "secondary": {}
  },
  "panels": {
    "details": {
      "type": "panel",
      "mode": "overlay",
      "design_artifact_id": "details-panel",
      "root": {}
    }
  }
}
```

Кнопки используют общий command:

```json
{
  "command": "showPanel",
  "payload": { "panelId": "details" }
}
```

Специализированные команды для конкретного вида панели не являются целевым
контрактом.

## 6. Runtime и Presenter

Presenter owns transient UI state. Открытая локальная панель может храниться в
client-side state, потому что это состояние отображения конкретного игрока.

Если потребуется серверно-синхронизированная панель, это должно быть отдельное решение:

- с явным scope: session, player или facilitator;
- с JSON Schema для effects;
- с правилами replay/audit;
- без implicit coupling к `history`.

Локальная команда `showPanel` не отправляется в Runtime API как game action и
не меняет authoritative game state. Runtime-события могут быть источником данных
панели, но не способом открыть её.

## 7. Архитектурные инварианты

- `screens` are not panels.
- `panels` are not scenario timeline steps.
- UI-only action must not be a game action.
- Предметный UI панели определяется игрой, а не платформой.
- Platform may own generic panel lifecycle and generic manifest renderer only.
- JSON Schema remains the source of truth for manifest structures.
- Game-specific panel projection belongs in game plugin/default presenter projection, not `runtime-api`.
- Opening a local panel must not create runtime audit log entries.
- Runtime log entries remain domain events and may be rendered by panels.
- Legacy fallback не является постоянной частью целевого контракта.

## 8. Отклоненные альтернативы

### Представить временную панель как основной экран

Отклонено. Временная панель не является сценарным экраном и не должна
увеличивать число primary screen variants.

### Оставить предметный renderer как platform fallback

Отклонено для этой миграции. Это сохраняет второй источник UI truth and hides game-specific design in platform code.

### Оставить UI-only command в game manifest

Отклонено. Открытие локальной панели является UI-only action. Game manifest
должен хранить игровые события, а не команды локального отображения.

### Сделать весь panel system game-specific

Отклонено. Механизм открытия и закрытия панели полезен для класса игр, поэтому lifecycle and schema support belong to the platform. Game-specific остается layout, data projection and content.

## 9. Последствия

- UI manifest schema получает новую first-class секцию `panels`.
- Player-web должен рендерить active panel through ManifestRenderer.
- Предметные панели получают explicit entries в UI manifest.
- Старые platform-specific renderers не сохраняются как fallback.
- Game manifests не содержат локальные UI-only panel actions.
- Данные панели могут основываться на runtime-событиях, но их отображение
  контролирует game-defined UI.
