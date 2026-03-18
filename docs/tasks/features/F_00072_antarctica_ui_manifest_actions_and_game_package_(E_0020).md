---
id: F_00072
title: Antarctica — разделение game/ui манифестов, протокол command/payload и пакет игры в games/
status: done
owner: @todo
epic: E_0020
area: game-player
tags: [priority:P0, type:feature, risk:med, effort:M, area:games, area:sdk]
links:
  - docs/architecture/schemas/game-manifest.schema.json
  - docs/architecture/schemas/ui-manifest.schema.json
  - docs/architecture/schemas/ui-schema-concept.md
  - docs/tasks/features/F_00070_manifest_text_anchors_and_ui_split.md
  - games/antarctica-nextjs-player/README.md
  - games/antarctica/scenario.md
---

# FEATURE: Antarctica — разделение game/ui манифестов, протокол command/payload и пакет игры в games/

## Оглавление

- [Контекст и цели](#контекст-и-цели)
- [Термины](#термины)
- [Объём](#объём)
- [Задачи](#задачи)
- [Acceptance Criteria](#acceptance-criteria)
- [Definition of Done](#definition-of-done)
- [Артефакты](#артефакты)

## Контекст и цели

Сейчас Next.js-плеер `games/antarctica-nextjs-player` опирается на “legacy” формат UI-дерева (узлы с `component` и вложенностью через `elements`-map) и на действия в формате `proc/props`. При этом целевая архитектура платформы и схемы манифестов определяют:
- разделение логического манифеста игры (game manifest) и UI-манифеста (UI manifest);
- протокол действий UI → Presenter в виде `command/payload`;
- хранение метрик в `state.public.metrics.*`;
- возможность нескольких каналов UI (например, web и telegram) для одной игры.

Цель фичи — привести “Antarctica” и плеер к этим контрактам так, чтобы:
- контент игры жил как пакет в `games/antarctica/` (game manifest, UI manifests, сценарий);
- плеер рендерил UI из UI manifest (web/telegram), а состояние и патчи применялись к логическому состоянию игры;
- все действия в UI использовали `command/payload` без обратной совместимости с `proc/props` (жёсткая миграция);
- `npm run lint` был неинтерактивным и проходил в `games/antarctica-nextjs-player`.

## Термины

- **Game manifest (логический манифест игры)** — JSON с метаданными, настройками движка, начальными данными и реестром действий; валидируется `docs/architecture/schemas/game-manifest.schema.json`.
- **UI manifest (UI‑манифест)** — JSON, который описывает экраны и дерево UI‑компонентов; валидируется `docs/architecture/schemas/ui-manifest.schema.json`.
- **Viewer (плеер/просмотрщик)** — клиентский модуль, который отображает UI manifest выбранного канала и связывает UI‑события с командами Presenter.
- **JSON Merge Patch (RFC 7396)** — формат патча состояния “частичным объектом”, который рекурсивно сливается с текущим состоянием.
- **JSON Patch (RFC 6902)** — формат патча “списком операций” (add/replace/remove) по путям JSON Pointer.

## Объём

In scope:
- Создать пакет игры `games/antarctica/` и перенести туда `scenario.md` как “источник истины”.
- Разделить данные на:
  - логический манифест (game manifest) для “Antarctica”;
  - UI manifests по каналам: минимум `web` и `telegram`.
- Переписать рендерер/поиск стартового экрана в плеере под UI manifest.
- Перевести действия UI и обработку в плеере/SDK на `command/payload` (жёстко, без алиасов).
- Поддержать патчи состояния: JSON Merge Patch по умолчанию + JSON Patch опционально; метрики — только в `state.public.metrics.*`.
- Добавить минимальный ESLint конфиг в `games/antarctica-nextjs-player`, чтобы `npm run lint` не был интерактивным и проходил.
- Удалить `games/templates` и обновить документацию структуры и задач.

Out of scope:
- Реализация полноценной библиотеки viewers в `SDK/viewers/*` (это отдельная задача/фича).
- Реализация реального Router/Game Engine (можно использовать dev-заглушки и фикстуры).

## Задачи

- [x] Создать `games/antarctica/` и перенести `draft/Antarctica/scenario.md` в `games/antarctica/scenario.md`.
- [x] Сформировать `games/antarctica/game.manifest.json` (логический манифест) с реестром действий и начальным состоянием.
- [x] Сформировать `games/antarctica/ui/web/ui.manifest.json` и `games/antarctica/ui/telegram/ui.manifest.json`.
- [x] Обновить `games/antarctica-nextjs-player`:
  - [x] загрузка game+ui манифестов как единого “view model” объекта;
  - [x] `findEntryPoint` и рендер дерева `ui.screens[*].root.children` (c поддержкой legacy `elements`);
  - [x] обработка действий только через `command/payload`.
- [x] Обновить SDK/shared типы действий и компоненты, чтобы соответствовать `command/payload`.
- [x] Исправить dev-заглушку Router так, чтобы патчи обновляли `game.state.public.metrics.*` (Merge Patch) и (опционально) поддерживали JSON Patch.
- [x] Добавить eslint-конфиг и добиться успешного `npm run lint`.
- [x] Удалить `games/templates` и обновить `PROJECT_STRUCTURE.md`, `docs/tasks/ROADMAP.md`, эпик E_0020 и связанные фичи.

## Acceptance Criteria

- [x] `games/antarctica-nextjs-player` рендерит “Antarctica” из `games/antarctica/ui/web/ui.manifest.json` и использует `games/antarctica/game.manifest.json` как источник состояния.
- [x] Любой обработчик `actions.onClick` и т.п. в UI манифесте использует `command/payload` и успешно диспатчится через презентер.
- [x] Патч (Merge Patch) корректно обновляет `game.state.public.metrics.score` и другие метрики без изменения корневой структуры.
- [x] `npm run lint` в `games/antarctica-nextjs-player` завершается успешно и без интерактивных промптов.
- [x] `games/templates` отсутствует, а документация структуры проекта не противоречит фактическому дереву файлов.

## Definition of Done

- [x] Создан ExecPlan и доведён до `done`.
- [x] ROADMAP.md обновлен
- [x] Структура в PROJECT_STRUCTURE.md актуальна
- [x] Документация обновлена (минимум: эпик/фича/README по плееру при необходимости)

## Артефакты

- `games/antarctica/scenario.md`
- `games/antarctica/game.manifest.json`
- `games/antarctica/ui/web/ui.manifest.json`
- `games/antarctica/ui/telegram/ui.manifest.json`
- `docs/tasks/content-packs/CP_00072_antarctica_ui_manifest_and_actions.yaml`
