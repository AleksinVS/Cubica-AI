# TSK-20260605-editor-session-versioning-and-gc: Editor Session Versioning And Cleanup

## Оглавление

- [Status](#status)
- [Implementation Summary](#implementation-summary)
- [Understanding](#understanding)
- [Why](#why)
- [Architecture Baseline](#architecture-baseline)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

implemented-baseline

## Implementation Summary

Implemented on 2026-06-05:

- `EditorSessionDocument` v2 stores `schemaVersion`, `userId`, `projectId`, `platformReleaseId`, `pluginApiVersion`, lifecycle status, timestamps, TTL and dirty summary.
- `POST /api/editor/session` reuses a compatible active session by default and accepts `forceNew` for an intentional second draft.
- `GET /api/editor/session` lists session summaries.
- File, layout, compile and preview paths touch session metadata and refresh dirty state from `git status`.
- Save commits mark the session clean/saved.
- Preview returns `upgrade required` diagnostics before plugin validation when session platform/plugin API metadata is incompatible with the current local release descriptor.
- `POST /api/editor/session/upgrade` returns a dry-run upgrade plan without mutating the worktree.
- `POST /api/editor/session/gc` supports dry-run/apply cleanup for expired/orphaned sessions, linked worktrees, old preview traces and old generated preview plugin bundles.
- `git worktree remove --force` and `git worktree prune` are used through project Git helpers.

Not yet implemented:

- browser UI controls for choosing `forceNew`, listing sessions, running upgrade and showing GC output;
- production durable metadata storage and scheduled cleanup job;
- full apply-mode upgrade that runs migrations, compile, plugin validation and preview readiness before switching metadata.

## Understanding

Задача понята так: после миграции `Antarctica` на новую plugin system preview в редакторе сломался из-за несовместимости старой editor worktree-сессии с текущим `player-web` plugin API. Дополнительно обнаружено накопление десятков editor worktrees, что показывает отсутствие нормального жизненного цикла сессий.

Нужно внедрить две связанные возможности:

1. открытые editor-сессии должны быть привязаны к версии платформы и безопасно переживать деплой или требовать явный upgrade;
2. editor-сессии должны управляться как ресурс: reuse, status, touch, close, TTL, garbage collection and diagnostics.

## Why

Без этой работы:

- обновление platform API can break existing preview sessions;
- авторы могут потерять рабочий контекст или увидеть непонятный plugin-validation error;
- `.tmp/editor-worktrees` and `.tmp/editor-sessions` grow without limits;
- runtime-api keeps content-source registrations for obsolete sessions until process restart;
- local behavior does not model production session lifecycle.

Expected result:

- repeated editor opens reuse a compatible active session instead of creating duplicates;
- session metadata records platform/plugin API version and lifecycle state;
- preview reports `upgrade required` when platform release mismatch is unsafe;
- old clean sessions are cleaned automatically;
- dirty sessions are protected by policy and visible diagnostics;
- operators and developers have explicit cleanup tools.

## Architecture Baseline

This task implements ADR-042.

Related architecture:

- ADR-030: authoring manifests compile into runtime manifests.
- ADR-036: preview-first editor and Project Git Workspace.
- ADR-037: project-local plugins.
- ADR-039: player-web plugin bundle handoff.
- ADR-041: object-state migration, which exposed old plugin API compatibility risk.

Terminology:

- Worktree - separate Git working copy for an editor session.
- Garbage collection - cleanup process that removes expired or orphaned session resources.
- Platform release - immutable platform version used by preview, validation and plugin API.

## Scope

In scope:

- add session metadata fields for platform release, plugin API version, status, timestamps and dirty summary;
- add active-session reuse for the same user/project/game/platform release;
- add lifecycle endpoints or route behavior for list, touch, close, upgrade planning and garbage collection;
- add local cleanup job or script for `.tmp/editor-worktrees`, `.tmp/editor-sessions`, `.tmp/editor-plugin-bundles` and `.tmp/editor-playthroughs`;
- add preview diagnostics for incompatible session/platform version;
- add plugin API compatibility policy tests so same-major exports are not removed silently;
- document production behavior for durable metadata, release pinning and scheduled cleanup.

Out of scope:

- full multi-user collaboration;
- remote Git hosting integration;
- marketplace plugin sandbox implementation;
- deleting historical `editor/session/*` branches without a separate retention decision;
- changing production player launch sessions.

## Non-Goals

- Do not make runtime/player production mode load editor worktree code.
- Do not replace Project Git Workspace with direct writes to the main checkout.
- Do not store editor session state inside runtime manifests.
- Do not use ADR as the execution tracker after this TSK exists.

## Execution Plan

### Phase 1. Inventory And Metadata Contract

1. Audit current `apps/editor-web/src/lib/editor-session-store.ts` and `project-git-workspace.ts`.
2. Define `EditorSessionDocument` v2 with:
   - `schemaVersion`;
   - `userId`;
   - `projectId` or normalized project root;
   - `platformReleaseId`;
   - `pluginApiVersion`;
   - `status`;
   - `createdAt`, `lastUsedAt`, `expiresAt`;
   - dirty summary.
3. Add backward-compatible read support for existing metadata.
4. Add unit tests for metadata normalization and old-document migration.

### Phase 2. Session Reuse And Duplicate Control

1. Update session creation so it searches for an active compatible session before creating a new worktree.
2. Add explicit `forceNew` or `newDraft` option for intentional duplicate sessions.
3. Add list endpoint returning active/idle/dirty session summaries.
4. Add UI indicator for resumed session versus new session.
5. Add tests for repeated opens returning the same session.

### Phase 3. Touch, Close And Dirty State

1. Update file, layout, validate, compile, preview and save routes to touch `lastUsedAt`.
2. Detect dirty state through Git status in the session worktree.
3. Mark saved sessions clean after Save commit.
4. Make close idempotent: missing metadata/worktree should return structured success or clear diagnostic, not leave mixed state.
5. Add focused tests for touch and close.

### Phase 4. Platform Release Pinning

1. Add a platform release descriptor for local development.
2. Store `platformReleaseId` and `pluginApiVersion` when creating sessions.
3. Add preview validation:
   - same release: proceed;
   - compatible older release available: proceed through release resolver;
   - incompatible or unavailable release: return `upgrade required` diagnostic.
4. Add plugin API same-major compatibility tests for public facade exports.
5. Keep legacy exports such as `readCardFlags` until the old major version is formally retired.

### Phase 5. Session Upgrade

1. Add `POST /api/editor/session/:id/upgrade` or equivalent route.
2. Implement dry-run upgrade:
   - read current session;
   - compute target platform release;
   - run manifest migrations if needed;
   - run compile, plugin validation and preview readiness.
3. Commit upgrade changes only after validation succeeds.
4. Return clear diagnostics and leave the old session untouched on failure.
5. Add UI action and tests for upgrade-required flow.

### Phase 6. Garbage Collection

1. Define retention policy:
   - clean idle sessions;
   - dirty idle sessions;
   - closed sessions;
   - orphaned metadata;
   - orphaned worktrees;
   - old plugin bundles;
   - old preview traces.
2. Add GC implementation that uses `git worktree remove --force` and then `git worktree prune`.
3. Add dry-run mode for operators and tests.
4. Add summary output: removed, skipped dirty, orphaned, failed.
5. Add optional scheduled local command and production job notes.

### Phase 7. Production Readiness Documentation

1. Document durable metadata storage expectations.
2. Document release retention window.
3. Document operator actions for cleanup and upgrade failure.
4. Add metrics and audit log expectations.
5. Update `docs/architecture/PROJECT_ARCHITECTURE.md` and `NEXT_STEPS.md`.

## Acceptance

1. Opening the same game twice reuses an active compatible session by default.
2. The user can explicitly create a second draft session.
3. Session metadata records platform release and plugin API version.
4. Preview does not silently validate old session plugin code against an incompatible current API.
5. `Upgrade session` dry-run reports validation diagnostics without destroying the old session.
6. Garbage collection removes expired clean sessions and orphaned worktrees.
7. Dirty sessions are not removed without explicit policy.
8. Cleanup runs `git worktree prune` after worktree removal.
9. Public `PlayerPluginApi` same-major compatibility is covered by tests.
10. Documentation explains local and production lifecycle behavior.

## Validation

Planned validation commands:

```bash
npm run typecheck --workspace @cubica/editor-web
npm test --workspace @cubica/editor-web
npm run typecheck --workspace @cubica/player-web
npm test --workspace @cubica/player-web
npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts
git diff --check
```

Manual checks:

- Open editor twice for `Antarctica`; verify one active session is reused.
- Create explicit new draft; verify a second session appears.
- Simulate old `pluginApiVersion`; verify preview returns `upgrade required`.
- Run GC dry-run; verify expected sessions are selected.
- Run GC apply; verify worktrees and metadata are removed and main worktree remains.

## Artifacts

- `docs/architecture/adrs/042-editor-session-versioning-and-lifecycle.md` - architecture decision.
- `docs/tasks/active/TSK-20260605-editor-session-versioning-and-gc.md` - execution plan and handoff.
- Future implementation may add a GC report under `docs/tasks/artifacts/TSK-20260605-editor-session-versioning-and-gc/`.

## Handoff Log

### 2026-06-05 — Codex

- Changed:
  - `docs/architecture/adrs/042-editor-session-versioning-and-lifecycle.md`
  - `docs/tasks/active/TSK-20260605-editor-session-versioning-and-gc.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `NEXT_STEPS.md`
- Validation:
  - documentation-only change; no code tests run for this handoff.
- Done:
  - documented the architecture direction for versioned editor sessions and controlled cleanup;
  - created execution plan with phases, acceptance and validation.
- Remaining:
  - implement metadata v2, session reuse, platform release pinning, upgrade flow and GC.
- Next:
  - start Phase 1 inventory and metadata contract in `apps/editor-web/src/lib/editor-session-store.ts`.
- Risks:
  - old local session branches remain after worktree cleanup unless a separate branch retention policy is accepted.

### 2026-06-05 — Codex Implementation

- Changed:
  - `apps/editor-web/src/lib/project-git-workspace.ts`
  - `apps/editor-web/src/lib/editor-session-store.ts`
  - `apps/editor-web/app/api/editor/session/route.ts`
  - `apps/editor-web/app/api/editor/session/upgrade/route.ts`
  - `apps/editor-web/app/api/editor/session/gc/route.ts`
  - `apps/editor-web/app/api/editor/file/route.ts`
  - `apps/editor-web/app/api/editor/layout/route.ts`
  - `apps/editor-web/app/api/editor/compile/route.ts`
  - `apps/editor-web/app/api/editor/preview/route.ts`
  - `apps/editor-web/src/lib/editor-session-store.test.ts`
  - `apps/editor-web/src/lib/project-git-workspace.test.ts`
  - `apps/player-web/src/components/game-player.test.tsx`
  - `docs/architecture/adrs/042-editor-session-versioning-and-lifecycle.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `NEXT_STEPS.md`
- Validation:
  - `npm run typecheck --workspace @cubica/editor-web`
  - `npm test --workspace @cubica/editor-web`
  - `npm run typecheck --workspace @cubica/player-web`
  - `npm test --workspace @cubica/player-web -- game-player`
- Done:
  - implemented local ADR-042 baseline for session version metadata, duplicate control, touch/dirty state, idempotent close, upgrade dry-run and garbage collection;
  - added regression tests for editor session lifecycle.
- Remaining:
  - add browser UI controls for session list/new draft/upgrade;
  - implement production durable session metadata and scheduled cleanup;
  - implement safe apply-mode upgrade after compile/plugin validation/preview readiness.
- Risks:
  - local GC still leaves historical `editor/session/*` branches by policy; deleting branches needs a separate retention decision.
