# TSK-20260518-workspace-project-references-cleanup: Workspace Project References Cleanup

## Status

planned

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
