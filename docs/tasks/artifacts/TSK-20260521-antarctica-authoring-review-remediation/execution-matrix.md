# Execution Matrix: Antarctica Authoring Review Remediation

## Оглавление

- [1. Purpose](#1-purpose)
- [2. Finding Matrix](#2-finding-matrix)
- [3. Execution Slices](#3-execution-slices)
- [4. Governance Checks](#4-governance-checks)
- [5. Decision Matrix](#5-decision-matrix)
- [6. Risk Register](#6-risk-register)
- [7. Handoff Checklist](#7-handoff-checklist)

## 1. Purpose

This matrix turns the post-migration review findings into bounded implementation slices. It complements `docs/tasks/active/TSK-20260521-antarctica-authoring-review-remediation.md`.

The target is not another broad migration pass. The target is to make the accepted `Antarctica` authoring migration truthful, diagnosable and CI-enforced.

## 2. Finding Matrix

| ID | Severity | Finding | Primary Files | Blocking Condition |
| --- | --- | --- | --- | --- |
| AR-001 | High | `opening.info.i21.advance` is referenced but not defined in runtime actions. | `games/antarctica/authoring/game.authoring.json`, `games/antarctica/authoring/ui/web.authoring.json` | A user can click a UI action that runtime cannot execute. |
| AR-002 | Medium | Source maps point to synthetic authoring paths that do not exist after prototype extraction. | `scripts/manifest-tools/compile-authoring-manifests.cjs`, `scripts/ci/validate-manifest-authoring.js`, generated `.source-map.json` files | Source maps cannot reliably guide agents from runtime errors back to authoring sources. |
| AR-003 | Low | Documentation says byte-equivalent output where only semantic JSON parity was shown. | Migration TSK and execution matrix | Review evidence is misleading and can hide ordering-only diffs. |

## 3. Execution Slices

| Slice | Goal | Main Write Scope | Acceptance Evidence | Validation | Status |
| --- | --- | --- | --- | --- | --- |
| R0 | Reproduce findings | `.tmp/` review scripts or direct Node checks | Counts for missing actions and invalid source pointers are recorded | local structured checks | Done |
| R1 | Add dangling action guard | `scripts/ci/validate-manifest-authoring.js` or a focused CI script | CI fails on current `opening.info.i21.advance` gap before content fix | negative local run or documented failing fixture | Done |
| R2 | Fix final action/reference | `games/antarctica/authoring/**`, generated Antarctica manifests | No unresolved `payload.actionId` or `advanceActionId` remains | `npm run compile:manifests -- --game antarctica --check` + action scan | Done |
| R3 | Add source-map pointer guard | `scripts/ci/validate-manifest-authoring.js` | CI validates that every source map source pointer exists | pointer-existence scan returns zero invalid refs | Done |
| R4 | Fix source-map generation | `scripts/manifest-tools/compile-authoring-manifests.cjs`, generated source maps | Source maps point to real authoring pointers after `_type` resolution | `npm run verify:manifest-authoring` | Done |
| R5 | Correct evidence docs | Migration TSK and matrix | Docs say semantic parity unless byte comparison is actually true | `git diff --check` | Done |
| R6 | Full closeout | task handoff logs | All gates pass and remaining gaps are explicit | `npm run verify:canonical && npm run test:e2e` | Done |

## 4. Governance Checks

| Check | Should Inspect | Should Fail On | Owner Slice |
| --- | --- | --- | --- |
| Source map file existence | adopted manifests discovered from `games/*/authoring/**` | missing `.source-map.json` | existing validator / R3 |
| Source map pointer existence | every `mappings[*].file` and `mappings[*].pointer` | source file missing or JSON Pointer missing | R3 |
| UI action reference existence | UI component `actions.*.payload.actionId` | action ID absent from generated game manifest actions | R1 |
| Game content action reference existence | content fields such as `advanceActionId` | action ID absent from generated game manifest actions | R1 |
| Authoring-only leakage | generated runtime manifests | `_type`, `_extends`, `_definitions`, `_semantics`, `_source_trace` | existing validator |
| Semantic parity evidence | normalized JSON compare when claimed | undocumented semantic runtime change | R5/R6 |
| Byte-equivalence evidence | `cmp` when claimed | byte-level diff | R5/R6 |

## 5. Decision Matrix

| Decision Point | Preferred Decision | Reason |
| --- | --- | --- |
| Missing final action | Add a terminal/no-op manifest action only if clicking Finish is still a player-visible command. | Keeps UI behavior explicit and runtime-auditable. |
| Alternative final action path | Remove the button dispatch if final screen is terminal and needs no server transition. | Avoids fake no-op actions if there is no domain event. |
| Source map repair | Prefer compiler fix over manual source-map editing. | Source maps are generated artifacts and must stay deterministic. |
| Pointer validation location | Put it in `verify:manifest-authoring`. | ADR-030 governance already owns source maps and generated drift. |
| Documentation wording | Use semantic JSON parity unless byte comparison passes. | Prevents overclaiming review evidence. |

Decision recorded after implementation: `opening.info.i21.advance` was added as a terminal no-op action through the Antarctica game authoring manifest. The existing final web button remains dispatchable, and the action keeps runtime state on final info screen `i21`.

## 6. Risk Register

| Risk | Impact | Control |
| --- | --- | --- |
| Fixing `opening.info.i21.advance` changes terminal gameplay unintentionally. | Player-visible regression at the end of Antarctica. | Treat final action as a small content slice and document the exact behavior. |
| Source-map generation fix breaks existing `simple-choice` mappings. | ADR-030 pilot regresses. | Include `simple-choice` in pointer-existence validation. |
| CI guard becomes Antarctica-specific. | Game-specific drift in governance. | Implement checks generically for adopted game/UI manifest pairs. |
| Manual source-map edits mask compiler bug. | Next compile reintroduces broken maps. | Only edit compiler/source authoring, then regenerate. |
| Documentation marks task complete too early. | Known drift becomes accepted silently. | Original migration task remains blocked until this remediation passes. |

## 7. Handoff Checklist

- Findings AR-001, AR-002 and AR-003 reproduced before fixes.
- Missing action/reference decision recorded.
- Source-map pointer-existence validator added to committed governance.
- Generated source maps regenerated by compiler only.
- Original migration task handoff updated with corrected evidence.
- `PROJECT_STRUCTURE.yaml` regenerated after adding this task/artifact directory.
- `npm run verify:manifest-authoring` passes after new guards are active.
- `npm run verify:canonical` passes.
- `npm run test:e2e` passes in an isolated run.
