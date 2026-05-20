# TSK-20260518-json-schema-strict-validation: JSON Schema Strict Validation

## Status

planned

## Why

Ajv работает в нестрогом режиме, что ослабляет JSON Schema как single source of truth.

## Scope

Перевести manifest validation к строгому режиму Ajv без ручных TypeScript-проверок вместо схемы.

Отдельно покрыть текущую ручную cross-validation проверку `templateId` в `services/runtime-api/src/modules/content/manifestValidation.ts`: либо перенести проверку ссылок на `templates` в декларативную JSON Schema/validation layer, либо оформить bounded exception с причиной, владельцем и планом снятия.

## Plan

1. Найти причины `strict: false`.
2. Исправить схему и тесты.
3. Классифицировать ручную проверку `templateId`: перенести в schema-level validation или задокументировать исключение без нарушения JSON Schema как SSOT.
4. Подтвердить `services/runtime-api` checks.

## Acceptance

Manifest validation использует строгий Ajv-режим, canonical checks проходят, а `templateId` reference validation больше не выглядит как неучтенный императивный drift.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.
