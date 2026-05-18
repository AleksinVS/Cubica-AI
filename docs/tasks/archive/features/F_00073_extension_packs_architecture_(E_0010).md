---
id: F_00073
title: Архитектура пакетов расширений (Extension Packs) для Viewers и Engine
status: done
owner: @GeminiCodeAssist
epic: E_0010
area: architecture
tags: [priority:P1, type:spike, risk:med, effort:M, area:sdk]
links:
  - docs/tasks/features/F_00071_viewers_library_architecture_(E_0010).md
  - docs/architecture/adrs/015-extension-packs-architecture.md
  - docs/architecture/schemas/extension.schema.json
---

# FEATURE: Архитектура пакетов расширений (Extension Packs)

## Оглавление

- Контекст и цели
- Объём
- Задачи
- Acceptance Criteria

## Контекст и цели

В рамках задачи F_00071 мы определили необходимость библиотеки Viewers. Однако базовые Viewers не могут покрыть 100% потребностей всех игр. Ранее планировалось использование "пользовательских скриптов", но этот подход плохо масштабируется и небезопасен.

Цель этой задачи — разработать детальную архитектуру **Extension Packs** (пакетов расширений). Пакеты расширений должны поддерживать как клиентскую часть (Viewer Extensions), так и серверную/логическую (Engine Extensions). Расширения должны собираться вместе с ядром (Viewer/Engine) в единый артефакт.

Ключевая идея:
- **Base Viewer/Engine** — это библиотеки/шаблоны.
- **Extension Packs** — предоставляют "Возможности" (Capabilities) и тяжелую логику (Build-time).
- **User Scripts** — предоставляют "Контент" и сценарную логику (Runtime Sandbox).
- **Viewer/Engine** — это собираемое приложение, включающее ядро и набор расширений.
- **Extension** — это npm-пакет или локальный модуль, подключаемый при сборке.

## Объём

In scope:
- Разработка схемы манифеста расширения (`extension.json`).
- Определение структуры каталогов для Public (`SDK/extensions`) и Local (`games/*/extensions`) пакетов.
- Правила версионирования (SemVer) и проверки совместимости с Base Viewer/Engine.
- Механизм декларации зависимостей в `game.manifest.json`.
- Жизненный цикл расширения: загрузка, инициализация, доступ к API (Sandbox/Context).
- Определение структуры расширения как NPM-пакета.
- Описание схемы сборки (Build Pipeline) для Viewers и Engine.
- Механизм инъекции расширений (Dependency Injection) в Runtime без Sandbox.
- Обновление `PROJECT_STRUCTURE.md` для поддержки локальных модулей.

Out of scope:
- Реализация конкретных расширений (это отдельные задачи).
- Настройка CI/CD пайплайнов (это задача DevOps).

## Задачи

- [x] Разработать JSON-схему для `extension.json` (id, version, type, compatibility, entry point, capabilities). (См. docs/architecture/schemas/extension.schema.json)
- [x] Определить структуру файловой системы для `SDK/extensions` и `games/<id>/extensions`. (См. ADR-015 и PROJECT_STRUCTURE.md)
- [x] Описать схему сборки (Build-time composition) вместо Runtime resolution. (См. ADR-015)
- [x] Описать API взаимодействия Base Viewer <-> Extension (прямой доступ к Context/DOM). (См. ADR-015)
- [x] Описать API взаимодействия Base Engine <-> Extension (прямой доступ к Node.js API). (См. ADR-015)
- [x] Обновить документацию `PROJECT_STRUCTURE.md` с учетом новых папок.
- [x] Синхронизироваться с задачей F_00071 (Viewers Architecture).

## Acceptance Criteria

- [x] Создан документ (или раздел в Architecture), описывающий спецификацию Extension Packs. (ADR-015)
- [x] Готова JSON-схема `extension.schema.json`.
- [x] В документации приведены примеры:
    - Манифеста публичного расширения.
    - Манифеста локального расширения.
    - Секции `config` в `game.manifest.json`, подключающей оба типа.
 [x] Описана модель безопасности: доверие на этапе сборки (Code Review, CI Scan) для расширений и Runtime Sandbox для скриптов. (ADR-015)

## Definition of Done

 [x] ADR-015 утвержден.
 [x] Спецификация согласована с командой разработки Engine и Frontend.
 [ ] Обновлен ROADMAP.md. (Требует отдельного действия)

## Ссылки

- `docs/architecture/adrs/015-extension-packs-architecture.md`
```
