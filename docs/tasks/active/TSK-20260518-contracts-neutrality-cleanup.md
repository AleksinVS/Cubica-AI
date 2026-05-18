# TSK-20260518-contracts-neutrality-cleanup: Contracts Neutrality Cleanup

## Status

planned

## Why

Общие contracts packages не должны выглядеть как Antarctica-specific implementation layer.

## Scope

Очистить комментарии, примеры и тестовые данные contracts packages от game-specific drift без потери Antarctica coverage.

## Plan

1. Найти Antarctica-specific mentions в `packages/contracts/*`.
2. Разделить generic examples и Antarctica fixtures.
3. Обновить tests/docs.

## Acceptance

Contracts layer остается game-neutral, а Antarctica examples живут как fixtures или docs examples.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.
