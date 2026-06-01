# План реализации Трехуровневой Логической Модели (Ladder of Power)

Этот документ описывает исторический план внедрения модели логики, зафиксированной в ADR-029, включая Action Templates, JsonLogic и расширяемые эффекты.

## Оглавление

- [Статус](#статус)
- [Фаза 1: Завершение внедрения Tier 1 (Action Templates)](#фаза-1-завершение-внедрения-tier-1-action-templates)
- [Фаза 2: Реализация Tier 2 (Bounded Logic / JsonLogic)](#фаза-2-реализация-tier-2-bounded-logic--jsonlogic)
- [Фаза 3: Стандартизация Tier 3 (Declarative Effects)](#фаза-3-стандартизация-tier-3-declarative-effects)
- [Фаза 4: Обновление документации и верификация](#фаза-4-обновление-документации-и-верификация)

## Статус

Этот план частично устарел после ADR-040. Новая серверная механика по умолчанию должна идти через манифест, JSON Schema и общие platform capabilities. `handlerType: "script"` не является целевым способом добавления логики; доверенные runtime-плагины допускаются только отдельным решением, отдельным процессом и JSON-протоколом.

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
        *   ``metric.add`` (динамические значения).
        *   `effects[]` (проверяемые изменения состояния).
3.  **Contracts & Schema**:
    *   Обновление `@cubica/contracts-manifest` для поддержки типа `JsonLogicExpression`.
    *   Обновление JSON-схемы для валидации древовидных структур логики.

## Фаза 3: Стандартизация Tier 3 (Declarative Effects)
**Цель:** Обеспечить проверяемый "последний рубеж" для сложной логики без произвольного кода в манифесте.

1.  **Capability Routing**:
    *   Описывать сложные действия через schema-defined `effects[]`, guard и ограниченные state paths.
    *   Не использовать `node:vm`, `worker_threads` или `isolated-vm` как защитную границу для чужого кода.
2.  **Antarctica Legacy Migration**:
    *   Бывшие легкие UI/runtime script actions уже перенесены в `manifest-data` + `effects[]`.
    *   Если позже потребуется серверный код, он должен идти через ADR-040 как доверенный runtime-плагин с отдельным процессом, владельцем, тестами и путем миграции.

## Фаза 4: Обновление документации и верификация
**Цель:** Синхронизировать документацию с новой реальностью и подтвердить стабильность.

1.  **Project Overview Update**:
    *   Отразить "Ladder of Power" в `PROJECT_OVERVIEW.md` как основной стандарт разработки.
2.  **Authoring Guidelines**:
    *   Создать `docs/architecture/GAME_AUTHORING_GUIDE.md` с примерами, когда использовать templates, когда JsonLogic, а когда schema-defined effects.
3.  **Roadmap Alignment**:
    *   Обновить `NEXT_STEPS.md`, включив этапы внедрения JsonLogic.
4.  **Verification**:
    *   Прогон полного цикла тестов `runtime-api` и `player-web`.
    *   Замер размера манифеста до и после (Antarctica Manifest Size Report).
