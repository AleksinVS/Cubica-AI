# TSK-20260616-antarctica-game-authoring-prototype-migration: Antarctica Game Authoring Prototype Migration

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Context](#context)
- [Action Templates Vs Authoring Prototypes](#action-templates-vs-authoring-prototypes)
- [Baseline Audit](#baseline-audit)
- [Target Prototype Set](#target-prototype-set)
- [Migration Plan](#migration-plan)
- [Validation](#validation)
- [Acceptance](#acceptance)
- [Risks And Controls](#risks-and-controls)
- [Handoff Log](#handoff-log)

## Status

implemented

## Understanding

Задача понята так: нужно безопасно перевести `games/antarctica/authoring/game.authoring.json` с текущего authoring v2 состояния, где `_type` используется в основном как семантическая метка, на явные локальные game-level prototypes в `_definitions`. Миграция не должна менять generated runtime manifest, source map смысл, runtime action templates или поведение `runtime-api`/`player-web`.

Это исполнительная документация, а не новое архитектурное решение. Архитектурный источник истины: ADR-050, ADR-048, ADR-049 и `docs/architecture/PROJECT_ARCHITECTURE.md`.

## Context

Текущий файл:

- source: `games/antarctica/authoring/game.authoring.json`;
- schema: `docs/architecture/schemas/game-authoring-v2.schema.json`;
- `_definitions`: пустой объект;
- typed authoring nodes: 296;
- existing local prototypes: 0;
- deterministic prototype candidates from audit: 154.

Authoring v2 compiler currently permits unresolved `_type` values. This keeps existing semantic types such as `game.Action`, `game.Card`, `game.Info`, `game.Board` and `game.Step` valid even when `_definitions` is empty. Prototype migration must therefore introduce new local `_type` names gradually and verify zero runtime diff after each batch.

## Action Templates Vs Authoring Prototypes

**Action template** - runtime-facing action pattern under `root.logic.templates`. It is compiled into runtime manifest logic and executed by runtime as part of deterministic gameplay. Existing Antarctica templates:

| Template | Uses | Purpose |
| --- | ---: | --- |
| `opening-card-resolution` | 71 | Resolve selected card, add metrics, log result. |
| `opening-card-advance` | 30 | Advance from resolved card to next info/timeline step. |
| `opening-info-advance` | 27 | Advance from info block to next info/timeline step. |
| `opening-team-selection` | 10 | Select one team member and update metrics/team state. |

**Authoring prototype** - authoring-only reusable definition under `_definitions`. It is resolved by `authoring-compiler.cjs`, stripped from generated runtime output, and exists to reduce authoring duplication and improve editor/agent guidance.

They do not duplicate each other when used correctly:

- action templates own runtime behavior shape: `templateId`, `params`, deterministic guard/effects contract;
- authoring prototypes own editable JSON defaults and authoring intent: repeated labels, common fields, `_semantics`, `_promptTemplate`, and optional defaults for nested objects;
- an authoring prototype may produce an action that still uses a runtime `templateId`;
- an action template must not replace `_definitions`, `_promptTemplate`, editor semantics or prototype promotion governance;
- an authoring prototype must not introduce a second runtime action model.

## Baseline Audit

Commands used for the baseline:

```bash
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --mode deterministic \
  --scope file \
  --file games/antarctica/authoring/game.authoring.json \
  --format json
```

Observed summary:

- `filesScanned`: 1;
- `localPrototypes`: 0;
- `deterministicCandidates`: 154;
- `semanticCandidates`: 0;
- `promotionCandidates`: 0.

High-volume repeated shapes:

| Candidate | Count | Recommended handling |
| --- | ---: | --- |
| `metric.add` effect shape | 214 | Keep as later nested prototype candidate; do not migrate first because readability can suffer. |
| object guard for card idle/resolved facets | 98 | Later nested prototype candidate after action-level prototypes are stable. |
| `opening-card-resolution` log append effect | 71 | Later nested prototype candidate tied to card-resolution action prototype. |
| initial public card object state | 71 | Good early prototype candidate. |
| `game.Card` content shape | 71 | Good early prototype candidate. |
| `game.Info` content shape | 26 | Good early prototype candidate. |
| `game.Step` flow shape | 26 | Good early prototype candidate. |
| `game.Board` content shape | 13 | Good early prototype candidate. |
| team member content entity | 10 | Good early prototype candidate after cards/info/steps. |

## Target Prototype Set

### Phase 1: Content Prototypes

Create these game-level prototypes first because they affect authoring duplication but do not alter runtime mechanics:

| Prototype `_type` | Extends | Applies to | Common fields |
| --- | --- | --- | --- |
| `game.AntarcticaInfoBlock` | `game.Info` | `/root/content/data/infos/*` except terminal label override review | `screenId: "S1"`, common `_semantics`, `_promptTemplate`; optionally `advanceLabel: "Продолжить"` only for non-terminal infos. |
| `game.AntarcticaOpeningCard` | `game.Card` | `/root/content/data/cards/*` | `selectLabel: "Выбрать"`, common `_semantics`, `_promptTemplate`. |
| `game.AntarcticaBoard` | `game.Board` | `/root/content/data/boards/*` | `screenId: "S2"`, common `_semantics`, `_promptTemplate`. |
| `game.AntarcticaLinearInfoStep` | `game.Step` | `/root/logic/flows/0/steps/*` | `screenId: "S1"`, common `_semantics`, `_promptTemplate`. |
| `game.AntarcticaTeamMember` | `game.ContentEntity` | `/root/content/data/teamSelections/0/members/*` | `selectLabel: "Выбрать"`, common `_semantics`, `_promptTemplate`. |

Important: arrays are not merged by the current compiler. Do not move `cardIds`, `actionIds`, `tags` or `effects` into definitions unless every instance should receive exactly the same array.

### Phase 2: Object-State Prototypes

Create two prototypes for initial card object state because most cards start visible, while a small locked/alternate set starts hidden:

| Prototype `_type` | Applies to | Common fields |
| --- | --- | --- |
| `game.AntarcticaAvailableCardState` | visible initial card objects | `objectType: "antarctica.card"`, facets `selection: "idle"`, `resolution: "idle"`, `availability: "available"`, `face: "front"`, `attributes: {}`. |
| `game.AntarcticaHiddenCardState` | hidden initial card objects | `objectType: "antarctica.card"`, facets `selection: "idle"`, `resolution: "idle"`, `availability: "hidden"`, `face: "front"`, `attributes: {}`. |

These are game-specific and must remain local. They must not become platform-level because they name `antarctica.card`.

### Phase 3: Action Prototypes

Introduce action-level prototypes only after Phase 1 and Phase 2 compile with zero runtime diff:

| Prototype `_type` | Extends | Applies to | Common fields |
| --- | --- | --- | --- |
| `game.AntarcticaOpeningCardResolutionAction` | `game.Action` | 71 actions with `templateId: "opening-card-resolution"` | `templateId`, `capabilityFamily`, `capability`, common `_promptTemplate`. |
| `game.AntarcticaOpeningCardAdvanceAction` | `game.Action` | 30 actions with `templateId: "opening-card-advance"` | `templateId`, `capabilityFamily`, `capability`, common `_promptTemplate`. |
| `game.AntarcticaOpeningInfoAdvanceAction` | `game.Action` | 27 actions with `templateId: "opening-info-advance"` | `templateId`, `capabilityFamily`, `capability`, common `_promptTemplate`. |
| `game.AntarcticaOpeningTeamSelectionAction` | `game.Action` | 10 actions with `templateId: "opening-team-selection"` | `templateId`, `capabilityFamily`, `capability`, common `_promptTemplate`. |

Do not move `tags` in the first action-prototype pass. Antarctica action tags contain slice-specific markers such as `line-switch`, `trusted-messengers`, `relocation-aftermath` and others; moving common arrays would either change output or hide important authoring context.
Do not remove `handlerType` from action instances until `game-authoring-v2.schema.json` changes, because the current schema requires `handlerType` directly on every action before prototype resolution.

### Phase 4: Nested Guard And Effect Prototypes

Consider nested prototypes only after action prototypes are accepted:

| Prototype `_type` | Applies to | Notes |
| --- | --- | --- |
| `game.AntarcticaMetricDeltaEffect` | `metric.add` effects | Good structural candidate, but high count can reduce readability if every metric effect becomes an inherited object. |
| `game.AntarcticaCardIdleGuard` | object guards with `selection: "idle"`, `resolution: "idle"` | Useful if editor UI can display inherited guard fields clearly. |
| `game.AntarcticaCardResolvedGuard` | object guards with `selection: "selected"`, `resolution: "resolved"` | Tie to card advance actions. |
| `game.AntarcticaOpeningLogEffect` | `log.append` effects for opening actions | Keep game-specific. It names Antarctica stages and local log kinds. |

Nested prototypes are optional for the first migration. The implemented slice stops after Phase 3 because the remaining high-volume candidates are nested effects/guards whose extraction can reduce readability.

## Migration Plan

### Step 0. Baseline

1. Run the deterministic audit and save the summary in the handoff log.
2. Run:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
```

3. If either command fails before changes, record the exact unrelated failure and continue only with a clear baseline note.

### Step 1. Add Content Definitions

1. Add `_definitions` entries for Phase 1 prototypes.
2. Replace `_type` on matching instances with the new local prototype type.
3. Remove only fields that are now inherited and are runtime-equivalent after compilation.
4. Keep per-instance `id`, `_label`, `title`, `body`, `summary`, action ids and all scenario-specific text.

### Step 2. Validate Content Batch

Run:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --mode deterministic \
  --scope file \
  --file games/antarctica/authoring/game.authoring.json \
  --format json
```

Expected result:

- generated runtime files do not change except source maps if the compiler records definition sources;
- `localPrototypes` is greater than 0;
- content-shape candidates decrease or are explicitly accepted as remaining variants.

### Step 3. Add Object-State Definition

1. Add `game.AntarcticaAvailableCardState` and `game.AntarcticaHiddenCardState`.
2. Replace the 71 card object state entries with the matching `_type` plus only instance-specific fields if any appear.
3. Verify that generated `state.public.objects.cards` remains byte-equivalent or canonical-JSON-equivalent.

### Step 4. Add Action Definitions

1. Add the four action-level prototypes from Phase 3.
2. Replace `_type` on matching actions.
3. Remove inherited scalar fields only: `templateId`, `capabilityFamily`, `capability`.
4. Keep `id`, `_label`, `_semantics`, `displayName`, `description`, `tags`, `params`, `deterministic`, `overrides`.

### Step 5. Decide On Nested Prototypes

1. Re-run the audit.
2. Review the top remaining nested candidates.
3. Introduce nested prototypes only if all conditions hold:
   - they reduce actual authoring work;
   - editor property panels can still explain inherited fields;
   - runtime output remains unchanged;
   - source map pointers remain navigable.

### Step 6. Closeout

1. Record final audit summary.
2. Record compile and validation commands.
3. Confirm no generated runtime manifest contains authoring-only keys:

```bash
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' \
  games/*/game.manifest.json \
  games/*/ui/*/ui.manifest.json
```

4. Update this task handoff log with changed files, checks and deferred candidates.

## Validation

Required validation after each migration batch:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
npm run verify:editor-engine
node scripts/manifest-tools/audit-prototype-candidates.cjs \
  --mode deterministic \
  --scope file \
  --file games/antarctica/authoring/game.authoring.json \
  --format json
git diff --check
```

Runtime parity check:

- compile before and after the batch;
- compare generated `games/antarctica/game.manifest.json` with canonical JSON normalization;
- inspect `games/antarctica/game.manifest.source-map.json` for pointers to missing authoring nodes.

JSON Schema remains the source of truth. Do not add manual TypeScript or JavaScript shape guards as a substitute for schema-backed validation.

## Acceptance

1. [x] `games/antarctica/authoring/game.authoring.json` contains local game-level prototypes in `_definitions`.
2. [x] Phase 1 content prototypes and Phase 2 card-state prototypes are applied.
3. [x] Phase 3 action-level prototypes are applied without replacing runtime action templates.
4. [x] Generated runtime manifest has zero gameplay/runtime diff under canonical JSON comparison.
5. [x] Runtime manifests contain no authoring-only keys.
6. [x] Source maps point to existing authoring JSON Pointers.
7. [x] The deterministic audit reports existing local prototypes.
8. [x] No platform-level prototype is created from Antarctica-specific data.
9. [x] No changes are made in `runtime-api`, `player-web` or contracts to support this migration.
10. [x] Action templates remain in `root.logic.templates` and still serve runtime action execution.

## Risks And Controls

| Risk | Control |
| --- | --- |
| Over-extraction makes JSON harder to read. | Start with content/state prototypes, postpone nested effects/guards. |
| Arrays are accidentally inherited and change output. | Do not move arrays in first pass; compiler replaces arrays rather than merging them. |
| Runtime action templates are confused with prototypes. | Keep `templateId` runtime semantics unchanged; prototypes only reduce authoring duplication. |
| Game-specific prototype leaks into platform catalog. | Keep all proposed types under local `game.Antarctica*` names and record no promotion request. |
| Source maps point to deleted fields. | Run source-map pointer existence checks after every batch. |

## Handoff Log

- 2026-06-16: Created execution plan from script-based audit. Current baseline: `_definitions` is empty, `localPrototypes=0`, deterministic audit finds 154 candidates. Recommended first migration batch: content prototypes, then card object-state prototype, then action-level prototypes.
- 2026-06-16: Implemented local game-level prototype migration in `games/antarctica/authoring/game.authoring.json`. Added 11 prototypes: 5 content/flow prototypes, 2 card-state prototypes and 4 action-level prototypes. Applied them to 355 authoring nodes: 26 info blocks, 71 cards, 13 boards, 26 flow steps, 10 team members, 71 card state entries and 138 templated actions. Runtime manifest was compared before/after with canonical JSON sorting and stayed semantically unchanged. Action instances keep `handlerType` because `game-authoring-v2.schema.json` requires it directly on every action; `templateId`, `capabilityFamily` and `capability` are inherited from action prototypes. Nested `metric.add`, guard and log-effect candidates remain deferred to preserve readability.
