---
id: F_00021
title: JSON-манифест сценария «Antarctica» для Next.js-плеера
status: in_progress
owner: @todo
epic: E_0020
area: game-player
tags: [priority:P1, type:feature]
links:
  - docs/tasks/brief.md
  - draft/Antarctica/README.md
  - games/antarctica-nextjs-player/README.md
---

# FEATURE: JSON-манифест сценария «Antarctica» для Next.js-плеера

## Оглавление
- [Цели](#цели)
- [Термины](#термины)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты](#артефакты)

## Цели
- [x] Перенести сценарий «Antarctica» в формат JSON‑манифеста (meta/config/assets/engine/state/ui/actions) по `docs/architecture/schemas/game-manifest.schema.json`, с обязательными полями `schema_version` и `min_engine_version`.
- [x] Сформировать UI-раздел манифеста под MVP (Model–View–Presenter) так, чтобы его можно было отрисовать через `GameScreenRenderer` без привязки к старому `Game.html`.
- [x] Подготовить загрузку сценария через локальные данные (fixtures) и переключатель сценариев, чтобы плеер показывал первый экран «Antarctica» в соответствии с целевой архитектурой.

## Термины
- **LLM-first** — подход, в котором LLM (Large Language Model, большая языковая модель) выступает игровым движком и принимает решения на основе манифеста и состояния.
- **JSON‑манифест** — структурированный JSON с разделами `meta`, `config`, `assets`, `engine`, `state`, `ui`, `actions`; валидируется схемой `docs/architecture/schemas/game-manifest.schema.json`.
- **Abstract View** — описание интерфейса в данных (экраны, области, карточки, переменные) для рендера через протокол MVP и утилиты `renderer.js`/`GameScreenRenderer` в Next.js-плеере.
- **MVP (Model–View–Presenter)** — паттерн, разделяющий данные (Model), отображение (View) и презентер (Presenter), чтобы UI не содержал бизнес-логики.
- **Router / Game Engine** — Router — API-шлюз и менеджер сессий; Game Engine — сервис, который превращает манифест и состояние в решения, опираясь на LLM и (при необходимости) скрипты.

## Scope
- In scope:
  - Разбор `cardsObj`, `game.timeline` и метрик в `draft/Antarctica/Game.html` и перенос этих данных в разделы `state.public` и `ui` манифеста.
  - Проектирование полного манифеста «Antarctica» с заполнением `meta` (включая `schema_version`, `min_engine_version`), `config` (кол-во игроков), `assets` (правила/сценарий/скрипты) и `actions` (LLM- или script-обработчики).
  - Подготовка JSON‑фикстур UI и подключение их в `games/antarctica-nextjs-player/src/app/utils/localDataLoader.js` с возможностью выбирать сценарий (query‑параметр или флаг).
  - Определение действий карточек так, чтобы их можно было отправлять в Router/Game Engine (через `actionTypes.requestServer`) или обрабатывать локально, сохраняя совместимость с протоколом MVP.
- Out of scope:
  - Изменение базовой схемы манифеста и протокола MVP (уже закреплены в эпике E_0010 и ADR-002/ADR-008).
  - Реализация полноценного backend Game Engine и Router — допускаются только заглушки и фикстуры.
  - Архитектурный рефакторинг плеера (перенос в `games/antarctica-nextjs-player`, вынос компонентов в SDK) — это часть фичи F_00024 и является базой для данной работы.

## User-Stories--Задачи
- [x] Как разработчик, я открываю манифест «Antarctica» и вижу полный набор разделов (`meta`, `config`, `assets`, `engine`, `state`, `ui`, `actions`) с ссылкой на актуальную схему и понятными идентификаторами элементов из `Game.html`.
- [x] Как разработчик, я включаю сценарий «Antarctica» в `localDataLoader` и вижу первый экран с панелью метрик и карточками, соответствующими первому блоку `game.timeline`.
- [ ] (Опционально) Как разработчик, я могу кликнуть по карточке и получить локальный эффект или заготовленный патч обновлений (`updates`), совместимый с будущим Game Engine.

## Acceptance-Criteria
- [ ] Манифест(ы) валидны относительно `docs/architecture/schemas/game-manifest.schema.json`, содержат `schema_version` и `min_engine_version`, и могут быть использованы Router/Game Engine.
- [ ] UI-раздел манифеста описывает первый шаг `game.timeline`, рендерится через `GameScreenRenderer` без ошибок и использует компоненты Abstract View (`screenComponent`, `areaComponent`, `gameVariableComponent`, `cardComponent`).
- [ ] Действия карточек описаны в `actions` (handler_type `llm` или `script`) и связаны с UI-узлами; при клике данные могут уйти через `actionTypes.requestServer` или отработать локально без нарушения MVP.
- [ ] Идентификаторы карточек, метрик и экранов имеют явные ссылки на соответствующие элементы `Game.html` (трассировка обратна и понятна).

## Definition-of-Done

- [x] Обновлены документы задачи (этот файл и эпик E_0020) с перечнем артефактов и статусом.
- [x] ExecPlan (CP_00020) актуализирован под целевую архитектуру и учитывает, что рефакторинг F_00024 (games/antarctica-nextjs-player) завершён/доступен.
- [x] ROADMAP.md отражает статус фичи.
- [ ] Проверено, что существующие фикстуры (`screen_s1.json` и др.) продолжают рендериться без ошибок.

## Артефакты
- `games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json` (или аналогичный путь) — манифест сценария с разделами meta/config/assets/engine/state/ui/actions.
- Обновлённый `games/antarctica-nextjs-player/src/app/utils/localDataLoader.js` с поддержкой загрузки сценария «Antarctica» через параметр/флаг.

