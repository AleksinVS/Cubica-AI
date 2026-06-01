# Руководство по разработке: Game Editor

## Оглавление

- [Назначение](#назначение)
- [Текущее состояние](#текущее-состояние)
- [Реализованный объем](#реализованный-объем)
- [Editor Engine](#editor-engine)
- [API](#api)
- [Config](#config)
- [Testing](#testing)
- [Legacy](#legacy)
- [Документация и обновления](#документация-и-обновления)

## Назначение
- Предоставляет авторам рабочее пространство для создания и итерации игр с LLM-помощником.
- Обеспечивает визуализацию, чат-редактирование и предпросмотр без угроз целостности данных.

## Текущее состояние

- `services/game-editor/` сейчас является service boundary and documentation owner для редактора игр.
- Первый полный срез authoring editor живет в `packages/editor-engine` и `apps/editor-web`, а не внутри `services/game-editor`.
- `packages/editor-engine` отвечает за framework-agnostic state, JSON Pointer/JSON Patch utilities, text location map, schema registry, graph projection, JSON Tree model, diagnostics и reverse projection.
- `apps/editor-web` отвечает за Next.js UI surface: preview-first workspace, React Flow/JSON Tree projections, Monaco JSON editor, floating property panel, session-backed open/save, layout persistence и validate/compile/preview workflow.

## Реализованный объем
- Реализованный срез поддерживает редактирование authoring JSON через graph canvas, JSON Tree view, Monaco JSON editor и floating property panel.
- Целевая модель редактора имеет три JSON editing modes: flow-chart, JSON tree view и text editor. Все три режима доступны; Tree mode в текущем срезе поддерживает navigation/search/collapse/selection sync и scalar `set value`.
- Реализованы safe property edits, add/remove collection item и connect/disconnect local reference fields через JSON Patch.
- Реализована автоматическая graph projection из JSON и editor-only layout persistence через companion files.
- Реализованы session-backed file open/save, compiler validation, runtime schema validation и player preview через session `contentSourceId`.
- ADR-037 зафиксировал целевую систему плагинов: user-editable plugins живут в `games/<gameId>/plugins/<pluginId>/`, первый этап поддерживает trusted local `player-web` plugins без npm dependencies, а marketplace/runtime-api plugins требуют sandbox-ready модели.
- ADR-039 предлагает схему передачи браузерного файла `player-web` плагина для локального предпросмотра, а ADR-040 принят как политика расширения `runtime-api`: server-side mechanics сначала идут через манифест или общую platform capability, функционал под конкретную игру в `runtime-api` запрещен, trusted project runtime plugins идут через отдельный процесс с JSON-протоколом и отдельное ревью, а marketplace требует контейнерную песочницу или WebAssembly/WASI для чистых вычислений.
- Отложены schema-pointer based UI metadata, structural tree operations (`add/remove/rename/reorder`), сохранение collapse state дерева в layout sidecar, collaborative editing и AI patch review workflow.
- UX-срез `TSK-20260522-editor-engine-progressive-graph-ux` реализован и e2e-принят: progressive semantic graph, semantic labels, role-specific node presentation и сворачиваемые JSON/property panels работают для Antarctica authoring files.

## Editor Engine
- Проектный срез описан в `services/game-editor/docs/editor-engine-authoring-manifest-editor.md`.
- Архитектурное решение зафиксировано в ADR-034.
- `editor-engine` редактирует authoring-манифесты ADR-030, а не generated runtime JSON.
- Flow-chart и JSON tree view являются проекциями authoring JSON. Изменения на диаграмме или дереве должны возвращаться в authoring JSON через JSON Patch либо в отдельный layout target, если это editor-only операция.
- Monaco/JSON editor и floating property panel работают через единый DocumentStore, чтобы не возникало двух источников истины.
- Для JSON tree view действует тот же запрет: tree component не может хранить собственный mutable JSON state как источник данных.

## API
- Текущий `apps/editor-web` использует локальные editor route handlers:
  - `GET /api/editor/files`;
  - `GET /api/editor/file`;
  - `PUT /api/editor/file`;
  - `GET /api/editor/layout`;
  - `PUT /api/editor/layout`;
  - `POST /api/editor/session`;
  - `DELETE /api/editor/session`;
  - `POST /api/editor/validate`;
  - `POST /api/editor/compile`;
  - `POST /api/editor/preview`.
- File API работает только с allowlisted authoring paths внутри `games/<id>/authoring`; с `sessionId` чтение/запись идет через Git worktree under `.tmp/editor-worktrees/<sessionId>`.
- Preview workflow обращается к `runtime-api` через HTTP boundary, включая `POST /content/reload`; для session preview он регистрирует generated manifests from the worktree as `contentSourceId` and opens `player-web` with that same source.
- Будущий полноценный Repository service должен заменить локальный filesystem adapter без изменения core editor-engine contracts.

## Config
- `RUNTIME_API_URL` задает URL `runtime-api` для preview workflow in editor-web and player-web.
- `PLAYER_WEB_URL` задает базовый URL `player-web` для preview URL returned by editor-web.
- `EDITOR_PROJECT_ROOT` задает project repo root for local/e2e editor sessions. If omitted, editor-web uses the current monorepo checkout.
- `EDITOR_PREVIEW_WORKTREES_ROOTS` задает allowlist of local `.tmp/editor-worktrees` roots accepted by runtime-api for temporary editor preview content sources. The list uses the OS path delimiter (`:` on Linux/macOS, `;` on Windows).
- Без runtime/player URL переменных validate/compile остаются доступны, а preview возвращает структурированную readiness diagnostics вместо неуправляемого падения.

## Testing
- Core checks: `npm run verify:editor-engine`.
- Web checks: `npm test --workspace @cubica/editor-web` и `npm run verify:editor-web`.
- Compiler/runtime/player checks для preview path: `npm run verify:manifest-authoring`, `npm run verify:runtime-api`, `npm run verify:player-web`.
- Browser e2e: `npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts` launches runtime-api, player-web and editor-web, sets `EDITOR_PROJECT_ROOT` and `EDITOR_PREVIEW_WORKTREES_ROOTS`, and uses an isolated Git fixture under `.tmp/e2e-editor-project`.
- E2E smoke должен проверять open/save authoring file, layout sidecar, property edit, writable graph operations, validate/compile/preview и отсутствие editor-only data in generated runtime manifests.

## Legacy
- До появления полноценного Repository service текущий filesystem adapter считается локальной developer-facing реализацией editor workflow.
- Pre-existing `teamSelection` drift в runtime/player не относится к `editor-engine`, но должен быть очищен отдельной task, чтобы укрепить platform purity.
- Будущие заглушки и временные адаптеры должны регистрироваться в `docs/legacy/debt-log.csv` с целевой фазой снятия.

## Документация и обновления
- Обновлять гид по итогам каждой итерации (новые API, UX-изменения, зависимости).
- Поддерживать библиотеку промптов в `docs/processes/editor-prompts.md` и будущий онбординг дизайнеров.
- Ссылки на постмортемы и аналитические отчёты добавлять в раздел Legacy при появлении.
