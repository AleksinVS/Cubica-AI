# Next Steps

Текущая доска проекта. Стратегические направления описаны в `docs/tasks/STRATEGY.md`, подробные планы ведутся в `docs/tasks/active/`, постоянные артефакты задач — в `docs/tasks/artifacts/`, архив старой системы — в `docs/tasks/archive/`.

## Оглавление

- [Правило выбора работы](#правило-выбора-работы)
- [Now](#now)
- [Next](#next)
- [Later](#later)
- [Blocked](#blocked)
- [Canonical Context](#canonical-context)

## Правило выбора работы

1. Сначала брать задачи из `Now`.
2. Если нужно выбрать между направлениями, свериться с `docs/tasks/STRATEGY.md`.
3. Если задача требует архитектурного решения, сначала проверить или создать ADR.
4. Каждая активная работа должна иметь один файл `TSK-*` в `docs/tasks/active/`.
5. В конце каждой остановки обновлять `Handoff Log` в активной задаче.

## Now

- [TSK-20260518-architecture-repair-and-task-system-migration](docs/tasks/active/TSK-20260518-architecture-repair-and-task-system-migration.md) — восстановить зеленый canonical slice, устранить архитектурные разрывы из ревью 2026-05-18 и завершить миграцию системы задач на ADR-031.
- [TSK-20260520-project-review-remediation](docs/tasks/active/TSK-20260520-project-review-remediation.md) — реализация исправлений находится на review: структурный индекс, legacy/stub реестры, битые ссылки и блокирующая CI-проверка незарегистрированных заглушек обновлены.
- [TSK-20260521-game-agnostic-architecture-simplification](docs/tasks/active/TSK-20260521-game-agnostic-architecture-simplification.md) — implemented: default game config, исправленный scaffold, neutral journal metadata, `simple-choice` fixture и game-agnostic CI invariant добавлены.

## Next

- [TSK-20260518-portal-test-vps-and-antarctica-launch](docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md) — доработать портал как launch surface, развернуть test VPS и запустить игровые сессии `Antarctica` с контролем ссылок, сроков и запусков.
- [TSK-20260518-json-schema-strict-validation](docs/tasks/active/TSK-20260518-json-schema-strict-validation.md) — перевести Ajv из `strict: false` к строгому режиму без императивного дрейфа.
- [TSK-20260521-semantic-prototype-authoring-layer](docs/tasks/active/TSK-20260521-semantic-prototype-authoring-layer.md) — внедрить обязательный authoring-слой для game/UI manifests по ADR-030 с идемпотентной компиляцией и CI-блокировкой generated drift.
- [TSK-20260521-antarctica-authoring-manifest-migration](docs/tasks/active/TSK-20260521-antarctica-authoring-manifest-migration.md) — перенести `Antarctica` game/web/telegram manifests на authoring-слой ADR-030 через parity adoption и последующую семантическую декомпозицию.
- [TSK-20260521-antarctica-authoring-review-remediation](docs/tasks/active/TSK-20260521-antarctica-authoring-review-remediation.md) — исправить находки ревью миграции `Antarctica`: missing final action, source-map pointer validation и неточные byte-equivalence claims.
- [TSK-20260522-editor-engine-authoring-manifest-editor](docs/tasks/active/TSK-20260522-editor-engine-authoring-manifest-editor.md) — implemented-full: `packages/editor-engine` и `apps/editor-web` дают flow-chart projection, JSON Tree view, Monaco/JSON editor, floating property panel, repository-backed save, editor-only layout persistence, validation/compile/preview и безопасные writable graph/tree operations.
- [TSK-20260522-editor-engine-progressive-graph-ux](docs/tasks/active/TSK-20260522-editor-engine-progressive-graph-ux.md) — implemented-e2e-accepted: raw JSON-tree canvas заменен на progressive semantic graph, добавлены разные типы узлов, semantic labels и сворачиваемые JSON/property panels; повторная e2e приемка Antarctica прошла.
- [TSK-20260522-editor-engine-json-tree-view](docs/tasks/active/TSK-20260522-editor-engine-json-tree-view.md) — implemented-e2e-accepted: JSON Tree view добавлен как третий целевой режим редактирования рядом с flow-chart и Monaco; tree работает через DocumentStore/JSON Patch, синхронизирует selection с graph/property/Monaco, поддерживает scalar `set value`, а structural tree operations отложены.
- [TSK-20260527-editor-engine-preview-timeline-editor](docs/tasks/active/TSK-20260527-editor-engine-preview-timeline-editor.md) — phase-9-local-plugin-migration-complete: authoring manifests are v2, preview AI prompts apply bounded active-file JSON ChangeSets with undo/redo, editor-web opens a Git worktree session, Save creates a session commit, validate/compile run from the session worktree, local player preview uses a session `contentSourceId`, and browser e2e covers the three-service session preview path. ADR-037 local `player-web` plugin stage is implemented for `Antarctica`: the plugin lives in `games/antarctica/plugins/antarctica-player`, local preview loads session plugin bundles, production player mode loads published plugin bundles, the editor UI has a dedicated plugin diagnostics journal row, and the closeout is recorded in `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`. ADR-040 принят: новая server-side механика сначала должна идти через манифест/общую platform capability, функционал под конкретную игру в `runtime-api` запрещен, trusted project runtime plugins идут через отдельный процесс с JSON-протоколом и отдельное ревью, а для marketplace целевой путь - контейнерная песочница или WebAssembly/WASI для чистых вычислений. Next major editor-engine work is richer time-travel rollback UI after choosing the preview restore protocol in `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/time-travel-rollback-options.md`.
- [TSK-20260531-player-web-published-plugin-bundle-handoff](docs/tasks/active/TSK-20260531-player-web-published-plugin-bundle-handoff.md) — implemented: ADR-039 production handoff now builds immutable published `player-web` plugin bundles, exposes them through `PlayerFacingContent.pluginBundles`, loads them in non-preview `player-web` mode, and removes the old static non-preview fallback for `Antarctica`.
- [TSK-20260518-workspace-project-references-cleanup](docs/tasks/active/TSK-20260518-workspace-project-references-cleanup.md) — решить статус `SDK/viewers/web-base`, `services/router`, `apps/portal-nextjs`, `services/portal-backend`.
- [TSK-20260518-runtime-repository-boundary-and-readiness](docs/tasks/active/TSK-20260518-runtime-repository-boundary-and-readiness.md) — сделать readiness честным и укрепить runtime repository boundary.
- [TSK-20260518-session-persistence-hardening](docs/tasks/active/TSK-20260518-session-persistence-hardening.md) — оформить и реализовать путь снятия долга по `InMemorySessionStore`.
- [TSK-20260518-contracts-neutrality-cleanup](docs/tasks/active/TSK-20260518-contracts-neutrality-cleanup.md) — очистить contracts layer от дрейфа под конкретные игры.

## Later

- Заменить local-file game repository adapter на конфигурируемую repository boundary.
- Очистить общие contracts от Antarctica-specific комментариев и примеров.
- Ввести TypeScript project references для рабочих пакетов.

## Blocked

- Нет известных внешних блокеров. Основной внутренний блокер: `runtime-api` и `player-web` сейчас не имеют полностью зеленых проверок.

## Canonical Context

- `games/antarctica/game.manifest.json` — источник истины для исполнимой логики Antarctica.
- `games/simple-choice/` — минимальная вторая игра для проверки game-agnostic runtime/player path.
- `games/antarctica/design/mockups/` — источник UI-намерения и экранных макетов.
- `services/runtime-api/` — канонический backend runtime в формате модульного монолита.
- `apps/player-web/` — канонический web delivery layer.
- `packages/contracts/*` — общий contracts layer.
- `draft/cubica-portal-nextjs/` — текущий portal draft для анализа и подготовки test VPS launch; не является source of truth для игровой логики.
- `draft/Antarctica/GameFull.html` — legacy extraction source на время миграции, не runtime source of truth.
