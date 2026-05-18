---
id: E_0020
title: Antarctica на Next.js game player
status: in_progress
owner: @todo
milestone: M_010
area: game-player
tags: [priority:P1, type:feature]
links:
  - docs/tasks/brief.md
  - draft/Antarctica/README.md
  - games/antarctica-nextjs-player/README.md
---

# EPIC: Antarctica на Next.js game player

## Оглавление
- [Описание](#описание)
- [Результат-для-пользователя](#результат-для-пользователя)
- [Работы-и-зависимости](#работы-и-зависимости)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)

## Описание
Этот эпик описывает перенос текстового квеста «Antarctica» из монолитного HTML/Bootstrap прототипа (`draft/Antarctica/Game.html`) в целевую архитектуру платформы Cubica (LLM-first — LLM, Large Language Model, большая языковая модель, выступает игровым движком; MVP — Model–View–Presenter, паттерн разделения данных, UI и презентера). После рефакторинга (фича F_00024) фронтенд размещён в `games/antarctica-nextjs-player/` и интегрирован с SDK, а сценарий описывается как JSON-манифест (структурированный файл с разделами `meta/config/assets/engine/state/ui/actions`), валидируемый схемой `docs/architecture/schemas/game-manifest.schema.json`.

Исходный прототип содержит:
- объект `cardsObj` с карточками, информационными экранами и участниками команды;
- объект `game` с таймлайном (`timeline`), текущим состоянием метрик (pro/rep/lid/man/stat/cont/constr/time/score) и основным циклом `game.next`;
- интерпретатор действий `game.operate`/`game.operateArray`, изменяющий состояние при кликах по карточкам.

Новый плеер ожидает:
- JSON-манифест, где UI описан как Abstract View (данные вместо разметки): корневой `application.elements` содержит экраны (`screenComponent`), внутри — области (`areaComponent`), метрики и карточки (`gameVariableComponent`, `cardComponent`, `buttonComponent`).
- Раздел `actions` манифеста, описывающий обработчики (`handler_type: llm|script`) и соответствующие идентификаторы, а в UI — ссылки на действия (`props.actions.*`) для диспетчеризации через `src/app/utils/actions.js` и применения патчей (`APPLY_PATCH`) или замены дерева (`REPLACE_STATE`).
- Наличие `meta.schema_version` и `meta.min_engine_version` для проверки совместимости Router (API-шлюз и менеджер сессий) и Game Engine (служба, применяющая правила и ответы LLM).

Эпик фокусируется на том, чтобы сценарий «Antarctica» стал управляемыми данными (JSON-манифестом) и рендерился через `GameScreenRenderer`, не завязываясь на исходный jQuery/Bootstrap-код.

## Результат-для-пользователя
После выполнения эпика пользователь сможет:
- запустить Next.js-плеер для сценария «Antarctica» из целевого каталога `games/` (после переноса из `draft/game-player-nextjs`) в dev-режиме;
- выбрать/открыть сценарий «Antarctica»;
- увидеть знакомую шкалу показателей (pro, rep, lid, man, stat, cont, constr, score/time) и стартовый набор карточек;
- проходить сценарий, кликая по карточкам и переходя по шагам, при этом вся структура UI будет описана в JSON-манифесте, а не «зашита» в HTML.

## Работы-и-зависимости

### Связанные-фичи
- [ ] [F_00024: Рефакторинг game-player-nextjs под SDK и целевую архитектуру](../features/F_00024_game_player_nextjs_refactor_(E_0020).md)
  - [ ] [F_00021: JSON-манифест сценария «Antarctica» для Next.js-плеера](../features/F_00021_antarctica_json_manifest_(E_0020).md) — in_progress
 - [x] [F_00072: Antarctica — разделение game/ui манифестов, протокол command/payload и пакет игры в games/](../features/F_00072_antarctica_ui_manifest_actions_and_game_package_(E_0020).md)
- [ ] [F_00022: Antarctica — локальная загрузка манифеста и рендер в Next.js-плеере](../features/F_00022_antarctica_local_loader_and_renderer.md)
- [ ] [F_00023: Antarctica — обучающие метаданные и методические материалы](../features/F_00023_antarctica_training_metadata_and_methodology.md)

### Пользовательские-истории
- [ ] Как разработчик, я могу запустить `games/antarctica-nextjs-player` и увидеть тестовый экран, совпадающий с первым шагом `game.timeline` из `Game.html`.
- [ ] Как разработчик, я могу локально переключить фикстуру (fixture) на сценарий «Antarctica» и проверить, что плеер корректно рендерит шкалы и карточки из раздела `ui`.
- [ ] Как разработчик, я могу кликнуть по карточке, увидеть вызов действия (`requestServer` или локальный handler) и получить ожидаемый патч/лог без нарушения MVP.
- [ ] Как методист/ведущий, я вижу в манифесте заполненные `meta.training` (компетенции, формат, длительность) и доступ к методическим `.md` для участников и ведущих.
- [ ] Как разработчик платформы, я могу использовать `SDK/react-sdk` и `SDK/shared` для работы с плеером `games/antarctica-nextjs-player`, не дублируя SDK-логику и UI внутри прототипа.

## Acceptance-Criteria
- [ ] Существует JSON-манифест сценария с разделами `meta/config/assets/engine/state/ui/actions`, содержащий `schema_version` и `min_engine_version`, валидный к схеме `docs/architecture/schemas/game-manifest.schema.json`.
- [ ] UI-раздел манифеста (Abstract View) описывает хотя бы один полный экран «Antarctica» и валидно рендерится через `renderer.js`/`GameScreenRenderer` без ошибок.
- [ ] Next.js-плеер может отрисовать сценарий «Antarctica» в режиме локальных данных (fixtures), без сетевых запросов к Game Engine, с сохранением возможности отправлять действия через `requestServer`/`actionHandlers`.
- [ ] Основные метрики (pro, rep, lid, man, stat, cont, constr, score/time) отображаются и могут обновляться локальной логикой или патчами (`APPLY_PATCH`), совместимыми с Router/Game Engine.
- [ ] В манифесте заполнены обучающие метаданные (`meta.training`), а `assets.methodology` указывает на методические `.md` для участников и ведущих (контент соответствует назначению).

## Definition-of-Done
- [ ] Обновлены документы задач (данный эпик и связанные фичи) с актуальным статусом и чек-листами.
- [ ] ROADMAP.md содержит ссылку на эпик и фичу для сценария «Antarctica».
- [ ] Изменения не противоречат `PROJECT_ARCHITECTURE.md`, учитывают LLM-first/MVP (ADR-001/002/008) и не ломают другие сценарии/фикстуры плеера.
