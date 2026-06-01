# Завершение миграции Antarctica в архитектуру плагинов

Документ фиксирует завершение миграции `Antarctica` в целевую архитектуру локальных проектных плагинов. Локальный проектный плагин - это плагин, который лежит внутри каталога конкретной игры, версионируется вместе с ней и не хранится в коде платформенного приложения.

Этот документ не вводит новых архитектурных решений. Решения уже зафиксированы в ADR-037, ADR-039 и ADR-040. Здесь собраны итоговое состояние, доказательства и оставшиеся задачи, которые не блокируют завершение миграции `Antarctica`.

## Оглавление

- [1. Что считается завершенным](#1-что-считается-завершенным)
- [2. Итоговое проектное состояние](#2-итоговое-проектное-состояние)
- [3. Итоговое исполнительное состояние](#3-итоговое-исполнительное-состояние)
- [4. Проверенные факты в репозитории](#4-проверенные-факты-в-репозитории)
- [5. Граница runtime-api](#5-граница-runtime-api)
- [6. Что не входит в закрытую миграцию](#6-что-не-входит-в-закрытую-миграцию)
- [7. Приемочные критерии](#7-приемочные-критерии)
- [8. Проверки](#8-проверки)
- [9. Оставшийся долг](#9-оставшийся-долг)
- [10. Следующие работы](#10-следующие-работы)

## 1. Что считается завершенным

Миграция `Antarctica` считается завершенной для первого целевого этапа ADR-037:

- плагин игрока живет в `games/antarctica/plugins/antarctica-player`;
- бывший платформенный каталог плагина больше не является источником кода;
- `simple-choice` остается без плагина и продолжает проверять путь "игра только на манифестах";
- локальный предпросмотр редактора подхватывает изменения кода плагина через браузерный файл плагина, не требуя перезапуска `player-web`;
- опубликованный плеер не должен загружать код из рабочей копии редактора;
- `runtime-api` не исполняет код `player-web` плагина и не получил ветки под `Antarctica`;
- старые runtime-script маркеры в манифесте `Antarctica` закрыты через общие эффекты манифеста.

## 2. Итоговое проектное состояние

Целевой дом плагина:

```text
games/antarctica/plugins/antarctica-player/
  plugin.json
  package.json
  src/
    index.ts
    register.ts
    config-data.ts
    contracts.ts
    state-resolvers.ts
  tsconfig.json
```

`plugin.json` валидируется через JSON Schema. JSON Schema - это единый источник истины для формы файла, поэтому форма плагина не дублируется ручными проверками TypeScript.

`player-web` получает от плагина только разрешенные точки расширения через публичный API фасад. Фасад - это небольшой стабильный объект с разрешенными методами, который скрывает внутренние модули приложения от кода плагина.

Локальный предпросмотр использует такую цепочку:

```text
рабочая копия сессии редактора
  -> проверка plugin.json и кода плагина
  -> сборка браузерного файла плагина
  -> ссылка на файл сохраняется внутри contentSourceId
  -> runtime-api только передает ссылку
  -> player-web загружает файл только в режиме предпросмотра
```

`contentSourceId` - это идентификатор источника контента предпросмотра. Он остается границей между рабочей копией редактора, `runtime-api` и `player-web`.

## 3. Итоговое исполнительное состояние

Закрытые срезы:

| Срез | Итог |
| --- | --- |
| Перенос кода плагина | Выполнено: код `Antarctica` перенесен в `games/antarctica/plugins/antarctica-player`. |
| Старый платформенный плагин | Выполнено: бывший платформенный каталог плагина больше не нужен как целевой путь. |
| Публичный API плагина | Выполнено: плагин активируется через `activate(api)` и не должен импортировать приватные модули `player-web`. |
| Проверка плагина | Выполнено для первого этапа: JSON Schema, путь, политика зависимостей, разрешенные команды и `typecheck`. |
| Локальный предпросмотр | Выполнено: браузерный файл плагина для сессии загружается в `player-web` только в режиме предпросмотра. |
| Манифест `Antarctica` | Выполнено для главного долга: нет `handlerType: "script"`, нет `capabilityFamily: "antarctica.opening"`, нет runtime-script заглушки. |
| Runtime-плагины | Не реализованы намеренно: оформлены как долг `LEGACY-0014` по ADR-040. |

## 4. Проверенные факты в репозитории

Факты на 2026-05-31:

| Проверка | Результат |
| --- | --- |
| `games/antarctica/plugins/antarctica-player` | существует |
| Бывший платформенный каталог плагина | отсутствует как целевой каталог |
| `games/antarctica/scripts/actions.js` | отсутствует |
| `games/antarctica/scripts/` | отсутствует |
| `simple-choice` plugin root | отсутствует |

Сводка по `games/antarctica/game.manifest.json`:

| Показатель | Значение |
| --- | ---: |
| Actions всего | 145 |
| `handlerType: "manifest-data"` | 145 |
| `handlerType: "script"` | 0 |
| `content.scripts` | 0 |
| `capabilityFamily: "antarctica.opening"` | 0 |

Текущие семейства возможностей:

| Семейство | Количество |
| --- | ---: |
| `game.card.resolve` | 71 |
| `game.timeline.advance` | 30 |
| `game.info.advance` | 27 |
| `game.team.select` | 10 |
| `game.team.confirm` | 1 |
| `game.collection.threshold` | 1 |
| `runtime.server` | 1 |
| `ui.panel` | 3 |
| `ui.screen` | 1 |

Пять бывших script actions теперь выражены через `deterministic.effects`:

| Action | Эффекты |
| --- | --- |
| `requestServer` | `runtime.server.request`, `log.append` |
| `showHint` | `ui.panel.open`, `log.append` |
| `showHistory` | `ui.panel.open`, `log.append` |
| `showTopBar` | `ui.panel.open`, `log.append` |
| `showScreenWithLeftSideBar` | `ui.screen.open`, `log.append` |

## 5. Граница runtime-api

`runtime-api` остается владельцем серверного состояния игры, но не становится исполнителем клиентского плагина.

Разрешено:

- принимать ссылку на браузерный файл плагина внутри зарегистрированного `contentSourceId`;
- отдавать эту ссылку в данные для плеера в режиме предпросмотра;
- применять общие эффекты манифеста, например `ui.panel.open`, `ui.screen.open`, `runtime.server.request`, `log.append`;
- проверять и применять изменения состояния только через общие правила манифеста.

Запрещено:

- импортировать код из `games/antarctica/plugins/**`;
- добавлять `gameId === "antarctica"` в общий runtime code;
- исполнять код `player-web` плагина на сервере;
- закрывать недостающие механики через произвольный JavaScript в манифесте;
- считать `node:vm` или `worker_threads` защитой для стороннего runtime-кода.

Если серверная механика не выражается манифестом, сначала проектируется общая возможность платформы. Только если это не подходит, открывается отдельный срез по ADR-040.

## 6. Что не входит в закрытую миграцию

Эти темы не блокируют закрытие миграции `Antarctica`, но остаются отдельными работами:

- передача опубликованного браузерного файла плагина вне локального предпросмотра;
- явная политика совместимых версий `apiVersion`;
- отдельная строка журнала в интерфейсе редактора для результатов проверки плагина;
- production-safe handoff for published browser plugin bundles;
- полноценный runtime-api plugin runner;
- marketplace-песочница и проверка сторонних зависимостей.

## 7. Приемочные критерии

| Критерий | Статус |
| --- | --- |
| Плагин `Antarctica` находится в `games/antarctica/plugins/antarctica-player` | Выполнено |
| Бывший платформенный каталог плагина не используется как целевой путь | Выполнено |
| `simple-choice` остается без плагина | Выполнено |
| `plugin.json` проверяется по JSON Schema | Выполнено |
| npm-зависимости плагина запрещены при `dependenciesPolicy: "platform-only"` | Выполнено |
| Проверочные команды идут через разрешенный список и прямой запуск процесса | Выполнено |
| Локальный предпросмотр видит изменения кода плагина без перезапуска `player-web` | Выполнено |
| Опубликованный плеер не читает код рабочей копии редактора | Выполнено для границы локального предпросмотра; передача опубликованного файла остается отдельной работой |
| Манифест не содержит старых `script` actions и семейства `antarctica.opening` | Выполнено |
| `runtime-api` не содержит ветку под конкретную игру `Antarctica` | Выполнено по целевым изменениям и статическим проверкам |

## 8. Проверки

Полный набор проверок, который подтверждал завершение реализации:

```bash
git diff --check
node scripts/dev/generate-structure.js
node scripts/manifest-tools/compile-authoring-manifests.cjs --check --quiet --game antarctica
npm run verify:editor-engine
npm test --workspace @cubica/editor-web
npm run verify:editor-web
npm run verify:player-web
npm run verify:runtime-api
npm run verify:manifest-authoring
npm run verify:game-agnostic
npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts
node scripts/ci/validate-legacy.js
```

Статические проверки закрытия:

```bash
rg -n "editor-engine" apps/player-web services/runtime-api
rg -n "_source_trace|editor\\.layout|editor-playthrough" games/*/game.manifest.json games/*/ui/*/ui.manifest.json
rg -n 'runtime-script|scripts/actions\\.js|"function": "|"handlerType": "script"|"capabilityFamily": "antarctica\\.opening"' games/antarctica/authoring/game.authoring.json games/antarctica/game.manifest.json
rg -n "gameId\\s*={2,3}\\s*['\\\"]antarctica['\\\"]" apps/player-web services/runtime-api packages/contracts
```

## 9. Оставшийся долг

| Долг | Где зафиксирован | Почему не блокирует закрытие |
| --- | --- | --- |
| Передача опубликованного браузерного файла плагина | ADR-039, `plugin-gap-closure-plan.md` | Локальный предпросмотр уже работает; публикация требует отдельной политики доставки артефактов. |
| `apiVersion` supported range | ADR-037, `plugin-gap-closure-plan.md` | Текущая реализация работает на `1.0`; политика диапазонов нужна перед расширением API. |
| UI journal row for plugin validation | `plugin-gap-closure-plan.md` | Диагностика уже возвращается и блокирует Save; отдельная визуальная строка - улучшение интерфейса. |
| Deterministic effects | `antarctica-manifest-cleanup.md`, `deterministic-effects-migration-closeout.md` | Закрыто: `Antarctica` и `simple-choice` используют `effects[]`; platform schema/runtime принимают один текущий формат deterministic-изменений. |
| Runtime-api plugin runner | `LEGACY-0014`, ADR-040 | Не нужен для текущей миграции; добавляется только отдельным срезом после доказанной необходимости. |
| Marketplace sandbox | ADR-037, ADR-040 | Это будущий путь для сторонних плагинов, не часть доверенного локального этапа. |

## 10. Следующие работы

Рекомендуемый порядок:

1. Спроектировать production/published handoff для браузерных файлов плагинов.
2. Зафиксировать политику `apiVersion` для `PlayerPluginApi`.
3. Добавить отдельную строку журнала редактора для проверки плагина, если это важно для пользовательского опыта.
4. Не начинать runtime-api plugin runner без отдельного среза по ADR-040 и обновления `LEGACY-0014`.
