# Remediation Execution Matrix

## Оглавление

- [Purpose](#purpose)
- [Terms](#terms)
- [Execution Matrix](#execution-matrix)
- [CI Stub Gate Specification](#ci-stub-gate-specification)
- [Validation Matrix](#validation-matrix)
- [Execution Notes](#execution-notes)

## Purpose

This document turns `docs/reviews/2026-05-20-project-review.md` into executable remediation work. It complements `docs/tasks/active/TSK-20260520-project-review-remediation.md` and should be updated when a finding is fixed, split, or intentionally deferred.

## Terms

- Stub - a temporary replacement or simplification of expected production behavior.
- CI - Continuous Integration, automated checks that run before merge.
- Gate - a blocking validation job that must pass before a change can be merged.

## Execution Matrix

| Finding | Primary files | Required action | Acceptance evidence |
| --- | --- | --- | --- |
| `PROJECT_STRUCTURE.yaml` misses active TSK files | `docs/tasks/active/.desc.json`, `PROJECT_STRUCTURE.yaml` | Done: descriptions are present and structure was regenerated. | `node scripts/dev/generate-structure.js` passes. |
| Invalid `.desc.json` files are silently ignored | `services/router/.desc.json`, `services/game-repository/.desc.json`, `apps/player-web/public/images/.desc.json`, `services/game-engine/.desc.json`, `draft/antarctica-nextjs-player/.desc.json`, `scripts/dev/generate-structure.js` | Done: JSON syntax fixed and generator now throws with the file path on parse errors. | JSON parse check passes. |
| Legacy and stub registries disagree | `docs/legacy/debt-log.csv`, `docs/legacy/stubs-register.md` | Done: active rows are mirrored in the current stubs table. | `node scripts/ci/validate-legacy.js` confirms bidirectional consistency. |
| Missing `SDK/extensions/` target for `LEGACY-0006` | `docs/legacy/debt-log.csv`, `docs/legacy/stubs-register.md`, ADR-015 docs | Done: `stub_reference` now points to ADR-015 and notes the missing implementation. | Active row no longer points to a missing path. |
| CI does not block unregistered stubs | `scripts/ci/validate-legacy.*`, `.github/workflows/*` | Done: Node validator, PowerShell wrapper, root script and GitHub Actions workflow added. | `node scripts/ci/validate-legacy.js --self-test-unregistered-stub` fails as expected. |
| Portal launch task says runtime binding is absent | `docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md` | Done: stale note replaced with actual remaining gaps. | TSK references the current player binding path and remaining portal/runtime gaps. |
| Broken documentation links | `PROJECT_OVERVIEW.md`, `docs/architecture/gameplay-slices/*.md`, `apps/player-web/README.md` | Done: active references were removed or replaced. | Scoped broken-reference query returns no active docs hits. |
| `verify:canonical` omits player-web tests | `package.json`, README/TSK validation sections | Done: `verify:player-web` now runs `npm test --workspace @cubica/player-web`; `verify:canonical` runs `verify:legacy` first. | Full gate includes player-web tests. |
| Current deterministic path mixed with LLM-first target | `PROJECT_OVERVIEW.md` | Done: current deterministic runtime and target LLM-first capability layer are separated. | New developer can identify current runtime path without reading ADR history. |
| Manual `templateId` cross-validation lives outside schema | `services/runtime-api/src/modules/content/manifestValidation.ts`, `docs/tasks/archive/TSK-20260518-json-schema-strict-validation.md` | Done for planning: strict-validation TSK now explicitly owns moving or documenting the exception. | The drift is no longer unregistered; implementation remains in the strict-validation task. |

## CI Stub Gate Specification

The CI stub gate must be a required status check. It should fail on any of the following:

1. `docs/legacy/debt-log.csv` is missing, empty, malformed, or has duplicate `LEGACY-*` ids.
2. `docs/legacy/stubs-register.md` references a `LEGACY-*` id that is absent from `debt-log.csv`.
3. An active legacy row that represents a stub or scaffold is absent from the current stubs table.
4. An active stub row points to a missing `stub_reference` without an explicit documented exception.
5. A source or documentation file introduces a new stub marker without a matching `LEGACY-*` registration.
6. Any `.desc.json` file is invalid JSON.

Recommended implementation tasks:

1. Add `scripts/ci/validate-legacy.js`.
2. Keep `scripts/ci/validate-legacy.ps1` as a wrapper that calls the Node validator, or document it as legacy.
3. Add a root npm script, for example `verify:legacy`.
4. Add GitHub Actions workflow with jobs for:
   - legacy/stub gate;
   - canonical verification;
   - portal rule tests if portal launch work remains active.
5. Trigger workflow on `pull_request`, protected branch `push`, and `merge_group`.
6. Configure branch protection or repository ruleset so the legacy/stub gate is required.

Detection policy for unregistered stub markers:

- Scan supported source/docs paths, excluding `docs/reviews/`, `docs/tasks/archive/`, generated folders, `.tmp/`, `draft/` unless the draft is explicitly active.
- Match terms such as `stub`, `mock`, `TODO`, `FIXME`, `заглушка`, `временно`, `not implemented`.
- Require a nearby `LEGACY-*` id or an allowlist entry with owner, reason, and expiry.

## Validation Matrix

| Command | Expected result |
| --- | --- |
| `node scripts/dev/generate-structure.js` | Regenerates `PROJECT_STRUCTURE.yaml` and fails on invalid `.desc.json`. |
| `node scripts/ci/validate-legacy.js` | Passes only when debt/stub registries and stub markers are synchronized. |
| `npm run verify:canonical` | Passes for runtime and player canonical slice. |
| `npm test --workspace @cubica/player-web` | Runs as part of `verify:player-web` and therefore `verify:canonical`. |
| `npm run test:portal-rules --prefix services/portal-backend` | Passes while portal launch rules remain active. |
| Broken-reference `rg` query from the TSK | Returns no active documentation hits. |

## Execution Notes

- Do Phase 1 before regenerating `PROJECT_STRUCTURE.yaml`; otherwise the generator will keep hiding invalid `.desc.json` files.
- Do not mark legacy rows as removed just to satisfy CI. A removed row must correspond to actual removal or replacement of the stub.
- Do not delete historical review findings. If a review finding is fixed, update the active task and leave the review as historical evidence.
- `BACKLOG.md` was already modified before this remediation package was created; avoid using it as a source of truth unless a separate task classifies it.
