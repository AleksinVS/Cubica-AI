# Deterministic Effects Migration Closeout

Документ фиксирует закрытие перехода `Antarctica` и `simple-choice` на общий `effects[]`.

`effects[]` здесь означает список проверяемых JSON-операций: манифест не запускает код, а просит `runtime-api` выполнить заранее разрешенное действие, например поменять текущий шаг timeline или добавить запись в журнал.

## Оглавление

- [1. Понимание задачи](#1-понимание-задачи)
- [2. Правила закрытия](#2-правила-закрытия)
- [3. Итоговое состояние](#3-итоговое-состояние)
- [4. Реализованные эффекты](#4-реализованные-эффекты)
- [5. Что больше не поддерживается](#5-что-больше-не-поддерживается)
- [6. Проверки](#6-проверки)
- [7. Условия остановки](#7-условия-остановки)

## 1. Понимание задачи

Задача понята так: после переноса `Antarctica` в целевую plugin-архитектуру нужно убрать из manifest/schema/runtime все промежуточные способы описания детерминированных изменений и оставить один общий путь - `effects[]`.

Целевое направление:

- если механику можно описать манифестом и общей platform capability, делаем это;
- `runtime-api` не получает ветки вида `gameId === "antarctica"`;
- JSON Schema остается единственным источником истины для формы эффекта;
- каждый перенос проверяется нейтральными runtime-тестами;
- совместимость с промежуточными deterministic-полями не остается в текущей схеме и рантайме.

## 2. Правила закрытия

Каждый effect отвечает пяти требованиям:

1. Описан в `docs/architecture/schemas/game-manifest.schema.json`.
2. Отражен в типах `@cubica/contracts-manifest`.
3. Применяется в `runtime-api` без знания конкретной игры.
4. Покрыт тестами на принятие валидного эффекта и отклонение ошибочного эффекта.
5. Проверен на `Antarctica` через authoring manifest, generated manifest и focused runtime tests.

Если новая механика не укладывается в понятный effect, ее нельзя протаскивать через частный обработчик в `runtime-api`. Нужно отдельное архитектурное решение: новая общая capability, доверенный серверный плагин по ADR-040 или отказ от изменения.

## 3. Итоговое состояние

После полного среза нормализации в `games/antarctica/authoring/game.authoring.json`, `games/antarctica/game.manifest.json`, `games/simple-choice/authoring/game.authoring.json` и `games/simple-choice/game.manifest.json` deterministic-изменения выражены через `effects[]`.

В `effects[]` сейчас есть:

| Effect | Количество |
| --- | ---: |
| `timeline.set` | 60 |
| `state.patch` | 31 |
| `flag.set` | 20 |
| `counter.add` | 10 |
| `collection.append` | 10 |
| `log.append` | 5 |
| `ui.panel.open` | 3 |
| `runtime.server.request` | 1 |
| `ui.screen.open` | 1 |

## 4. Реализованные эффекты

Переход по timeline:

```json
{
  "effects": [
    {
      "op": "timeline.set",
      "canAdvance": false,
      "stepIndex": "{{nextStepIndex}}",
      "stageId": "stage_intro",
      "screenId": "S1",
      "activeInfoId": "i4"
    }
  ]
}
```

Состояние, метрики, флаги, счетчики, коллекции и журнал теперь описываются такими же элементами списка:

```json
{
  "effects": [
    { "op": "state.patch", "path": "/public/selectedCardId", "value": "card-1" },
    { "op": "metric.add", "path": "/public/metrics/trust", "value": 1 },
    { "op": "flag.set", "path": "/public/flags/cards/1/resolved", "value": true },
    { "op": "counter.add", "path": "/public/teamSelection/pickCount", "value": 1 },
    { "op": "collection.append", "path": "/public/teamSelection/members", "value": "fedya" },
    { "op": "log.append", "kind": "card-resolution", "auditMetrics": true }
  ]
}
```

Почему это безопасный срез:

- переход по timeline нужен многим играм: квестам, обучающим сценариям, карточным и стратегическим интерфейсам;
- effect не знает ни имени игры, ни структуры сюжета `Antarctica`;
- `runtime-api` применяет только поля, разрешенные схемой;
- action-level effects добавляются к template effects, а не заменяют их;
- условные эффекты используют общий `when`, поэтому порядок и ветвление остаются данными манифеста.

## 5. Что больше не поддерживается

Совместимые поля до `effects[]` удалены из JSON Schema, TypeScript contracts и runtime handlers. Выполненный порядок закрытия:

| Очередь | Срез | Почему так |
| ---: | --- | --- |
| 1 | `timeline.set` | прямые переходы по timeline |
| 2 | `state.patch` | точечные изменения состояния без частной операции под игру |
| 3 | `flag.set` | булевы признаки |
| 4 | `counter.add` + `collection.append` | выбор команды |
| 5 | `when.collectionCount` | пороги коллекций без обработчика под конкретный board |
| 6 | `when.metric` с `readFrom: "preAction"` | сохранение прежнего порядка условных расчетов |
| 7 | `metric.add` | единый ordered pipeline для метрик |
| 8 | `log.append` с `auditMetrics` | журнал без отдельного metadata-формата |

## 6. Проверки

Минимум для закрывающего среза:

```bash
git diff --check
node scripts/manifest-tools/compile-authoring-manifests.cjs --check --quiet --game antarctica
node scripts/manifest-tools/compile-authoring-manifests.cjs --check --quiet --game simple-choice
npm run verify:manifest-authoring
npm run verify:runtime-api
npm run verify:game-agnostic
rg -ni "gameId ===|antarctica" apps/player-web services/runtime-api packages/contracts
```

Для `Antarctica` дополнительно нужны focused checks на:

- переход карточки;
- переход info;
- выбор участника команды;
- подтверждение команды;
- переход по порогу board;
- отсутствие plugin-пути у `simple-choice`.

## 7. Условия остановки

Останавливаем миграцию и выносим решение отдельно, если:

- нужна ветка в platform core под конкретную игру;
- эффект требует произвольного JavaScript в `runtime-api`;
- нужен полноценный runtime-api plugin runner;
- новая форма требует marketplace sandbox;
- изменение action IDs ломает UI manifest;
- перенос ухудшает читаемость manifest сильнее, чем уменьшает долг.
