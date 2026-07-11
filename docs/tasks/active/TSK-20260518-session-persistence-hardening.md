# TSK-20260518-session-persistence-hardening: Session Persistence Hardening

## Status

review

## Why

`InMemorySessionStore` не сохраняет runtime sessions после рестарта процесса.

## Scope

Спроектировать и реализовать production-ready persistence path без изменения gameplay manifest semantics.

## Plan

1. [x] Сверить ADR-005 с текущим runtime-api.
2. [x] Реализовать PostgreSQL JSONB adapter и миграцию без второго источника истины.
3. [x] Закрыть все текущие пути мутации единой пессимистичной блокировкой.
4. [x] Добавить тесты транзакции, конкуренции, конфигурации и восстановления.
5. [x] Выполнить restart test на одноразовой реальной PostgreSQL-базе.

## Acceptance

Сессии имеют явный persistence strategy, а in-memory режим остается только dev/test adapter.

## Validation

```text
npm run typecheck --workspace @cubica/runtime-api
node --test --experimental-strip-types services/runtime-api/tests/postgres-session-store.test.ts
TEST_POSTGRES_DATABASE_URL=postgresql://... node --test --experimental-strip-types services/runtime-api/tests/postgres-session-store.integration.ts
```

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.

### 2026-07-11 — AI agent

- Добавлены PostgreSQL store, SQL-миграция с откатом, fail-fast конфигурация,
  реальная readiness-проверка и корректное закрытие пула.
- Детерминированные действия, ходы ИИ и restore предпросмотра выполняются под
  `withLockedSession`; PostgreSQL удерживает `FOR UPDATE NOWAIT` до `COMMIT`, а
  in-memory dev/test adapter повторяет управляемый конфликт блокировки.
- Unit-проверки не требуют базы; реальный restart test оставлен опциональным до
  предоставления одноразового PostgreSQL-контура.
- Прикладной TTL долгого хода и `session_events` не входят в этот bounded slice.
- После независимого review усилены инварианты: `state_version` всегда растёт
  ровно на единицу, restore перемещает только event cursor, rollback failure
  удаляет соединение из пула, readiness проверяет схему/режим записи/права, а
  операционные ошибки БД возвращаются клиенту как нейтральный HTTP 503.
- Реальная проверка на PostgreSQL 17 прошла в двух границах: store пережил
  пересоздание пула, а сессия, созданная и изменённая через HTTP, сохранила
  состояние и версию после полного перезапуска процесса runtime-api.
