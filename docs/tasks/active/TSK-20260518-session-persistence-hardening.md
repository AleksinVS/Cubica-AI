# TSK-20260518-session-persistence-hardening: Session Persistence Hardening

## Status

planned

## Why

`InMemorySessionStore` не сохраняет runtime sessions после рестарта процесса.

## Scope

Спроектировать и реализовать production-ready persistence path без изменения gameplay manifest semantics.

## Plan

1. Сверить ADR-005 с текущим runtime-api.
2. Выбрать ближайший persistence adapter.
3. Добавить тесты восстановления состояния.

## Acceptance

Сессии имеют явный persistence strategy, а in-memory режим остается только dev/test adapter.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.
