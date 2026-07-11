# ADR-045: Cubica-Owned Generative UI And MVP CopilotKit Adapter

- **Дата**: 2026-06-10
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Editor Web, Player Web, Portal, Runtime API, Agent UI, AI Contracts, UI Manifests
- **Связанные решения**: ADR-003, ADR-025, ADR-030, ADR-034, ADR-036, ADR-040, ADR-043, ADR-044, ADR-046

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Архитектурные инварианты](#5-архитектурные-инварианты)
- [6. Границы применения](#6-границы-применения)
- [7. Альтернативы](#7-альтернативы)
- [8. Последствия](#8-последствия)
- [9. Связанные артефакты](#9-связанные-артефакты)

## 1. Понимание решения

Решение понято так: Cubica принимает идеи CopilotKit (React/Next.js-фреймворка для встраивания ИИ-помощников) Generative UI, включая Generative UI Spectrum (классификацию режимов генерации UI по свободе агента) и A2UI (декларативную JSONL-спецификацию UI-поверхностей), как полезную архитектурную опору для интерфейсов игр, редактора и помощников. При этом CopilotKit должен рассматриваться как решение первого этапа MVP, а не как постоянная предметная основа платформы.

Целевое направление Cubica - собственный совместимый слой Agent UI и Generative UI, который может использовать CopilotKit/AG-UI на первом этапе, но сохраняет внутренние контракты, схемы, словарь компонентов, проверки и право на замену UI-адаптера за Cubica.

## 2. Контекст

Cubica уже имеет несколько близких архитектурных оснований:

- ADR-003 принял Hybrid SDUI, то есть гибридный серверно управляемый интерфейс, где UI описывается JSON-манифестом и рендерится клиентом.
- ADR-043 принял CopilotKit и AG-UI (событийный протокол между пользовательским приложением и backend-сервисом агента) как начальную основу пользовательских ИИ-помощников.
- ADR-044 ограничил CopilotKit и AG-UI ролью заменяемых адаптеров.
- `apps/editor-web` уже использует preview-first редактор, AI prompt surface, `EditorChangeSet`, dry-run, undo journal and Save workflow.
- `apps/player-web` получает player-facing projection из `runtime-api`, а не authoring/editor state.

Материалы CopilotKit Generative UI полезны тем, что разделяют режимы генерации UI по уровню свободы агента:

- controlled Generative UI - агент вызывает заранее определённые инструменты и UI-компоненты;
- declarative Generative UI - агент возвращает структурированное описание интерфейса из разрешённого словаря компонентов;
- open-ended Generative UI - агент строит почти произвольный UI или использует внешние приложения.

Для Cubica это хорошо совпадает с идеей UI-манифестов, Presenter boundary and manifest-defined actions, но требует собственного стабильного протокола, потому что игровые манифесты, runtime state и редакторские change sets не должны зависеть от стороннего формата.

## 3. Термины

- **Generative UI** - интерфейс, который ИИ-агент выбирает, описывает или управляет во время работы, а не только заранее зашитый в клиент.
- **Generative UI Spectrum** - классификация режимов Generative UI по свободе агента: controlled, declarative and open-ended.
- **CopilotKit** - React/Next.js-фреймворк для встраивания ИИ-помощников в приложения.
- **AG-UI** - событийный протокол между пользовательским приложением и backend-сервисом агента.
- **A2UI** - декларативная потоковая спецификация UI, где агент отправляет обновления поверхности, модель данных и команду начала рендера в JSONL-формате.
- **MVP-этап** - первый минимально достаточный продуктовый этап, на котором допустим внешний адаптер ради быстрой проверки пользовательской ценности.
- **Cubica Surface** - принадлежащее Cubica декларативное описание ограниченной UI-поверхности: область, дерево компонентов, модель данных, действия и политики безопасности.
- **Совместимость** - способность Cubica принимать или отдавать похожие на AG-UI/A2UI события через адаптеры без превращения этих внешних форматов в источник истины.
- **Авторитетное состояние** - долговременные данные Cubica: манифесты, рабочие копии редактора, runtime-сессии, портал, лицензии и аудит.

## 4. Решение

Cubica принимает собственный Cubica-owned Generative UI подход.

1. **CopilotKit является MVP-адаптером первого этапа.**
   - CopilotKit разрешён для ускоренного запуска редакторского помощника, tool rendering, streaming UI and human-in-the-loop controls.
   - CopilotKit не является целевой постоянной предметной моделью UI помощников.
   - Новые решения должны проектироваться так, чтобы CopilotKit можно было заменить собственным Cubica Agent UI без изменения `editor-engine`, `runtime-api`, game bundles and manifest schemas.

2. **Целевой слой - собственный совместимый Cubica Agent UI.**
   - Cubica должна владеть реестром помощников, каталогом инструментов, формой событий агента, формой UI-поверхностей, политиками подтверждения and validation gates.
   - Будущий собственный UI может отображать те же сообщения, tool calls, approvals and surface specs, которые сейчас проходят через CopilotKit.
   - AG-UI и A2UI-подобные события остаются внешними протокольными форматами, которые переводятся в контракты Cubica на границе адаптера.

3. **Cubica вводит Cubica Surface как внутренний декларативный контракт Generative UI.**
   - Cubica Surface описывает `surfaceId`, режим, словарь компонентов, версию словаря, дерево компонентов, модель данных, привязки, действия and side-effect policy.
   - Формат должен быть JSON Schema-first and framework-neutral.
   - A2UI может быть источником идей и внешним форматом обмена, но не заменяет Cubica UI manifests или JSON Schema.

4. **Generative UI Spectrum становится правилом проектирования.**
   - Controlled Generative UI - режим по умолчанию для deterministic gameplay, изменяющих инструментов и критичных подтверждений.
   - Declarative Generative UI - допустим для редактора, портала, помощника ведущего, подсказок игроку, authoring workflows and AI-driven gameplay по ADR-046, если используется ограниченный словарь компонентов и JSON Schema validation.
   - Open-ended Generative UI - допустим только как sandbox в редакторе или исследовательский прототип, не как production runtime для игроков.

5. **Все изменяющие действия проходят через Cubica commands.**
   - Редакторские изменения остаются `EditorPatchIntent -> EditorChangeSet -> dry-run -> apply/undo/save`.
   - Игровые действия остаются manifest-defined runtime actions через `runtime-api`.
   - Портальные действия остаются portal API commands с RBAC and audit.
   - UI-поверхность агента никогда не применяет патчи к авторитетному состоянию напрямую.

## 5. Архитектурные инварианты

1. CopilotKit imports stay inside approved app adapter files.
2. A2UI, Open-JSON-UI or AG-UI objects must not be saved as Cubica domain state.
3. Cubica Surface specs are untrusted input until validated by Cubica JSON Schema and semantic checks.
4. Deterministic player runtime must remain usable when CopilotKit, AG-UI and all agent backends are disabled; AI-driven games may require Agent Runtime only when that dependency is declared by manifest and readiness checks.
5. Production player UI cannot render arbitrary HTML, arbitrary remote components or open-ended agent UI.
6. Declarative agent surfaces use an allowlisted component catalog and explicit action catalog.
7. Every action in a generated surface maps to a Cubica tool, Presenter command, portal API or runtime action with a side-effect policy.
8. Mutating actions require human-in-the-loop approval unless the owning assistant record explicitly allows system approval.
9. Generated UI can be persisted into manifests only through authoring workflows and schema validation, not as raw agent output.
10. New game mechanics still follow ADR-040: manifest/platform capability first, no game-specific branches in generic runtime layers.

## 6. Границы применения

### Editor Web

Allowed:

- assistant surfaces for diff summaries, diagnostics, forms, preview explanations and bounded layout proposals;
- controlled tool rendering for plan, dry-run, apply, undo, preview and save;
- declarative Cubica Surface proposals that compile into `EditorChangeSet` after validation.

Forbidden:

- saving CopilotKit/A2UI state into authoring manifests;
- full-manifest rewrites as normal assistant output;
- bypassing `EditorChangeSet` or undo journal.

### Player Web And AI-Driven Games

Allowed:

- controlled surfaces for hints, rules explanation, player-facing summaries and facilitator panels;
- declarative surfaces only from trusted Cubica projections and allowlisted semantic widgets.
- agent-authored `CubicaSurface` as primary gameplay UI when a game declares `ai-driven` or `hybrid` runtime mode under ADR-046.

Forbidden:

- open-ended arbitrary UI in production gameplay;
- hidden gameplay mutation from assistant UI;
- reading `state.secret` without a role-specific contract.

### Portal And Facilitator Surfaces

Allowed:

- catalog guidance, launch-session drafts, progress summaries and debrief notes through Cubica APIs;
- human approval for launch, purchase, archive and mutating facilitator actions.

Forbidden:

- direct database writes;
- payment, license or runtime session changes through generated UI state.

## 7. Альтернативы

### A. Считать CopilotKit постоянной целевой платформой UI помощников

Отклонено. Это ускорило бы короткий путь, но сделало бы замену UI expensive and risky. CopilotKit остаётся полезным MVP-адаптером.

### B. Принять A2UI как внутренний источник истины UI

Отклонено. A2UI близок к Cubica, но внешний формат не должен заменять JSON Schema, UI manifests and Cubica-owned contracts.

### C. Сразу построить полностью собственный Agent UI

Отклонено для MVP. Это лучше соответствует долгосрочной цели, но задерживает проверку редакторского помощника и human-in-the-loop workflows.

### D. Не использовать Generative UI в игровой платформе

Отклонено. Интерфейсы игр, редактора и помощников в Cubica уже являются декларативными и agent-friendly; отказ от Generative UI лишил бы проект естественного развития.

## 8. Последствия

Положительные последствия:

- CopilotKit получает понятную роль MVP-ускорителя, а не постоянной зависимости.
- Проект получает общий язык для controlled, declarative and open-ended UI decisions.
- Собственный Cubica Surface Protocol становится мостом между UI-манифестами, Agent UI and future custom renderer.
- Будущая замена CopilotKit ограничивается адаптером, если текущие границы соблюдаются.
- A2UI можно использовать как источник идей и compatibility target без потери контроля над архитектурой.

Цена и риски:

- Cubica должна спроектировать и поддерживать собственный surface schema, renderer and tests.
- Два слоя совместимости, CopilotKit/AG-UI MVP and Cubica-owned target, требуют дисциплины в адаптерах.
- Ранние surface specs могут начать дублировать UI-манифесты, если не держать чёткую границу authoring/runtime.
- Open-ended prototypes нужно явно изолировать, иначе они создадут security and UX drift.

## 9. Связанные артефакты

- `docs/architecture/generative-ui-surface-protocol.md`
- `docs/architecture/agent-ui-foundation.md`
- `docs/architecture/agent-ui-portability-and-risk-controls.md`
- `docs/architecture/adrs/003-hybrid-sdui-schema.md`
- `docs/architecture/adrs/043-copilotkit-ag-ui-agent-ui-foundation.md`
- `docs/architecture/adrs/044-agent-ui-portability-and-protocol-boundaries.md`
- `docs/architecture/adrs/046-ai-driven-game-runtime-mode.md`
- `docs/tasks/archive/TSK-20260610-cubica-generative-ui-surface-protocol.md`
- External references:
  - `https://www.copilotkit.ai/generative-ui`
  - `https://www.copilotkit.ai/ag-ui`
