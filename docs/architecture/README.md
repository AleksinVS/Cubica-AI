# Навигация по архитектурной документации

Документ помогает ориентироваться в каталоге `docs/architecture/`, описывает структуру артефактов и требования к обновлению архитектурных решений.

## Оглавление

- [Структура каталога](#структура-каталога)
- [Процесс ведения ADR](#процесс-ведения-adr)
- [Требования к изменению артефактов](#требования-к-изменению-артефактов)
- [Связанные материалы](#связанные-материалы)

## Структура каталога
- `adrs/` — архитектурные решения (Architecture Decision Records). Каждое решение фиксируется отдельным файлом `NNN-kebab-case.md` с порядковым номером.
- `agent-ui-foundation.md` — проектная архитектура UI ИИ-агентов на CopilotKit/AG-UI по ADR-043.
- `agent-ui-portability-and-risk-controls.md` — проектные правила переносимости Agent UI, контроля рисков и предотвращения узких мест по ADR-044.
- `ai-agent-safety-remediation.md` — проектные правила исправления review findings по Cubica Surface and AI-driven runtime: approval envelope, Agent Turn acceptance, capability gates, channel action policy and production backend auth по ADR-047.
- `element-prompt-contract.md` — проектный контракт элементного промта по ADR-048: `_prompt` для authoring-экземпляров, `_promptTemplate` для прототипов, жизненный цикл нормализации и границы с `generation.prompt`.
- `generative-ui-surface-protocol.md` — проектная архитектура Cubica-owned Generative UI Surface Protocol по ADR-045 и ADR-046: CopilotKit как MVP-адаптер, собственный compatible Agent UI target, Cubica Surface, A2UI/AG-UI adapter boundaries and AI-driven gameplay surfaces.
- `runtime-mechanics-language.md` — целевая цепочка Game Intent → Cubica Mechanics IR по ADR-083/084: `actionId` и `commandId`, разделённые definition/availability projections, mechanics capability packs, чистые query/assert/algorithm, изменяющие command, structural control nodes, изолированные игровые extensions, command receipts и полный переход со старого `deterministic.effects[]` без постоянного adapter.
- `project-knowledge-system.md` — принятая архитектура проектной вики Cubica, смыслового wiki-графа, FTS5, сразу проверяемого векторного поиска и производного контекста модулей, символов, вызовов и контрактов по ADR-082.
- `product-context-system.md` — отдельный черновой трек продуктовых знаний и ситуативной осведомлённости пользовательских агентов: сырые диалоги и временные операции записи в PostgreSQL, подтверждённая Markdown-вики с управляемой Git-историей, строго локальные патчи, набор чтения и явные зависимости, ограниченный смысловой обзор по риску, детерминированное обслуживание и навигация через `index.md` без начального поискового индекса по Draft ADR-095.
- `testing-strategy.md` — политика тестирования и целевая архитектура проверок для runtime, player, editor, portal, game content и будущего LLM-слоя.
- `diagrams/` — визуальные схемы (C4, последовательности, схемы развёртывания). Создаётся по мере появления диаграмм.
- `openapi/` — спецификации API и совместимые артефакты (JSON/YAML).
- `models/` — схемы данных, ER-диаграммы, DSL-модели.

*Каталоги `diagrams/`, `openapi/`, `models/` создаются по мере появления материалов; сохраняйте единый стиль на уровне командных договорённостей.*

## Процесс ведения ADR
1. Перед началом изменений сформулируйте проблему, альтернативы и критерии принятия решения.
2. Скопируйте `docs/architecture/adrs/000-template.md` в новый файл `docs/architecture/adrs/NNN-your-title.md`, где `NNN` — следующий доступный номер с ведущими нулями.
3. Заполните разделы шаблона; ссылки на эксперименты и прототипы добавляйте в блок «Ссылки».
4. В том же изменении обновите `docs/architecture/PROJECT_ARCHITECTURE.md`: добавьте минимально достаточную суть решения, ключевые ограничения, инварианты и последствия.
5. Отправьте ADR на ревью через обычный процесс (`docs/processes/review-policy.md`).
6. После утверждения зафиксируйте статус (`Accepted`, `Superseded`, `Rejected`) и свяжите ADR с задачами/коммитами.

Если существующая ADR меняет статус, область действия, ограничения или последствия, `PROJECT_ARCHITECTURE.md` обновляется вместе с ней. Для общего понимания архитектуры достаточно `PROJECT_ARCHITECTURE.md`; отдельные ADR читаются только для дополнительного контекста, альтернатив или глубокого разбора.

## Требования к изменению артефактов
- Любые обновления архитектурных документов синхронизируются с `PROJECT_OVERVIEW.md`, `NEXT_STEPS.md` и актуальными задачами в `docs/tasks/active/`.
- При обновлении диаграмм сохраняйте исходники (PlantUML, Mermaid, Figma) рядом или добавляйте ссылки в README.
- Указывайте ответственное подразделение/команду и дату последнего обновления в начале документа.
- Для внешних артефактов (например, схем БД) фиксируйте версию, к которой относится описание.

## Связанные материалы
- `PROJECT_OVERVIEW.md` — источник правды об основных концепциях.
- `docs/architecture/testing-strategy.md` — источник правды о политике тестирования.
- `PROJECT_STRUCTURE.yaml` — машинно-читаемая карта каталогов репозитория.
- `docs/tasks/README.md` — текущая система задач, планов и передачи артефактов.
