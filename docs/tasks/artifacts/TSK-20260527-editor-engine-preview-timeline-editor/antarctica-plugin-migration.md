# Antarctica Plugin Migration To Target Plugin Architecture

Этот документ описывает, как переносить `Antarctica` из бывшего платформенного каталога в целевую архитектуру project-local плагинов и как при этом развивать manifest/runtime механизм без кода, привязанного к конкретной игре, в `runtime-api`.

## Оглавление

- [Статус на 2026-05-31](#статус-на-2026-05-31)
- [1. Понимание миграции](#1-понимание-миграции)
- [2. Текущие факты](#2-текущие-факты)
- [3. Целевое состояние](#3-целевое-состояние)
- [4. Изменения манифеста](#4-изменения-манифеста)
- [5. Универсальный механизм расширения runtime-api](#5-универсальный-механизм-расширения-runtime-api)
- [6. Миграция player-web плагина](#6-миграция-player-web-плагина)
- [7. Этапы миграции](#7-этапы-миграции)
- [8. Проверки](#8-проверки)
- [9. Открытые вопросы](#9-открытые-вопросы)
- [10. Manifest cleanup follow-up](#10-manifest-cleanup-follow-up)

## Статус на 2026-05-31

Миграция `Antarctica` в целевую архитектуру локальных проектных `player-web` плагинов завершена для первого этапа ADR-037. Итоговое закрытие, проверенные факты, приемочные критерии и оставшийся долг собраны в `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`.

Этот документ сохраняется как проектное описание миграции: почему выбран такой путь, какие границы нельзя нарушать и какие темы остаются отдельными работами.

## 1. Понимание миграции

Миграция понята так: `Antarctica` должна сохранить свое поведение, но выйти из бывшего платформенного каталога. Целевой дом для кода плагина - `games/antarctica/plugins/antarctica-player`.

При этом нельзя переносить сложность в `runtime-api` через условия под `antarctica`. Все серверные правила должны идти через манифест, общие runtime-возможности или, если иначе нельзя, через отдельно согласованный доверенный проектный runtime-плагин. Такой плагин запускается отдельным процессом с JSON-протоколом. Для стороннего и marketplace-кода целевой путь - изолированный runner (исполнитель плагина в отдельном процессе или изолированной среде) по ADR-040.

## 2. Текущие факты

Миграционный источник player plugin до переноса:

- бывший платформенный register module;
- бывшие платформенные state resolvers;
- бывшие платформенные contracts;
- бывшая статическая регистрация через `apps/player-web/src/plugins/register-games.ts`;
- прямые импорты внутренних модулей `player-web`, например `@/presenter/game-config-registry`, `@/presenter/game-config`, `@/lib/game-content-resolvers`, `@/lib/manifest-action-adapter`.

Фактическое состояние после миграции:

- `games/antarctica/plugins/antarctica-player/plugin.json`;
- `games/antarctica/plugins/antarctica-player/src/index.ts`;
- `games/antarctica/plugins/antarctica-player/src/register.ts`;
- `games/antarctica/plugins/antarctica-player/src/state-resolvers.ts`;
- `games/antarctica/plugins/antarctica-player/src/contracts.ts`;
- `games/antarctica/plugins/antarctica-player/src/config-data.ts`;
- `apps/player-web/src/plugins/player-plugin-api.ts` публикует фасад для регистрации config data, резолверов и нейтральных helper-функций;
- local editor preview подключает plugin через session bundle из ADR-039; non-preview player mode подключает plugin через generated published bundle reference. Бывший `apps/player-web/src/plugins/register-games.ts` удален.

Текущий manifest summary для `games/antarctica/game.manifest.json`:

- 145 actions;
- 145 actions с `handlerType: "manifest-data"`;
- 0 actions с `handlerType: "script"`;
- 4 templates: `opening-card-resolution`, `opening-card-advance`, `opening-info-advance`, `opening-team-selection`;
- `capabilityFamily: "antarctica.opening"` больше не используется;
- `content.scripts` больше не ссылается на старую runtime-script заглушку;
- бывшие UI/runtime script actions выражены через `deterministic.effects`;
- основные guard groups: `card`, `opening`, `teamSelection`, `team`, `timeline`, `board`;
- основные изменения состояния выражены через `effects[]`: timeline, selected card, board thresholds, unlocks, active info, team flags and selection.

Вывод: `Antarctica` декларативна для player-web plugin migration и manifest cleanup. Старый `games/antarctica/scripts/actions.js` удален как неиспользуемая заглушка, а deterministic-изменения описаны через общий язык `effects[]`.

## 3. Целевое состояние

Целевая структура:

```text
games/antarctica/plugins/antarctica-player/
  plugin.json
  package.json
  src/
    index.ts
    contracts.ts
    state-resolvers.ts
    register.ts
  tests/
```

`plugin.json` должен описывать только project-local `player-web` target:

```json
{
  "$schema": "../../../../docs/architecture/schemas/plugin.schema.json",
  "id": "antarctica-player",
  "gameId": "antarctica",
  "apiVersion": "1.0",
  "targets": {
    "player-web": {
      "entry": "src/index.ts",
      "contributes": {
        "gameConfigFactory": true
      }
    }
  },
  "validation": {
    "typecheck": "typecheck",
    "test": "test"
  },
  "permissions": {
    "network": false,
    "filesystem": "plugin-root-only",
    "environment": []
  },
  "dependenciesPolicy": "platform-only"
}
```

`simple-choice` не получает плагин. Он остается проверкой default manifest-driven path.

## 4. Изменения манифеста

### 4.1. Что не менять в первом шаге

Первый шаг миграции плагина не должен переписывать всю игровую логику. Чтобы не сломать поведение:

- action IDs сохраняются;
- `content.data.infos`, `boards`, `teamSelections`, `cards` остаются в игровом манифесте;
- UI manifest продолжает ссылаться на те же команды и payload fields, то есть поля данных, передаваемых вместе с UI-действием;
- deterministic-изменения должны оставаться в schema/runtime каркасе `effects[]`.

### 4.2. Что нужно нормализовать

`capabilityFamily: "antarctica.opening"` было миграционным долгом. Оно не нарушало runtime напрямую, если runtime не ветвился по нему, но закрепляло семантику конкретной игры в поле, которое должно помогать платформенной классификации.

Нейтральные families после cleanup:

| Текущий смысл | Целевое family name |
| --- | --- |
| выбор карточки | `game.card.resolve` |
| переход после карточки | `game.timeline.advance` |
| переход info screen | `game.info.advance` |
| выбор участника команды | `game.team.select` |
| подтверждение команды | `game.team.confirm` |
| threshold по коллекции карточек | `game.collection.threshold` |
| UI/panel commands | `ui.panel` |
| screen routing commands | `ui.screen` |

Эти имена не завязаны на `Antarctica` и подходят для квестов, стратегий и обучающих симуляций.

### 4.3. Как текущие поля ложатся на псевдоязык механик

| Текущее поле | Универсальный смысл |
| --- | --- |
| `templateId` | переиспользуемый шаблон действия |
| `guard.card` | проверка флага сущности типа card |
| `guard.team` | проверка флага сущности типа participant/team member |
| `guard.teamSelection` | проверка счетчика выбора |
| `guard.timeline` | проверка текущей позиции сценария |
| `guard.jsonLogic` | универсальное условие |
| числовые метрики | `metric.add` |
| timeline-переходы | `timeline.set` |
| флаги карточек | `flag.set` для entity `card` |
| флаги команды | `flag.set` для entity `teamMember` |
| выбор команды | `counter.add` и `collection.append` |
| порог коллекции | `when.collectionCount` плюс `timeline.set` |
| открытие карточки | `when.collectionCount` плюс `flag.set` |
| условные метрики | `metric.add` с `when` |
| условный переход | `timeline.set` с `when` |
| условный active info | `timeline.set` с `when` для active info |
| запись журнала | `log.append` |

Этот mapping показывает, что runtime extension должен развивать общие операции, а не добавлять обработчик "Antarctica opening".

### 4.4. Бывшие script actions

Пять бывших `handlerType: "script"` actions переведены в `manifest-data` и используют `deterministic.effects`:

| Action ID | Реализация |
| --- | --- |
| `requestServer` | `runtime.server.request` + `log.append` |
| `showHint` | `ui.panel.open` с `panelId: "hint"` + `log.append` |
| `showHistory` | `ui.panel.open` с `panelId: "history"` + `log.append` |
| `showTopBar` | `ui.panel.open` с `panelId: "top-bar"` + `log.append` |
| `showScreenWithLeftSideBar` | `ui.screen.open` с `screenId`/`layoutId: "left-sidebar"` + `log.append` |

До отдельного согласования нельзя превращать такие actions в first-class runtime plugin target. Если в будущем останется server-side code, он должен попасть в реестр долга как trusted project runtime plugin-like exception с отдельным процессом, JSON-протоколом, владельцем, причиной, тестами и migration path.

## 5. Универсальный механизм расширения runtime-api

Новые возможности `runtime-api` добавляются не под игру, а под общий primitive.

Правильная форма:

```text
manifest action
  -> schema-validated deterministic metadata
  -> generic capability handler
  -> schema-validated effects
  -> atomic state application
  -> audit log
```

Неправильная форма:

```text
if gameId === "antarctica" then run Antarctica opening transition
```

Требования к каждому primitive:

- JSON Schema обновлена до кода;
- primitive named by general behavior, for example `flag.set`, `metric.add`, `timeline.set`;
- нет чтения `gameId` для выбора поведения;
- нет импорта из `games/antarctica`;
- есть focused tests на нейтральных fixture-данных;
- есть diagnostics для guard failure и effect rejection;
- write paths ограничены и проверяются.

Если primitive нужен только `Antarctica`, он не попадает в `runtime-api`.

Если после этого все равно нужен runtime-плагин, его протокол остается таким же: плагин получает JSON-вход, возвращает патч, эффекты или событие, а `runtime-api` проверяет и применяет результат. Плагин не получает прямую ссылку на session store и не меняет состояние напрямую.

## 6. Миграция player-web плагина

ADR-039 задает модель browser bundle handoff. Local editor preview уже подключает `Antarctica` через session bundle, поэтому plugin changes in session worktree can be previewed without restarting `player-web`.

Текущая миграция уже убирает код игры из бывшего платформенного каталога и переводит его на `activate(api)`. Non-preview mode теперь использует опубликованный bundle из `games/antarctica/published/`, а не статический импорт в `apps/player-web`.

Целевой entrypoint:

```ts
export function activate(api: PlayerPluginApi) {
  api.registerGameConfigFactory("antarctica", createAntarcticaConfig);
}
```

Плагин может сохранить state resolvers, привязанные к `Antarctica`, внутри `games/antarctica/plugins/antarctica-player/src/`, потому что это presentation logic конкретной игры. Но он не должен импортировать private modules `apps/player-web`.

То, что сейчас импортируется из `player-web`, должно быть разделено:

| Сейчас | Целевой вариант |
| --- | --- |
| `registerGameResolvers` | метод `api.registerGameConfigFactory` |
| `GameConfig`, `ResolverFactory` | публичные типы player plugin API |
| `createManifestActionAdapter` | публичный helper через facade или plugin-local adapter |
| `game-content-resolvers` | публичные generic helpers через facade или копия маленьких neutral helpers в plugin API |
| `@/presenter/*` private imports | запрещены |

## 7. Этапы миграции

### Этап A. Документированная подготовка

- ADR-040 принят.
- `docs/architecture/runtime-mechanics-language.md` описывает общий псевдоязык.
- Этот документ фиксирует migration target и runtime boundary.

### Этап B. Project-local player plugin

- создать `games/antarctica/plugins/antarctica-player` - done;
- добавить `.desc.json` для новых значимых директорий и обновить `PROJECT_STRUCTURE.yaml` - done;
- перенести `contracts.ts`, `state-resolvers.ts`, регистрацию и тесты - done;
- заменить private imports на публичный plugin API facade - done;
- удалить бывший платформенный каталог плагина после переключения - done.

### Этап C. Plugin validation and preview

- добавить `plugin.schema.json`;
- проверять `plugin.json` через JSON Schema;
- запрещать npm dependencies;
- запускать validation commands только через allowlist и direct process API без shell strings;
- сохранять diagnostics в результат validation/journal;
- обеспечить hot preview reload через session bundle из ADR-039.

### Этап D. Manifest cleanup

- переименовать `capabilityFamily` в общие names, не меняя action IDs без необходимости - done;
- заменить остаточные script actions декларативными effects - done;
- сохранять deterministic-изменения в общем `effects[]`;
- сохранить parity tests для `Antarctica`.

Подробный исполнительный план cleanup: `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-manifest-cleanup.md`.

## 8. Проверки

Минимальные проверки для реализации:

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
rg -ni "gameId ===|antarctica" apps/player-web services/runtime-api packages/contracts
```

Если создаются новые директории, дополнительно:

```bash
node scripts/dev/generate-structure.js
```

## 9. Открытые вопросы

- Какие проверки добавить, чтобы новые манифесты оставались на едином `effects[]` пути.
- CDN/object storage for published bundles remains a future deployment choice; the current URL contract is compatible with moving storage behind a CDN later.

## 10. Manifest cleanup follow-up

Cleanup манифеста `Antarctica` выделен в отдельный документ, потому что он меняет runtime semantics, а не только место хранения player-web плагина.

Зафиксированные границы follow-up:

- player-web plugin migration не переписывал `game.manifest.json`; manifest cleanup выполнен отдельным срезом;
- `simple-choice` остается plugin-free контрольным сценарием;
- `capabilityFamily: "antarctica.opening"` и 5 `handlerType: "script"` actions закрыты cleanup 2026-05-31;
- старая runtime-script заглушка `games/antarctica/scripts/actions.js` удалена из manifest source и repository tree;
- cleanup раннего deterministic-формата закрыт: новые изменения должны идти через `effects[]`;
- полноценные runtime-api plugins не реализуются в этом cleanup и зафиксированы как legacy/debt entry `LEGACY-0014`;
- если cleanup требует server-side code outside manifest/platform capabilities, work stops and ADR-040 review is required.
