# TSK-20260518-workspace-project-references-cleanup: Workspace Project References Cleanup

## Status

merged (2026-07-04) → TSK-20260630-codebase-cleanup-and-workspace-status

Классификация workspace/scaffold участков объединена с более новой и точной задачей
`TSK-20260630-codebase-cleanup-and-workspace-status` (LEGACY-0021/0022). Часть вопросов
(portal/router boundary) уже отвечена ADR-032/033. Оставшиеся пункты (`SDK/viewers/web-base`,
portal drafts, router scaffolds, TS project references) переносятся в задачу 0630.

## Why

Некоторые workspace/scaffold участки не имеют ясного статуса относительно canonical slice.

## Scope

Классифицировать `SDK/viewers/web-base`, portal drafts, router scaffolds and TypeScript project reference gaps.

## Plan

1. Сверить workspace entries с `PROJECT_STRUCTURE.yaml`.
2. Зафиксировать статус scaffold/active/archive.
3. Обновить docs, `.desc.json` и проверки.

## Acceptance

Каждый workspace/scaffold имеет явный статус и не создает architectural drift.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.
