---
id: F_00022
title: Antarctica — локальная загрузка манифеста и рендер в Next.js-плеере
status: planned
owner: @todo
epic: E_0020
area: game-player
tags: [priority:P1, type:feature]
links:
  - docs/tasks/brief.md
  - games/antarctica-nextjs-player/README.md
---

# FEATURE: Antarctica — локальная загрузка манифеста и рендер в Next.js-плеере

## Оглавление
- [Цели](#цели)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты и зависимости](#артефакты-и-зависимости)

## Цели
- [ ] Обеспечить загрузку манифеста «Antarctica» через `localDataLoader` с выбором сценария по query-параметру или флагу.
- [ ] Отрисовать первый экран «Antarctica» в Next.js-плеере с метриками, карточками и кнопками из раздела `ui` манифеста.
- [ ] Обработать клики по карточкам через presenter (`requestServer`/`showHint`/`showHistory` и т.д.) без нарушений MVP.

## Scope
- In scope:
  - Подключение манифеста `antarctica` к `localDataLoader` и маршрутизация по параметру (`scenario=antarctica`).
  - Преобразование `ui.application` манифеста в `appState` через `findEntryPoint` с сохранением совместимости со старым `screen_s1.json`.
  - Минимальные действия по клику (логирование/переход/заглушка `requestServer`) и отсутствие ошибок рендера.
- Out of scope:
  - Полная бэкенд-логика Game Engine/Router.
  - Продвинутые эффекты (анимации, сложные патчи состояния) — отдельные задачи.

## User-Stories--Задачи
- [ ] Как разработчик, я могу открыть `http://localhost:3000?scenario=antarctica&local=true` и увидеть первый экран с метриками и карточками из манифеста.
- [ ] Как разработчик, я могу переключиться обратно на базовую фикстуру (без параметра) без поломок.
- [ ] Как разработчик, я могу кликнуть по карточке и увидеть обработку действия (лог, переход или вызов `requestServer`) без ошибок в консоли.

## Acceptance-Criteria
- [ ] `localDataLoader` умеет выбирать и загружать манифест `antarctica`, не ломая существующие сценарии.
- [ ] `GameScreenRenderer` рендерит UI из `ui.application` манифеста без ошибок.
- [ ] Клики по карточкам вызывают настроенные обработчики (`requestServer` или локальные) и не приводят к падениям.
- [ ] Документация (эпик E_0020, ROADMAP) отражает наличие этой фичи.

## Definition-of-Done
- [ ] Создан ExecPlan (CP_00022-*.yaml) и выполнен в актуальном виде.
- [ ] Обновлены эпик E_0020 и ROADMAP.md с ссылкой на фичу и статусом.
- [ ] Текущие фикстуры (`screen_s1.json` и др.) продолжают корректно рендериться.
- [ ] При локальном запуске `npm run dev` сценарий «Antarctica» отображается по параметру и клики отрабатывают.

## Артефакты и зависимости
- `games/antarctica-nextjs-player/src/app/utils/localDataLoader.js` — выбор сценария и загрузка манифеста.
- `games/antarctica-nextjs-player/src/app/sdk/presenter.js` — обработчики действий по клику (через ViewCommand/ViewResponse).
- `games/antarctica-nextjs-player/src/app/data/antarctica/manifest.json` — целевой манифест (из фичи F_00021).
- Зависит от схемы манифеста: `docs/architecture/schemas/game-manifest.schema.json` и результатов рефакторинга F_00024.
