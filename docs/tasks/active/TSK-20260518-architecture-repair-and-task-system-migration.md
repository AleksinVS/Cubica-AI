# TSK-20260518-architecture-repair-and-task-system-migration: Architecture Repair and Task System Migration

## Status

review

## Why

Проект перешел к более простому canonical slice: `games/antarctica`, `services/runtime-api`, `apps/player-web` и `packages/contracts/*`. При этом архитектурное ревью от 2026-05-18 показало, что документация, проверки, workspace-граф и старая система задач расходятся с фактическим состоянием. Эта задача нужна, чтобы восстановить надежный вход для следующих агентов и разработчиков: одна текущая доска, один активный план, понятные проверки и явная передача артефактов.

## Scope

Входит в работу:

- восстановить зеленые проверки canonical slice;
- завершить миграцию системы задач на ADR-031;
- синхронизировать проектную документацию с новой системой планирования;
- исправить структурные разрывы в `PROJECT_STRUCTURE.yaml` и `.desc.json`;
- очистить корень репозитория от одноразовых debug-файлов, локальных логов и неописанных артефактов;
- обновить legacy-реестры и статус известных заглушек;
- подготовить следующие архитектурные hardening-задачи как отдельные TSK-файлы, если их нельзя безопасно закрыть в одном изменении.

Не входит в работу:

- полная реализация Game Repository как отдельного сервиса;
- полная замена `InMemorySessionStore` на PostgreSQL;
- массовая миграция исторического содержимого старых `milestones`, `epics`, `features`, `content-packs` в новый формат;
- удаление архивных документов, если они еще нужны для истории.
- удаление файлов с неясным владельцем без предварительной классификации и проверки Git-статуса.

## Plan

### Phase 1. Stabilize the canonical slice

1. Исправить `services/runtime-api` typecheck.
   Проверить ошибки по `json-logic-js`, тестовым типам `RuntimeManifestActionDefinition` и форме `JsonLogicExpression`.

2. Исправить 17 падающих тестов `services/runtime-api`.
   Начать с первого сломанного перехода `opening.card.3.advance` vs `opening.info.i7.advance`. Проверить согласованность `games/antarctica/game.manifest.json`, action templates и `services/runtime-api/src/modules/runtime/deterministicHandlers.ts`.

3. Исправить 4 падающих теста `apps/player-web`.
   Начать с `apps/player-web/src/components/panels/journal-renderer.test.tsx` и проверки того, почему journal renderer получает пустое состояние вместо карточных записей.

4. После исправлений выполнить:
   - `npm run typecheck --workspace services/runtime-api`;
   - `npm test --workspace services/runtime-api`;
   - `npm run typecheck --workspace @cubica/player-web`;
   - `npm test --workspace @cubica/player-web`;
   - `npm run verify:canonical`.

### Phase 2. Finish task-system migration

1. Убедиться, что старые каталоги перенесены:
   - `docs/tasks/archive/milestones/`;
   - `docs/tasks/archive/epics/`;
   - `docs/tasks/archive/features/`;
   - `docs/tasks/archive/content-packs/`.

2. Поддерживать новую структуру:
   - `docs/tasks/active/`;
   - `docs/tasks/artifacts/`;
   - `docs/tasks/archive/`;
   - `docs/tasks/README.md`;
   - `NEXT_STEPS.md`.

3. Обновить все прямые ссылки на старые пути в активной документации.
   Архивные файлы могут сохранять старые ссылки, если они нужны только как исторический контекст.

4. Перегенерировать `PROJECT_STRUCTURE.yaml` через:
   - `node scripts/dev/generate-structure.js`.

### Phase 3. Align project documentation

1. Обновить `README.md`.
   Он должен ссылаться на `PROJECT_STRUCTURE.yaml`, `NEXT_STEPS.md` и `docs/tasks/README.md`, а не на старую `ROADMAP.md` как текущую доску.

2. Обновить `docs/architecture/README.md`.
   Требование синхронизации должно ссылаться на `NEXT_STEPS.md` и активные TSK-файлы.

3. Обновить `docs/architecture/PROJECT_ARCHITECTURE.md`.
   Раздел связи с задачами должен описывать новую систему, а старую иерархию — как архив.

4. Обновить `PROJECT_OVERVIEW.md`, если там есть активные указания на старую систему задач.

5. Обновить `AGENTS.md`, если он указывает на старый content-pack каталог как активный путь.

### Phase 4. Register and prioritize architecture debt

1. Обновить `docs/legacy/debt-log.csv` и `docs/legacy/stubs-register.md`.
   Минимально отразить:
   - красные canonical checks;
   - `InMemorySessionStore` как runtime persistence debt;
   - readiness, который не проверяет фактическую загрузку content;
   - статус `SDK/viewers/web-base` как scaffold или active package;
   - статус `services/router` как scaffold/contracts-only.

2. Создать отдельные TSK-файлы, если исправление не помещается в эту задачу:
   - JSON Schema strict validation;
   - workspace/project references cleanup;
   - runtime repository boundary;
   - session persistence;
   - contracts neutrality cleanup.

### Phase 5. Root repository hygiene

Корень репозитория должен оставаться навигационным входом, а не рабочей свалкой. После текущего осмотра корня видны такие группы:

1. **Canonical root files. Keep in root.**
   - `AGENTS.md`;
   - `README.md`;
   - `PROJECT_OVERVIEW.md`;
   - `PROJECT_STRUCTURE.yaml`;
   - `NEXT_STEPS.md`;
   - `package.json`;
   - `package-lock.json`;
   - `.gitignore`;
   - `.env.example`;
   - `.desc.json`.

2. **Potentially valid tool/agent files. Classify, then keep or move.**
   - `CLAUDE.md`;
   - `.claude/`;
   - `.codex/`;
   - `.cursor/`;
   - `.gemini/`;
   - `.geminiignore`;
   - `PROJECT_WORKFLOW_CONFIG.json`;
   - `.gitmodules`.

   Decision rule: keep only if the file is a supported tool entry point and is documented in root README or `.desc.json`. Otherwise move to `archive/` or a tool-specific docs/process location.

3. **One-off debug scripts. Move out of root or delete.**
   - `capture-target-journal.mjs`;
   - `check-client-delta.cjs`;
   - `check-detailed-styles.cjs`;
   - `check-draft-ui.mjs`;
   - `check-html-structure.cjs`;
   - `check-journal-styles.mjs`;
   - `check-log-persistence.cjs`;
   - `check-pixelmatch.cjs`;
   - `check-styles.cjs`;
   - `check-topbar.cjs`;
   - `final-compare.cjs`;
   - `test-info-log.cjs`;
   - `test-merge-patch.cjs`;
   - `visual-diff-journal.mjs`.

   Decision rule: if reusable, move to `scripts/debug/` or `scripts/antarctica/` with a README and package script if needed. If one-off and superseded, move to `.tmp/` during investigation and delete before completion. Do not leave executable debug files in repo root.

4. **Generated/local artifacts. Delete or ensure ignored.**
   - `.next/`;
   - `node_modules/`;
   - `.playwright-mcp/`;
   - `.tmp/`;
   - `test-results/`;
   - `droid_worker.log`.

   Decision rule: these should not be tracked and should not appear in root as untracked review noise. If a generated artifact is useful, move the durable result to `docs/tasks/artifacts/<TASK-ID>/`; otherwise delete it locally or add a narrowly scoped `.gitignore` rule.

5. **Unclear root documents. Decide owner and location.**
   - `BACKLOG.md`;
   - root-level ad hoc notes not linked from `README.md`, `NEXT_STEPS.md`, or `docs/tasks/README.md`.

   Decision rule: active planning goes to `NEXT_STEPS.md` or `docs/tasks/active/`; strategic planning goes to `docs/tasks/STRATEGY.md`; historical notes go to `archive/` or `docs/tasks/archive/`.

Required steps:

1. Create a root hygiene inventory in this task's `Handoff Log` or in `docs/tasks/artifacts/TSK-20260518-architecture-repair-and-task-system-migration/root-hygiene-inventory.md` if the inventory becomes longer than one screen.
2. Move reusable debug scripts under `scripts/` with a short README, or delete them if they are one-off artifacts.
3. Move durable outputs to `docs/tasks/artifacts/<TASK-ID>/`.
4. Remove empty local logs such as `droid_worker.log` if untracked and not needed.
5. Add or tighten `.gitignore` only for generated/local artifacts, not for source files that should be deliberately moved or deleted.
6. Update root `.desc.json`, `README.md`, and `PROJECT_STRUCTURE.yaml` after any structural change.

### Phase 6. Close the loop

1. Обновить `Handoff Log`.
2. Убедиться, что постоянные артефакты перечислены в `Artifacts`.
3. Очистить временные файлы в `.tmp/`, созданные в рамках задачи.
4. Перевести статус задачи в `review` или `done`.

## Acceptance

- `NEXT_STEPS.md` является короткой текущей доской проекта.
- `docs/tasks/README.md` описывает ADR-031 и новую систему задач.
- Старые `milestones`, `epics`, `features`, `content-packs` находятся в `docs/tasks/archive/`.
- `PROJECT_STRUCTURE.yaml` отражает новую структуру `docs/tasks`.
- Корень репозитория содержит только documented root entry points, supported tool configs, package metadata and top-level domain directories.
- Одноразовые debug scripts из корня удалены, перенесены в `.tmp/`, либо оформлены как поддерживаемые scripts под `scripts/`.
- Generated/local artifacts (`.next/`, `node_modules/`, `test-results/`, local logs) не создают untracked noise в корне.
- В активной документации нет указаний создавать новую работу в старых `milestones`, `epics`, `features`, `content-packs`.
- `npm run verify:canonical` проходит или в `Handoff Log` зафиксированы конкретные оставшиеся падения, владельцы и следующий безопасный шаг.
- Все постоянные артефакты задачи перечислены в `Artifacts`.

## Validation

Основные команды:

```text
npm run typecheck --workspace services/runtime-api
npm test --workspace services/runtime-api
npm run typecheck --workspace @cubica/player-web
npm test --workspace @cubica/player-web
npm run verify:canonical
node scripts/dev/generate-structure.js
rg -n "<old task paths or old project-structure markdown reference>" README.md PROJECT_OVERVIEW.md NEXT_STEPS.md docs/architecture docs/tasks AGENTS.md
find . -maxdepth 1 -type f -printf '%f\n' | sort
git status --short
```

Ожидаемый результат после завершения:

- проверки canonical slice проходят;
- поиск по старым активным task-путям не находит их в текущих документах, кроме архивных или явно исторических упоминаний;
- `PROJECT_STRUCTURE.yaml` обновлен генератором.
- корень не содержит одноразовых debug scripts и локальных логов.

## Artifacts

- `docs/reviews/2026-05-18-architecture-review.md` — архитектурное ревью и список найденных разрывов.
- `docs/architecture/adrs/031-lightweight-task-plan-and-handoff-system.md` — принятое решение по новой системе задач, планов и передачи.
- `docs/tasks/active/TSK-20260518-architecture-repair-and-task-system-migration.md` — этот рабочий план.
- `docs/tasks/artifacts/TSK-20260518-architecture-repair-and-task-system-migration/root-hygiene-inventory.md` — inventory корневой гигиены.
- `docs/tasks/active/TSK-20260518-json-schema-strict-validation.md` — follow-up по строгой JSON Schema validation.
- `docs/tasks/active/TSK-20260518-workspace-project-references-cleanup.md` — follow-up по workspace/project references cleanup.
- `docs/tasks/active/TSK-20260518-runtime-repository-boundary-and-readiness.md` — follow-up по runtime repository boundary и readiness.
- `docs/tasks/active/TSK-20260518-session-persistence-hardening.md` — follow-up по session persistence.
- `docs/tasks/active/TSK-20260518-contracts-neutrality-cleanup.md` — follow-up по neutrality cleanup в contracts.

## Handoff Log

### 2026-05-18 — AI agent

- Changed:
  - moved old task directories to `docs/tasks/archive/`;
  - added `docs/tasks/active/`, `docs/tasks/artifacts/`, `docs/tasks/archive/`;
  - updated `docs/tasks/.desc.json`;
  - added `.desc.json` files for new task directories;
  - moved old task README to `docs/tasks/archive/README-legacy-task-system.md`;
  - created new `docs/tasks/README.md`;
  - accepted ADR-031;
  - rewrote `NEXT_STEPS.md` as the current board;
  - created this active TSK plan;
  - updated `README.md`, `docs/architecture/README.md`, `docs/architecture/PROJECT_ARCHITECTURE.md`, and `AGENTS.md` to point at the new planning system;
  - regenerated `PROJECT_STRUCTURE.yaml`;
  - added `docs/tasks/STRATEGY.md` as the strategic planning layer and linked it from `README.md`, `NEXT_STEPS.md`, and `docs/tasks/README.md`.
  - inspected repository root and found one-off debug scripts, local artifacts, and unclear root documents that need root hygiene cleanup.
- Validation so far:
  - `node scripts/dev/generate-structure.js` passed after adding `STRATEGY.md`.
  - stale-link search over active documentation returned no active references to old task directories or the old project-structure markdown filename.
  - Previous review run found `services/runtime-api` typecheck failing.
  - Previous review run found `services/runtime-api` tests failing: 54/71 passed.
  - Previous review run found `@cubica/player-web` typecheck passing.
  - Previous review run found `@cubica/player-web` tests failing: 93/97 passed.
- Remaining:
  - classify and clean root-level noise: `check-*.cjs`, `visual-diff-journal.mjs`, `capture-target-journal.mjs`, `final-compare.cjs`, `test-*.cjs`, `droid_worker.log`, `test-results/`, `BACKLOG.md`, and tool config files with unclear ownership;
  - fix canonical slice failures;
  - update legacy debt/stub registers;
  - rerun validation commands.
- Next safe step:
  - decide whether to do root hygiene before canonical test fixes. If yes, start by moving reusable debug scripts under `scripts/debug/` or deleting one-off untracked files after confirming they are not referenced.
- Risks:
  - working tree was already dirty before this task; avoid reverting unrelated user changes.

### 2026-05-18 — AI agent

- Changed:
  - fixed `services/runtime-api` typecheck by adding a local `json-logic-js` declaration, updating JsonLogic tests, and aligning `JsonLogicExpression` in contracts/schema with standard `{ "var": "path" }` expressions;
  - fixed deterministic template merge so direct `deterministic` metadata and `overrides.deterministic` are merged instead of dropping one side;
  - kept runtime `public.log` as an audit trail and left player-facing journal filtering to `apps/player-web`;
  - restored Antarctica step-32 card-history timing in `games/antarctica/game.manifest.json`;
  - fixed `apps/player-web` journal filtering so card entries render when they carry card text, while system/runtime entries remain hidden;
  - moved root debug scripts to `scripts/debug/`, moved `BACKLOG.md` to `docs/tasks/archive/BACKLOG.md`, removed local `droid_worker.log` and `test-results/`;
  - added root hygiene inventory and follow-up TSK files for hardening work;
  - updated `docs/legacy/debt-log.csv`, `docs/legacy/stubs-register.md`, `README.md`, `.desc.json`, `.gitignore`, and `PROJECT_STRUCTURE.yaml`.
- Validation:
  - `npm run typecheck --workspace services/runtime-api` passed;
  - `npm test --workspace services/runtime-api` passed: 71/71;
  - `npm run typecheck --workspace @cubica/player-web` passed;
  - `npm test --workspace @cubica/player-web` passed: 97/97;
  - `npm run verify:canonical` passed;
  - `node scripts/dev/generate-structure.js` passed.
- Remaining:
  - review and accept this task;
  - follow up through the new TSK files listed in `NEXT_STEPS.md`.
- Risks:
  - working tree contains many pre-existing unrelated changes; this task worked with them and did not revert them.
