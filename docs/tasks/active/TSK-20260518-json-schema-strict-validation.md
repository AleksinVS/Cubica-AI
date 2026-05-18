# TSK-20260518-json-schema-strict-validation: JSON Schema Strict Validation

## Status

planned

## Why

Ajv работает в нестрогом режиме, что ослабляет JSON Schema как single source of truth.

## Scope

Перевести manifest validation к строгому режиму Ajv без ручных TypeScript-проверок вместо схемы.

## Plan

1. Найти причины `strict: false`.
2. Исправить схему и тесты.
3. Подтвердить `services/runtime-api` checks.

## Acceptance

Manifest validation использует строгий Ajv-режим, canonical checks проходят.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.
