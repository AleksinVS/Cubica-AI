# Execution Matrix: Semantic Prototype Authoring Layer

## Оглавление

- [1. Purpose](#1-purpose)
- [2. Non-Negotiable Invariants](#2-non-negotiable-invariants)
- [3. Execution Slices](#3-execution-slices)
- [4. Decision Matrix](#4-decision-matrix)
- [5. CI Gates](#5-ci-gates)
- [6. Implementation Status](#6-implementation-status)
- [7. Risks And Controls](#7-risks-and-controls)
- [8. Handoff Checklist](#8-handoff-checklist)

## 1. Purpose

This matrix turns ADR-030 into an executable implementation sequence. It keeps architecture decisions in ADR-030 and keeps implementation tracking in `docs/tasks/archive/TSK-20260521-semantic-prototype-authoring-layer.md`.

A sidecar is a companion file stored next to the main artifact; here it means a source map that tooling reads, while runtime ignores it.

## 2. Non-Negotiable Invariants

| ID | Invariant | Enforcement |
| --- | --- | --- |
| I1 | Authoring layer is mandatory for new/changed manifests after compiler adoption. | CI blocks generated-only edits. |
| I2 | Agents edit authoring inputs, not generated runtime manifests. | Contributor docs and generated diff checks. |
| I3 | Runtime does not resolve authoring prototypes. | No runtime support for `_type`, `_extends`, `_definitions`, `_semantics`. |
| I4 | Runtime game/UI manifests validate against runtime schemas. | Ajv validation in canonical checks. |
| I5 | Authoring schemas are JSON Schema, not TypeScript-only guards. | Schema files plus validator tests. |
| I6 | `_type` is semantic instance type; `_extends` is inheritance in definitions. | Compiler tests and schema examples. |
| I7 | Source tracing is a sidecar source map, not runtime `_source_trace`. | Runtime manifest scan. |
| I8 | Compiler output is deterministic and idempotent. | `compile -> git diff --exit-code`. |

## 3. Execution Slices

| Slice | Goal | Main Write Scope | Acceptance | Validation |
| --- | --- | --- | --- | --- |
| S1 | File layout convention | `games/*/authoring`, `.desc.json`, docs | Chosen layout documented; no runtime behavior change | `node scripts/dev/generate-structure.js` |
| S2 | Authoring schema skeletons | `docs/architecture/schemas/*authoring*.schema.json` | Game/UI authoring schemas exist and validate system keys | JSON parse + schema compile tests |
| S3 | Compiler CLI skeleton | `scripts/manifest-tools` | CLI resolves inputs/outputs and prints deterministic plan | CLI smoke test |
| S4 | `_type` and `_extends` resolver | compiler code + tests | Unknown type, cycle and depth errors are deterministic | Compiler validation |
| S5 | Merge semantics MVP | compiler code + tests | Object merge and array replace work; merge operators are rejected until explicitly enabled by schema | Compiler validation |
| S6 | Source map generation | compiler code + source map schema | Generated mappings point to authoring file and JSON Pointer | `npm run verify:manifest-authoring` |
| S7 | `simple-choice` pilot | `games/simple-choice/authoring`, generated manifests | Runtime behavior unchanged; game and UI outputs are generated | `npm run test:e2e` |
| S8 | CI enforcement | `package.json`, `scripts/ci`, `.github/workflows/ci.yml` | `verify:canonical` and CI block drift and authoring-only leakage | `npm run verify:canonical` |
| S9 | Antarctica migration planning | active task/debt docs | Existing flat manifest is documented transition state | Follow-up bounded task |

## 4. Decision Matrix

| Topic | Decision | Reason |
| --- | --- | --- |
| ADR-028 relationship | ADR-030 supplements ADR-028. | Runtime action templates remain valid output; authoring prototypes are build inputs. |
| Manifest coverage | Apply to game manifest and UI manifest. | Agents need the same mental model for logic and screens. |
| Authoring optionality | Not optional for new/changed manifests after adoption. | Optional authoring would create two competing edit paths. |
| Agent edit target | Authoring input only. | Prevents generated/runtime drift. |
| `_type` role | Semantic instance type. | Keeps files readable for humans and agents. |
| `_extends` role | Definition inheritance edge. | Keeps technical prototype traversal separate from intent. |
| Source tracing | Sidecar source map. | Keeps runtime schemas clean and strict. |
| Validation source | JSON Schema. | Preserves cross-platform contracts and ADR-025. |
| Compiler behavior | Deterministic and idempotent. | Enables cheap CI drift detection. |

## 5. CI Gates

| Gate | Command Shape | Blocks |
| --- | --- | --- |
| Authoring compile | `npm run compile:manifests` | Invalid authoring input or compiler failures |
| Generated drift | `npm run compile:manifests && git diff --exit-code -- games` | Generated files not updated |
| Runtime schema | Existing Ajv checks for game/UI manifests | Output that runtime/player cannot consume |
| Authoring leakage | `rg` or structured scan for authoring-only keys in runtime manifests | `_type`, `_extends`, `_definitions`, `_semantics`, `_source_trace` in runtime output |
| Manual generated edit | Diff classifier comparing generated files and authoring inputs | Runtime manifest edits without authoring changes |
| Canonical verification | `npm run verify:canonical` | Any broken canonical slice |

## 6. Implementation Status

| Slice | Status | Notes |
| --- | --- | --- |
| S1 | Done | `games/simple-choice/authoring/` and `.desc.json` files added. |
| S2 | Done | Authoring and source map schemas added under `docs/architecture/schemas/`. |
| S3 | Done | `scripts/manifest-tools/compile-authoring-manifests.cjs` added. |
| S4 | Done | Local `_type`, `_extends`, cycle and depth checks implemented. |
| S5 | Partial | Object merge and array replacement implemented; `+field`/`-field` currently fail closed. |
| S6 | Done | Source maps generated as companion files. |
| S7 | Done | `simple-choice` has game/UI authoring inputs and generated outputs. |
| S8 | Done | `verify:manifest-authoring`, `verify:canonical`, and GitHub CI job added. |
| S9 | Documented | `Antarctica` migration is tracked by `docs/tasks/archive/TSK-20260521-antarctica-authoring-manifest-migration.md`. |

## 7. Risks And Controls

| Risk | Control |
| --- | --- |
| Compiler becomes a hidden runtime model | Runtime never imports compiler/resolver and does not accept authoring-only keys. |
| Agents get confused by two layers | Docs and CI enforce one edit target: authoring files. |
| Existing flat manifests conflict with mandatory authoring | Register them as transition state and migrate with bounded slices. |
| Source maps become required by runtime | Treat source maps as tooling-only artifacts. |
| Merge semantics become too powerful | Start with object merge, array replace, and explicit allowlist for operators. |
| Game-specific prototypes leak into core | Keep core registry generic; game-specific definitions stay in game bundle. |
| Generated files cause noisy diffs | Stable ordering and idempotent compiler output. |

## 8. Handoff Checklist

- ADR-030 reviewed before implementation.
- Current task file updated after each stop.
- New significant directories include `.desc.json`.
- `PROJECT_STRUCTURE.yaml` regenerated after structural changes.
- Authoring and runtime schemas stay synchronized by tests.
- `simple-choice` remains the first pilot unless the task file records a deliberate change.
- No runtime/player code is changed to understand authoring-only fields.
