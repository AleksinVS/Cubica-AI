# Antarctica Manifest Cleanup Plan

Документ описывает, как закрывать долг в `games/antarctica/game.manifest.json` после переноса `player-web` плагина `Antarctica` в `games/antarctica/plugins/antarctica-player`.

Главная цель cleanup: убрать из манифеста и runtime-пути признаки временной миграции, не меняя поведение игры и не добавляя код под конкретную игру в общий `runtime-api`.

## Оглавление

- [1. Понимание задачи](#1-понимание-задачи)
- [2. Исходное состояние и результат](#2-исходное-состояние-и-результат)
- [3. Что не входит в cleanup](#3-что-не-входит-в-cleanup)
- [4. Целевое состояние](#4-целевое-состояние)
- [5. Классы долга](#5-классы-долга)
- [6. Порядок миграции](#6-порядок-миграции)
- [7. Runtime-api plugins как технический долг](#7-runtime-api-plugins-как-технический-долг)
- [8. Требования к проверкам](#8-требования-к-проверкам)
- [9. Условия остановки](#9-условия-остановки)
- [10. Связанные документы](#10-связанные-документы)

## 1. Понимание задачи

Задача понята так: `Antarctica` уже получила целевой project-local `player-web` плагин, но ее runtime manifest нес миграционный долг. Cleanup-срез нужен был, чтобы:

- заменить названия, привязанные к `Antarctica`, на общие названия возможностей платформы;
- убрать или переклассифицировать оставшиеся `handlerType: "script"` actions;
- не решать эту проблему полноценными runtime-плагинами;
- сохранить текущие action IDs, если нет отдельной совместимой миграции UI-ссылок;
- доказать поведенческую совместимость проверками.

Термин **cleanup** здесь означает не косметическую чистку, а плановое снятие архитектурного долга: временных форматов, названий и обработчиков, которые появились при переносе legacy-прототипа в manifest-driven runtime.

## 2. Исходное состояние и результат

Исходное состояние до cleanup было получено 2026-05-31 точечной проверкой скриптом на Node.js по `games/antarctica/game.manifest.json`; большой JSON-файл не анализировался вручную.

| Показатель до cleanup | Значение |
| --- | --- |
| Всего actions | 145 |
| `handlerType: "manifest-data"` | 140 |
| `handlerType: "script"` | 5 |
| `capabilityFamily: "antarctica.opening"` | 140 |
| `content.scripts` runtime script references | 1 |
| `capabilityFamily: "runtime.server"` | 1 |
| `capabilityFamily: "ui.panel"` | 3 |
| `capabilityFamily: "ui.screen"` | 1 |

Реализованный результат после cleanup 2026-05-31:

| Показатель после cleanup | Значение |
| --- | --- |
| Всего actions | 145 |
| `handlerType: "manifest-data"` | 145 |
| `handlerType: "script"` | 0 |
| `capabilityFamily: "antarctica.opening"` | 0 |
| `content.scripts` runtime script references | 0 |
| `capabilityFamily: "game.card.resolve"` | 71 |
| `capabilityFamily: "game.timeline.advance"` | 30 |
| `capabilityFamily: "game.info.advance"` | 27 |
| `capabilityFamily: "game.team.select"` | 10 |
| `capabilityFamily: "game.collection.threshold"` | 1 |
| `capabilityFamily: "game.team.confirm"` | 1 |
| `capabilityFamily: "runtime.server"` | 1 |
| `capabilityFamily: "ui.panel"` | 3 |
| `capabilityFamily: "ui.screen"` | 1 |

140 шаблонных `manifest-data` действий сгруппированы через 4 шаблона:

| Шаблон | Количество | Примеры action IDs |
| --- | ---: | --- |
| `opening-card-resolution` | 71 | `opening.card.1`, `opening.card.2`, `opening.card.3` |
| `opening-card-advance` | 30 | `opening.card.3.advance`, `opening.card.9.advance` |
| `opening-info-advance` | 27 | `opening.info.i0.advance`, `opening.info.i02.advance` |
| `opening-team-selection` | 10 | `opening.team.select.fedya`, `opening.team.select.aliona` |
| Без шаблона | 2 | `opening.board.25_30.advance`, `opening.team.confirm` |

Пять бывших `script` actions теперь описаны как `manifest-data` с `deterministic.effects`. Effect - это проверяемая JSON-операция, которую применяет `runtime-api`; это не произвольный JavaScript.

| Action ID | Семейство после cleanup | Эффекты |
| --- | --- | --- |
| `requestServer` | `runtime.server` | `runtime.server.request`, `log.append` |
| `showHint` | `ui.panel` | `ui.panel.open` с `panelId: "hint"`, `log.append` |
| `showHistory` | `ui.panel` | `ui.panel.open` с `panelId: "history"`, `log.append` |
| `showTopBar` | `ui.panel` | `ui.panel.open` с `panelId: "top-bar"`, `log.append` |
| `showScreenWithLeftSideBar` | `ui.screen` | `ui.screen.open` с `screenId: "left-sidebar"`, `log.append` |

Вывод: в cleanup закрыты главные признаки временной миграции - game-specific `capabilityFamily`, старый маркер `script` для общих UI/runtime команд и ссылка `content.scripts` на старую JS-заглушку. Нормализация раннего deterministic-формата для `Antarctica` тоже выполнена: манифест использует общий `effects[]` для timeline, flags, selection, collection threshold и точечных state patches.

## 3. Что не входит в cleanup

Этот cleanup-срез не должен:

- переносить игровую логику в `services/runtime-api` через проверки `gameId`;
- реализовывать полноценные runtime-api plugins;
- добавлять marketplace sandbox;
- менять сценарий, тексты, изображения или баланс игры;
- переписывать action IDs без отдельной совместимой миграции UI manifest;
- удалять `Antarctica` player plugin;
- добавлять npm-зависимости для plugin code.

Если в процессе cleanup понадобится новая серверная механика, сначала проверяется манифест и общая platform capability. Только если это не подходит, вопрос выносится отдельно по ADR-040.

## 4. Целевое состояние

Целевой manifest должен оставаться понятным как игровой документ, но форма данных для runtime должна быть общей:

- action IDs могут оставаться `opening.*`, потому что это локальные идентификаторы игрового сценария;
- `capabilityFamily` и `capability` должны описывать тип механики, а не имя игры;
- `handlerType: "script"` не используется для UI-панелей и простых runtime-маршрутов;
- изменения состояния описаны через проверяемые данные: guard, изменение метрики, патч состояния, переход timeline, операция flag/counter/collection, запись в журнал;
- JSON Schema остается единственным источником истины для новых полей;
- `runtime-api` применяет только проверенные патчи, эффекты или события и не дает плагину или коду прямой доступ к session store.

Пример целевого направления:

```json
{
  "handlerType": "manifest-data",
  "capabilityFamily": "game.card.resolve",
  "capability": "game.card.resolve",
  "templateId": "opening-card-resolution",
  "deterministic": {
    "guard": { "card": { "cardId": "1", "available": true } },
    "effects": [
      { "op": "flag.set", "path": "/public/flags/cards/1/resolved", "value": true },
      { "op": "metric.add", "path": "/public/metrics/trust", "value": 1 },
      { "op": "log.append", "kind": "card-resolution" }
    ]
  }
}
```

Это пример направления. По итоговому cleanup-срезу authoring/generated manifest использует единый `effects[]` путь.

## 5. Классы долга

### 5.1. Game-specific capability family

Старое `capabilityFamily: "antarctica.opening"` заменено на нейтральные семейства.

| Текущая группа | Целевое имя семейства | Почему общее |
| --- | --- | --- |
| `opening-card-resolution` | `game.card.resolve` | подходит карточным выборам, квестам и обучающим карточкам |
| `opening-card-advance` | `game.timeline.advance` | описывает переход по сценарию |
| `opening-info-advance` | `game.info.advance` или `game.timeline.advance` | описывает переход по информационному блоку |
| `opening-team-selection` | `game.team.select` | подходит выбору отряда, состава, роли или юнита |
| `opening.team.confirm` | `game.team.confirm` | подтверждает выбранный состав |
| `opening.board.25_30.advance` | `game.collection.threshold` + `game.timeline.advance` | переход после достижения порога по коллекции |

Смена family/capability не должна менять `actionId`.

### 5.2. Бывшие script actions

Пять actions были помечены как `script`, но фактически не являлись произвольным JavaScript. Cleanup перевел их в `manifest-data` и добавил общий `effects[]` каркас в JSON Schema, contracts и `runtime-api`.

Реализованная форма:

| Action ID | Целевая форма | Реализация |
| --- | --- | --- |
| `requestServer` | общая серверная команда | `runtime.server.request` + `log.append` |
| `showHint` | открыть UI-панель | `ui.panel.open` с `panelId: "hint"` + `log.append` |
| `showHistory` | открыть UI-панель | `ui.panel.open` с `panelId: "history"` + `log.append` |
| `showTopBar` | открыть UI-панель | `ui.panel.open` с `panelId: "top-bar"` + `log.append` |
| `showScreenWithLeftSideBar` | открыть экран/раскладку | `ui.screen.open` с `screenId` и `layoutId` + `log.append` |

Важно: это не runtime-плагин. `runtime-api` не исполняет код из манифеста, а применяет только заранее разрешенные операции из `effects[]`.

### 5.3. Deterministic effects

Deterministic-изменения сведены к проверяемым эффектам:

| Группа механики | Текущая общая операция | Статус |
| --- | --- | --- |
| Переходы timeline | `timeline.set` | выполнено |
| Точечные изменения состояния | `state.patch` | выполнено |
| Булевы признаки | `flag.set` | выполнено |
| Счетчики и коллекции | `counter.add`, `collection.append` | выполнено |
| Пороги коллекций | `when.collectionCount` + разрешенный effect | выполнено |
| Условные изменения по метрикам или состоянию | `when.metric`, `when.state` + разрешенный effect | выполнено |

Предыдущие совместимые поля удалены из schema/runtime после переноса `Antarctica` и `simple-choice` на `effects[]`.

### 5.4. Команды UI manifest

UI manifest сейчас использует команды вроде `requestServer`, `showHistory`, `showHint`. Это не обязательно ошибка, но эти команды должны быть частью общего player command contract, а не знанием об `Antarctica`.

Cleanup должен проверить:

- какие команды реально нужны `simple-choice`;
- какие команды нужны разным каналам интерфейса;
- какие команды можно выразить через общий `command: "dispatchAction"` и payload;
- где нужно сохранить старые имена как совместимые временные псевдонимы.

Совместимый временный псевдоним - старое имя команды, которое еще поддерживается, пока UI manifest не переведен на новое имя.

## 6. Порядок миграции

### Шаг 1. Инвентаризация и тестовый baseline

Статус: выполнено. До cleanup картина была зафиксирована скриптом, а не ручным чтением всего JSON:

- подсчет по `handlerType`;
- подсчет по `capabilityFamily`;
- action IDs по `templateId`;
- ключи внутри раннего deterministic-формата;
- список UI manifest commands.

Перед изменениями нужны parity tests. Parity test - проверка, что после изменения манифеста те же действия дают то же состояние, которое видит `player-web`, тот же журнал и ту же доступность следующих действий.

Минимальные сценарии:

- click card resolution;
- card advance;
- info advance;
- team member select;
- team confirm;
- board threshold advance;
- `showHint`;
- `showHistory`;
- `showScreenWithLeftSideBar`;
- `simple-choice` action без plugin.

### Шаг 2. Переименование capability family

Статус: выполнено для `games/antarctica/authoring/game.authoring.json` и сгенерированного `games/antarctica/game.manifest.json`.

Разрешено сделать как миграцию только данных, если runtime не зависит от старого `antarctica.opening`.

Требования:

- не менять `actionId`;
- не менять форму payload;
- не менять `displayName`/texts;
- обновить authoring source или compiler, если runtime manifest генерируется из authoring manifest;
- обновить тесты, которые проверяют старые family names;
- добавить scan, что `capabilityFamily: "antarctica.opening"` больше не осталось в authoring source и generated runtime manifest.

### Шаг 3. Легкие UI/runtime effects

Статус: выполнено для 5 бывших `script` actions. Старая JS-заглушка `games/antarctica/scripts/actions.js` удалена, а `content.scripts` больше не ссылается на runtime script.

Минимальная общая форма:

```json
{
  "handlerType": "manifest-data",
  "capabilityFamily": "ui.panel",
  "capability": "ui.panel.open",
  "deterministic": {
    "effects": [
      { "op": "ui.panel.open", "panelId": "hint" },
      { "op": "log.append", "kind": "ui-panel-open" }
    ]
  }
}
```

`effects[]` добавлен в JSON Schema и contracts, а `runtime-api` применяет только разрешенные операции. Ручные TypeScript-only проверки вместо схемы не добавлялись.

### Шаг 4. Сведение раннего deterministic-формата к `effects[]`

Статус: выполнено для `Antarctica`. Ранний deterministic-формат удален из authoring и generated manifest.

Этот шаг можно делать группами:

1. поля timeline - `timeline.set`;
2. флаги и выборы - `flag.set`, `counter.add`, `collection.append`;
3. пороги коллекций - `when.collectionCount`;
4. условные эффекты - `when.metric` и `when.state`;
5. общие патчи состояния - `state.patch`.

Каждая группа должна иметь нейтральные fixture tests, не только Antarctica tests. Это нужно, чтобы runtime-api capability была общей, а не скрытым обработчиком Antarctica.

Отдельная запись закрытия нормализации: `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/deterministic-effects-migration-closeout.md`.

### Шаг 5. Закрытие старого формата

Статус: выполнено. `Antarctica` и `simple-choice` используют `effects[]`, а schema/runtime принимают один текущий формат deterministic-изменений.

После миграции:

- ранние fields удалены из схемы;
- у совместимых псевдонимов есть условие удаления;
- debt register updated;
- `runtime-api` tests cover both rejection of invalid effects and successful application of allowed effects.

## 7. Runtime-api plugins как технический долг

Полноценный runtime-api plugin runner сейчас не реализуется и зафиксирован как технический долг `LEGACY-0014`.

Под **runtime-api plugin runner** здесь понимается исполнитель серверных плагинов: отдельный процесс или изолированная среда, которая получает JSON-вход от `runtime-api` и возвращает JSON-ответ с патчем, эффектами или событием. Исполнитель не должен менять состояние напрямую.

Текущий cleanup `Antarctica` не имеет права закрывать manifest debt через runtime plugin. Допустимый порядок остается таким:

1. Сначала манифест и существующие platform capabilities.
2. Потом новая общая platform capability, если она подходит классу игр.
3. Только после этого - отдельно согласованный доверенный проектный runtime-плагин, если без него нельзя.

Если доверенный проектный runtime-плагин все же понадобится, это отдельный review и отдельная запись долга. Для него обязательны:

- владелец;
- причина, почему манифест и общая capability не подходят;
- JSON Schema для входа и выхода;
- отдельный процесс и JSON-протокол;
- прямой запуск через `spawn`/`execFile` без shell-строк;
- таймаут и отмена через `AbortSignal`;
- запрет прямой мутации session state;
- тесты;
- диагностика;
- путь миграции обратно в манифест или в изолированный runner.

`node:vm` и `worker_threads` нельзя использовать как защиту для чужого кода. Для runtime-плагинов из будущего каталога целевой путь остается контейнерная песочница или WebAssembly/WASI для чистых вычислений, как зафиксировано в ADR-040.

## 8. Требования к проверкам

Минимальные проверки для cleanup-среза:

```bash
git diff --check
npm run verify:manifest-authoring
npm run verify:game-agnostic
npm run verify:runtime-api
npm run verify:player-web
npm run verify:editor-web
npm test --workspace @cubica/editor-web
npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts
rg -n "editor-engine" apps/player-web services/runtime-api
rg -n "_source_trace|editor\\.layout|editor-playthrough" games/*/game.manifest.json games/*/ui/*/ui.manifest.json
rg -ni "gameId ===|antarctica" apps/player-web services/runtime-api packages/contracts
```

Дополнительные проверки cleanup:

```bash
rg -n '"capabilityFamily": "antarctica\\.opening"' games/antarctica/authoring/game.authoring.json games/antarctica/game.manifest.json
rg -n '"handlerType": "script"' games/antarctica/authoring/game.authoring.json games/antarctica/game.manifest.json
rg -n 'runtime-script|scripts/actions\\.js|\"function\": \"' games/antarctica/authoring/game.authoring.json games/antarctica/game.manifest.json
```

Для реестра долга:

```bash
node scripts/ci/validate-legacy.js
```

Если создаются новые директории, дополнительно:

```bash
node scripts/dev/generate-structure.js
```

## 9. Условия остановки

Cleanup нужно остановить и вынести решение отдельно, если:

- новая логика требует `gameId === "antarctica"` или другого hardcoded game ID в `runtime-api`;
- действие невозможно выразить манифестом, шаблоном, guard, effect или общей capability;
- требуется полноценный runtime-api plugin runner;
- требуется marketplace sandbox;
- для `effects[]` нужен большой движок процессов вместо небольшого языка механик;
- приходится менять action IDs, на которые уже ссылается UI manifest, без compatibility plan;
- нужно вручную переписать большой manifest без миграции скриптом и отчета о различиях.

## 10. Связанные документы

- `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`
- `docs/architecture/adrs/025-json-schema-source-of-truth-for-manifests.md`
- `docs/architecture/adrs/029-three-tier-logic-model.md`
- `docs/architecture/adrs/037-project-local-plugins-and-marketplace-safe-evolution.md`
- `docs/architecture/adrs/040-runtime-api-plugin-architecture.md`
- `docs/architecture/runtime-mechanics-language.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`
- `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/plugin-gap-closure-plan.md`
- `docs/legacy/debt-log.csv` entry `LEGACY-0014`

Практические основания:

- JSON Schema должна описывать допустимую форму объектов, включая `additionalProperties` или `patternProperties`, когда это нужно.
- Документация Node.js рекомендует для известных команд прямой запуск файла через `execFile`/`spawn`; shell-строки нельзя строить из непроверенного ввода.
- ADR-040 фиксирует, что `node:vm` не является защитной границей для чужого кода, а runtime-плагины из будущего каталога требуют реальной изоляции.
