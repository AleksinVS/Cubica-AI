# TSK-20260518-runtime-repository-boundary-and-readiness: Runtime Repository Boundary And Readiness

## Status

planned

## Why

`runtime-api` сейчас владеет player-facing content boundary, но readiness не проверяет фактическую загрузку content.

## Scope

Укрепить local-file repository boundary и сделать readiness честным для canonical game content.

## Plan

1. Описать текущую boundary в runtime-api docs.
2. Добавить content loading check в readiness.
3. Зафиксировать тесты для success/failure paths.

## Acceptance

Readiness отражает доступность runtime process и game content loading.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.
