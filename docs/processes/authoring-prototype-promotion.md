# Повышение authoring-прототипов

Документ описывает ручной процесс повышения локального authoring-прототипа (редактируемого шаблона в `_definitions` конкретной игры) до платформенного прототипа Cubica. Он исполняет ADR-050 и не заменяет архитектурное решение: если повышение меняет контракт схемы, каталог или компилятор, нужно отдельное ADR или изменение существующего ADR.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Термины](#2-термины)
- [3. Что нельзя делать автоматически](#3-что-нельзя-делать-автоматически)
- [4. Входные данные заявки](#4-входные-данные-заявки)
- [5. Проверка универсальности](#5-проверка-универсальности)
- [6. Обязательные gates](#6-обязательные-gates)
- [7. Решение о повышении](#7-решение-о-повышении)
- [8. Следующие действия после принятия](#8-следующие-действия-после-принятия)
- [9. Связь с регулярным аудитом](#9-связь-с-регулярным-аудитом)

## 1. Назначение

Процесс нужен, чтобы удачные локальные прототипы могли стать переиспользуемыми платформенными элементами без переноса game-specific деталей в общий слой.

Повышение допускается только вручную. Инструменты редактора и ИИ-помощник могут подготовить proposal, diff summary, source pointers и validation results, но не могут сами записать прототип в platform-level catalog.

## 2. Термины

- **Game-level prototype** - прототип внутри authoring-файлов конкретной игры, например в `games/<gameId>/authoring/**/_definitions`.
- **Platform-level prototype** - общий прототип платформы Cubica, предназначенный для класса игр, экранов, действий или UI-компонентов.
- **Promotion request** - заявка на повышение локального прототипа в платформенный прототип.
- **Gate** - обязательная проверка, без которой решение нельзя считать принятым.
- **Game-specific detail** - идентификатор, текст, asset path, метрика, правило или предметное название, которое имеет смысл только в одной игре.

## 3. Что нельзя делать автоматически

Запрещено:

- повышать prototype только потому, что extractor нашел повторяющуюся структуру;
- создавать или изменять platform-level catalog из assistant tool;
- добавлять `_prototypeImports` без отдельного изменения JSON Schema и compiler stripping rules;
- считать один локальный use case достаточным доказательством универсальности;
- переносить в платформенный прототип concrete game id, screen id, local metric id, локальные тексты, asset paths или локальные правила.

## 4. Входные данные заявки

Promotion request должен содержать:

1. Имя локального прототипа и JSON Pointer на `_definitions`.
2. Ссылку на исходный game-level proposal или commit.
3. Минимум два независимых use case либо письменное доказательство класса игр/каналов.
4. Список параметров, которые отделяют общий prototype body от локальных значений.
5. `_semantics`, описывающий общий смысл без привязки к одной игре.
6. `_promptTemplate`, если прототип будет использоваться редактором или агентом для создания элементов.
7. Примеры authoring JSON для game или UI manifest.
8. Migration guidance для локальных пользователей прототипа.
9. Предложенную versioning policy для breaking changes.

## 5. Проверка универсальности

Перед повышением reviewer должен явно классифицировать прототип:

- **general** - прототип подходит классу игр, каналов или UI-паттернов;
- **game-specific** - прототип должен остаться в конкретной игре;
- **not-ready** - идея может быть общей, но не хватает примеров, тестов или параметризации.

Критерии `general`:

- общий смысл прототипа понятен без знания исходной игры;
- все game-specific details удалены или стали параметрами;
- параметры не превращают прототип в тонкую обертку над почти полностью локальным объектом;
- runtime output после использования прототипа остается валидным и не требует runtime branches;
- source maps после extraction указывают на существующие authoring pointers.

## 6. Обязательные gates

Перед решением должны пройти:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
npm run verify:editor-engine
npm run verify:editor-web
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json
git diff --check
```

Ожидаемый результат leakage scan: `rg` не находит совпадений в generated runtime manifests.

Дополнительно для конкретного proposal нужно сохранить:

- canonical runtime diff до/после;
- source-map pointer existence result;
- editor dry-run result with inverse `EditorChangeSet`;
- список warnings по readability и over-extraction risk.

## 7. Решение о повышении

Решение фиксируется в task artifact или ADR update.

Минимальная запись:

- итоговая classification: `general`, `game-specific` или `not-ready`;
- причины решения;
- список use cases;
- имя будущего platform-level prototype;
- версия;
- breaking-change policy;
- список проверок и результаты;
- ссылка на migration guidance.

Если classification равна `game-specific` или `not-ready`, локальный прототип остается в игре. Его нельзя копировать в platform-level catalog как временный shortcut.

## 8. Следующие действия после принятия

После решения `general` можно создать отдельную implementation task для platform-level catalog.

Эта task должна отдельно описать:

- физический home каталога, например будущий `packages/authoring-prototypes/`;
- JSON Schema changes для import metadata;
- compiler stripping rules для `_prototypeImports`;
- examples and tests;
- migration path для локальных прототипов;
- deprecation policy для старых версий платформенных прототипов.

До выполнения этой отдельной task platform-level prototype остается решением и кандидатом, но не новым runtime или compiler contract.

## 9. Связь с регулярным аудитом

Регулярный аудит кандидатов описан в `docs/processes/authoring-prototype-audit.md`. Он может создать promotion candidate record, но не заменяет этот процесс.

Перед повышением reviewer должен проверить, откуда пришел кандидат:

- deterministic weekly audit;
- LLM-семантический weekly audit;
- ручной proposal из редактора;
- реальный локальный прототип, уже примененный в игре.

Если кандидат пришел только из LLM-семантического аудита, его сначала нужно подтвердить deterministic gates: построить proposal, проверить runtime diff, source maps и leakage scan. Только после этого можно открывать promotion request.
