---
id: F_00071
title: Архитектура библиотеки viewers (плееров) для игр Cubica
status: done
owner: @GeminiCodeAssist
epic: E_0010
area: viewers
tags: [priority:P1, type:spike, risk:med, effort:M, area:games, area:sdk]
links:
  - docs/architecture/PROJECT_ARCHITECTURE.md
  - PROJECT_STRUCTURE.md
  - docs/architecture/schemas/ui-manifest.schema.json
  - docs/architecture/schemas/game-manifest.schema.json
  - docs/tasks/features/F_00070_manifest_text_anchors_and_ui_split.md
  - docs/tasks/content-packs/CP_00071_viewers_library_architecture.yaml
  - docs/architecture/adrs/015-extension-packs-architecture.md
  - docs/architecture/adrs/016-viewers-library-architecture.md
  - docs/tasks/features/F_00073-extension-packs-architecture.md
---

# FEATURE: Архитектура библиотеки viewers (плееров) для игр Cubica

## Оглавление

- [Контекст и цели](#контекст-и-цели)
- [Объём](#объём)
- [Ключевые решения (которые нужно принять)](#ключевые-решения-которые-нужно-принять)
- [Задачи](#задачи)
- [Acceptance Criteria](#acceptance-criteria)
- [Definition of Done](#definition-of-done)
- [Ссылки](#ссылки)

## Контекст и цели

Viewer (плеер/просмотрщик) — это клиентский модуль, который **загружает UI-манифест** (UI manifest — JSON-описание экранов и компонентов) и **отображает** его пользователю, связывая UI-события с командами Presenter и принимая патчи состояния от Router/Engine.

Цель этой задачи — определить целевую архитектуру “библиотеки viewers”, чтобы:
- новые viewers можно было добавлять осознанно и предсказуемо (только когда существующие не покрывают требования игры);
- viewers можно было каталогизировать, версионировать, собирать и валидировать;
- **Архитектура:** Viewers рассматриваются как **шаблоны/библиотеки** для сборки клиентского приложения игры (Build-time composition).
- **Внимание:** Вместо пользовательских скриптов вводится понятие "Пакеты расширений" (Extension Packs), см. ADR-015.
- игры хранились в `games/*` как “пакеты контента”, а viewers были переиспользуемыми между играми, когда это возможно.

## Объём

In scope:
- Концепция и структура каталога viewers в репозитории (где лежат, как именуются, как обнаруживаются).
- Контракты: какие входы/выходы у viewer (UI manifest, game manifest, state, actions, patches).
- Каталогизация: как понять, какой viewer подходит игре (metadata/manifest fields).
- Версионирование viewers и совместимость с `meta.schema_version`, `min_engine_version` и пакетами расширений.
- Сборка и публикация: как собирать viewers (workspace-пакеты, build artifacts), как их подключают игры.
- Валидация: минимальные проверки (схема UI, схема game manifest, наличие asset refs, проверка action registry).
- Изоляция: границы ответственности viewer в контексте сборки приложения.

Out of scope:
- Реализация конкретного viewer “идеальной версии” (кодовая реализация будет отдельной фичей/ExecPlan).
- Дизайн конкретных UI-компонентов и стили (это остаётся в SDK/shared и в игровых ассетах).

## Ключевые решения (которые нужно принять)

1) Где хранить viewers:
- `SDK/viewers/*` как пакеты SDK (если это “продуктовые библиотеки”);
- или `games/viewers/*` рядом с играми (если это “инструменты запуска игр”).

2) Как игра выбирает viewer:
- через поле в game manifest (`meta.viewer_id` / `config.viewer`) + правила совместимости;
- через “пакет игры” с явным `viewer` в структуре игры;
- через внешнюю конфигурацию (например, Router подбирает viewer по метаданным каталога).

3) **[Решено в ADR-015]** Как расширять функционал:
- Используем **Extension Packs** вместо ad-hoc скриптов.
- Viewer собирается вместе с расширениями из `SDK/extensions` и `games/<id>/extensions` в единый бандл.

4) Какие минимальные контракты обязательны:
- поддержка UI manifest (схема `ui-manifest.schema.json`);
- протокол действий `command/payload` (единый для Presenter ↔ View);
- патчи состояния: JSON Merge Patch по умолчанию + опциональный JSON Patch.

5) Как описывать “допустимо создать новый viewer”:
- критерии (например, новый тип канала/интеракций/рендера);
- процедура (обязательная документация + тесты + регистрация в каталоге viewers).

## Задачи

- [x] Зафиксировать терминологию и границы ответственности viewer (viewer vs SDK vs game content vs Router). (См. ADR-016)
- [x] Предложить целевую структуру каталогов для viewers и игр в `games/*` (без реализации). (См. PROJECT_STRUCTURE.md)
- [x] Определить формат “метаданных viewer” (id, version, supported ui schema versions, supported channels, required capabilities). (См. ADR-016)
- [x] Определить механизм выбора viewer для игры (manifest field + правила совместимости). (См. ADR-016)
- [x] Описать процесс сборки/валидации viewers (команды, артефакты, где хранить результаты). (См. ADR-016)
- [x] Описать стратегию сборки с учетом Extension Packs (Build-time composition). (См. ADR-015)
- [x] Подготовить ADR по библиотеке viewers (архитектурное решение) и связать его с этой задачей. (Создан ADR-016)
- [x] Обновить документацию репозитория (минимум: `PROJECT_STRUCTURE.md`, `docs/architecture/PROJECT_ARCHITECTURE.md`), описав концепцию viewers и правила добавления новых.

## Acceptance Criteria

 [x] Существует ADR, который однозначно описывает архитектуру библиотеки viewers и правила расширения. (ADR-016)
 [x] В документации явно описано: где лежат viewers, как игра выбирает viewer, как версионировать/валидировать, когда создавать новый viewer.
 [x] Прописаны минимальные контракты: UI actions (`command/payload`) и патчи состояния (Merge Patch + опциональный JSON Patch).

## Definition of Done

 [x] Документация обновлена
 [x] Структура в PROJECT_STRUCTURE.md актуальна
 [ ] ROADMAP.md обновлен (Требует отдельного действия, файл не в контексте)

## Ссылки

- `docs/architecture/schemas/ui-manifest.schema.json`
- `docs/architecture/schemas/game-manifest.schema.json`
- `docs/tasks/features/F_00070_manifest_text_anchors_and_ui_split.md`
