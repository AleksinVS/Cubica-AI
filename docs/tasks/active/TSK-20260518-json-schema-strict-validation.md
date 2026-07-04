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

done (2026-07-04) — все 7 Ajv-валидаторов переведены на `strict: true`
(с принципиальными послаблениями `allowUnionTypes: true` + `ajv-formats`).
Остаются две задокументированные ограниченные (bounded) exception:
`strictRequired: false` на валидаторах, компилирующих схемы с декларативными
идиомами (`anyOf`-of-`required`, `not`-`required`, условный `then.required`), и
императивная companion-проверка `templateId`. Обе описаны ниже и в LEGACY-0016.
`strict: false` больше не используется ни на одной из 7 площадок.

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

This inventory backs `LEGACY-0016`. Final state after the 2026-07-04 pass.

Target config applied everywhere:
`{ allErrors: true, strict: true, allowUnionTypes: true }` + `ajv-formats`.
`allowUnionTypes` and `ajv-formats` are **not** exceptions — they are principled
relaxations the canonical schemas legitimately require (union `type: [...]`
arrays such as ui-manifest `uiStyle.width`; standard `format` keywords like
`uri`/`date-time`). They keep strict mode enforcing the load-bearing checks:
unknown keywords, unknown formats, duplicate keys, `strictTypes`, `strictTuples`.

Per-site final state (all 7):

1. `services/runtime-api/src/modules/content/manifestValidation.ts`
   (game-manifest.schema.json) — `strict: true` + `strictRequired: false`
   (schema uses `anyOf`-of-`required` and `not`-`required` idioms). Also keeps
   the imperative `templateId` companion check (see below).
2. `services/runtime-api/src/modules/content/contentService.ts`
   (player-web-plugin-bundles.schema.json) — `strict: true` (no `strictRequired`
   relaxation needed; schema has no such idiom).
3. `packages/contracts/manifest/tests/manifests.test.ts`
   (game + ui manifest schemas) — `strict: true` + `strictRequired: false`
   (game-manifest idioms).
4. `packages/contracts/ai/src/index.ts` (inline AI/agent schemas) —
   `strict: true` + `strictRequired: false` (execution-mode-config conditional
   `then: {required:["agentRuntime"]}` idiom).
5. `packages/editor-engine/src/schema.ts` — `strict: true` +
   `strictRequired: false` (editor registers manifest/authoring schemas that use
   these idioms; callers may still override via `ajvOptions`).
6. `scripts/manifest-tools/build-player-web-plugin-bundles.cjs`
   (plugin + bundle schemas) — `strict: true` (no `strictRequired` relaxation
   needed).
7. `scripts/manifest-tools/authoring-compiler.cjs` (full authoring set +
   game/ui manifest) — `strict: true` + `strictRequired: false`
   (manifest-authoring-common `elementPrompt` conditional `then.required` and
   game-manifest idioms).

### Bounded exception A — `strictRequired: false` (sites 1, 3, 4, 5, 7)

- Reason: the canonical schemas use standard declarative JSON Schema idioms where
  a `required` keyword lives in a subschema that does not itself re-list the
  property under a local `properties`:
  - "at least one of" — `anyOf: [{required:["a"]}, {required:["b"]}, ...]`
    (game-manifest `timeline.set` effect);
  - "must be absent" — `not: {required:["card"]}` (game-manifest legacy guard
    removal);
  - conditional require — `if/then` with `then: {required:["x"]}` where `x` is
    defined at the parent level (manifest-authoring-common `elementPrompt`,
    AI execution-mode-config).
  In all cases the property is defined at the parent (or intentionally
  forbidden), so it cannot be listed locally.
- Risk: **low**. `strictRequired` is only an authoring-style lint; the `required`
  constraint is still fully enforced at runtime, so data validation is not
  weakened. All other strict checks stay on.
- Owner: Platform Team.
- Removal rule: drop `strictRequired: false` if/when these idiomatic subschemas
  are restructured to inline their `properties`, or if the idioms are removed.

### Bounded exception B — imperative `templateId` companion check

- Site: `services/runtime-api/src/modules/content/manifestValidation.ts`.
- Reason: the constraint "an action's `templateId` string must equal a *key* of
  the sibling `templates` object" is a cross-key existence check. JSON Schema has
  no clean, standard construct to assert that a string value matches a key of
  another object, so this stays as an imperative check **alongside** (never
  instead of) schema validation. It re-implements no schema shape check, so
  ADR-025 (JSON Schema as SSOT) still holds.
- Risk: **low**. Narrow, additive, well-commented.
- Owner: Platform Team.
- Removal rule: remove if a future schema dialect / custom Ajv keyword can express
  cross-key existence declaratively.

### strictTypes — fixed in schema (no exception)

`game-manifest.schema.json` originally tripped `strictTypes` on two conditional
`agentRuntime` subschemas (`allOf` `if`/`then`) that omitted `"type": "object"`.
These are genuinely object subschemas, so `"type": "object"` was added to both.
Contracts were regenerated (`npm run generate:contracts`); the generated
`game-manifest.ts` was unchanged and `verify:contracts-schema-parity` stays green.

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

### 2026-07-04 — Strict-mode conversion (AI agent)

- Converted all 7 `strict: false` validators to
  `strict: true, allowUnionTypes: true` + `ajv-formats` (sites 1–7 above).
- Fixed the only `strictTypes` finding in `game-manifest.schema.json` by adding
  `"type": "object"` to two conditional `agentRuntime` subschemas; regenerated
  contracts; `verify:contracts-schema-parity` green with no generated-code diff.
- The remaining strict findings were all `strictRequired` on legitimate
  declarative idioms (`anyOf`/`not`/conditional `then` required). Relaxed
  `strictRequired: false` only on the 5 validators that compile those schemas
  (sites 1, 3, 4, 5, 7), each with a WHY comment; documented as bounded
  exception A. Sites 2 and 6 stay fully strict.
- Kept the imperative `templateId` companion check with an explicit comment;
  documented as bounded exception B.
- Declared `ajv-formats@^3.0.1` in `packages/contracts/ai`,
  `packages/editor-engine`, and `packages/contracts/manifest` (dev) package.json.
- Validation results (all green): `verify:contracts-schema-parity` OK;
  `verify:contracts-manifest` 9/9; `verify:manifest-authoring` OK;
  `verify:contracts-ai` 33/33; `verify:editor-engine` 38/38;
  runtime-api typecheck OK + tests 127/127; `verify:game-agnostic` OK;
  `build-player-web-plugin-bundles --check` OK; `verify:legacy` unchanged
  (only the pre-existing baseline stub markers, none in touched files).
