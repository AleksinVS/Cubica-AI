# TSK-20260518-json-schema-strict-validation: JSON Schema Strict Validation

## Оглавление

- [Status](#status)
- [Why](#why)
- [Scope](#scope)
- [Current Exception Inventory](#current-exception-inventory)
- [Plan](#plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

planned

## Why

Ajv работает в нестрогом режиме, что ослабляет JSON Schema как single source
of truth.

JSON Schema is the declarative data contract for Cubica manifests and related
runtime contracts. Any imperative companion check or non-strict validator is
allowed only as a registered legacy exception with owner, risk and removal
plan.

## Scope

Перевести manifest validation и current contract validation к строгому режиму
Ajv без ручных TypeScript-проверок вместо схемы.

Отдельно покрыть текущую ручную cross-validation проверку `templateId` в `services/runtime-api/src/modules/content/manifestValidation.ts`: либо перенести проверку ссылок на `templates` в декларативную JSON Schema/validation layer, либо оформить bounded exception с причиной, владельцем и планом снятия.

## Current Exception Inventory

This inventory starts `LEGACY-0016`. Refresh it before implementation:

- `services/runtime-api/src/modules/content/manifestValidation.ts` uses
  `strict: false` and has a manual `templateId` cross-validation check.
- `services/runtime-api/src/modules/content/contentService.ts` uses
  `strict: false` for player web plugin bundle metadata.
- `packages/contracts/ai/src/index.ts` uses `strict: false` for AI contract
  validators.
- `scripts/manifest-tools/build-player-web-plugin-bundles.cjs` uses
  `strict: false` for generated plugin bundle metadata.
- Authoring/compiler/editor validators must be checked in the same pass so
  tool-side schema exceptions do not become hidden drift.

## Plan

1. Найти все причины `strict: false` and imperative companion checks on current
   contract surfaces.
2. Исправить схему и тесты.
3. Классифицировать ручную проверку `templateId`: перенести в schema-level validation или задокументировать исключение без нарушения JSON Schema как SSOT.
4. Для каждого оставшегося исключения обновить `docs/legacy/debt-log.csv` или
   удалить исключение.
5. Подтвердить `services/runtime-api`, contracts, authoring compiler and
   player plugin bundle checks.

## Acceptance

Manifest and current contract validation use strict Ajv mode where schemas are
the source of truth. Canonical checks pass. Any remaining `strict: false` or
imperative validation exception has an explicit legacy row, owner, risk and
removal rule.

## Validation

`npm run verify:canonical`

## Artifacts

- `docs/legacy/debt-log.csv`

## Handoff Log

### 2026-05-18 — AI agent

- Created as follow-up from `TSK-20260518-architecture-repair-and-task-system-migration`.

### 2026-06-13 - Architecture review follow-up

- Expanded scope from one manifest validator to all current JSON Schema
  contract surfaces found in review.
- Added `LEGACY-0016` so departures from ADR-025 are explicit until removed.
