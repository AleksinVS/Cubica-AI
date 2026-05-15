# План реализации Трехуровневой Логической Модели (Ladder of Power)

Этот документ описывает шаги по внедрению модели логики, зафиксированной в ADR-029, включая Action Templates, JsonLogic и User Scripts.

## Фаза 1: Завершение внедрения Tier 1 (Action Templates)
**Цель:** Обеспечить 5-кратное сокращение размера манифеста Antarctica.

1.  **Refactoring Antarctica Manifest**:
    *   Создание базовых шаблонов (`info_advance`, `card_resolution`, `apply_metric_delta`) в секции `templates`.
    *   Итеративная замена ~500 действий в `game.manifest.json` на вызовы шаблонов.
    *   Удаление дублирующихся метаданных (`provenance`, `log.kind`) из конкретных действий.
2.  **Schema Hardening**:
    *   Добавление валидации на существование `templateId` в секции `templates` (через `$ref` или кастомные правила).

## Фаза 2: Реализация Tier 2 (Bounded Logic / JsonLogic)
**Цель:** Внедрить прозрачную для ИИ декларативную логику вычислений.

1.  **Integration of JsonLogic**:
    *   Добавление библиотеки `json-logic-js` (или аналогичного легковесного решения) в `services/runtime-api`.
2.  **Runtime-API Updates**:
    *   Добавление поддержки ключа `jsonLogic` в `deterministicHandlers.ts` для полей:
        *   `guard` (сложные условия).
        *   `metricDeltas` (динамические значения).
        *   `stateUpdate` (вычисляемые состояния).
3.  **Contracts & Schema**:
    *   Обновление `@cubica/contracts-manifest` для поддержки типа `JsonLogicExpression`.
    *   Обновление JSON-схемы для валидации древовидных структур логики.

## Фаза 3: Стандартизация Tier 3 (User Scripts)
**Цель:** Обеспечить безопасный "последний рубеж" для сложной логики.

1.  **Sandbox Capability Routing**:
    *   Уточнение интерфейса между `runtime-api` и `isolated-vm` (ADR-010).
    *   Добавление явной регистрации "разрешенных" функций скриптов в манифесте.
2.  **Antarctica Legacy Migration**:
    *   Перенос оставшейся сложной логики (если такая останется после внедрения JsonLogic) в изолированные скрипты под `handlerType: "script"`.

## Фаза 4: Обновление документации и верификация
**Цель:** Синхронизировать документацию с новой реальностью и подтвердить стабильность.

1.  **Project Overview Update**:
    *   Отразить "Ladder of Power" в `PROJECT_OVERVIEW.md` как основной стандарт разработки.
2.  **Authoring Guidelines**:
    *   Создать `docs/architecture/GAME_AUTHORING_GUIDE.md` с примерами, когда использовать Templates, когда JsonLogic, а когда Scripts.
3.  **Roadmap Alignment**:
    *   Обновить `NEXT_STEPS.md`, включив этапы внедрения JsonLogic.
4.  **Verification**:
    *   Прогон полного цикла тестов `runtime-api` и `player-web`.
    *   Замер размера манифеста до и после (Antarctica Manifest Size Report).
