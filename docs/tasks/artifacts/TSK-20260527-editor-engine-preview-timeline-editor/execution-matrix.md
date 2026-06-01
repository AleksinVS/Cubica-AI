# Execution Matrix: Preview-Timeline Editor Redesign

## Оглавление

- [1. Purpose](#1-purpose)
- [2. Inputs And Outputs](#2-inputs-and-outputs)
- [3. Non-Negotiable Invariants](#3-non-negotiable-invariants)
- [4. Execution Slices](#4-execution-slices)
- [5. Adapter Strategy](#5-adapter-strategy)
- [6. Timeline Matrix](#6-timeline-matrix)
- [7. Entity Tree Matrix](#7-entity-tree-matrix)
- [8. Validation Gates](#8-validation-gates)
- [9. Risk Register](#9-risk-register)
- [10. Handoff Checklist](#10-handoff-checklist)

## 1. Purpose

This matrix turns `docs/tasks/active/TSK-20260527-editor-engine-preview-timeline-editor.md` into bounded execution slices.

The goal is to move editor-engine from graph-primary authoring to preview-first authoring while preserving authoring JSON as the source of truth and keeping runtime/player layers clean.

## 2. Inputs And Outputs

| Area | Input | Editor output | Runtime output |
| --- | --- | --- | --- |
| Game authoring v2 | `games/<id>/authoring/game.authoring.json` | semantic entities, manifest chronology, JSON Patch edits | generated `game.manifest.json` |
| UI authoring v2 | `games/<id>/authoring/ui/<channel>.authoring.json` | UI entity tree, preview selection metadata, JSON Patch edits | generated `ui.manifest.json` |
| Renderer adapter | runtime/player preview render tree | `PreviewEntityDescriptor[]`, hit-test results, highlights, preview events | none |
| Timeline trace | preview session events + snapshots | rollback/replay state under `.tmp/editor-playthroughs/` | none |
| Layout sidecars | editor layout files | rail state, pinned panels, preview view prefs | none |
| AI prompt | selected entity or region context | bounded ChangeSet, automatic validated apply, undo journal and user-facing diff summary | none until saved/compiled |
| Project Git workspace | project repo commit + session worktree | session branch, patch journal, Save commit, rollback commit | generated manifests only by project policy |
| User plugins | project plugin files and plugin manifests | plugin-aware ChangeSets, validation results, diff summaries | compiled plugin/runtime behavior only after validation |

## 3. Non-Negotiable Invariants

| ID | Invariant | Enforcement |
| --- | --- | --- |
| I1 | Authoring JSON remains the editable source of truth. | All edits become JSON Patch/editor intents against DocumentStore. |
| I2 | Runtime manifests remain generated output. | `compile --check` and runtime schema validation. |
| I3 | Preview state is not authoring state. | Timeline rollback never changes DocumentStore history. |
| I4 | Renderer adapter stays renderer-neutral. | `packages/editor-engine` has no React DOM, Phaser, canvas or GameObject imports. |
| I5 | Thin React adapter is the first implementation path. | Avoid building Phaser support until a Phaser renderer is in active scope. |
| I6 | Default entity tree shows only semantic entities, uses `_label` as primary row name, hides technical fields and keeps scalar parameters in property panel. | Entity projection tests, missing-label diagnostics and UI assertions. |
| I7 | AI edits are automatic but controlled. | AI output must be a bounded ChangeSet, dry-run validated, undo-recorded and summarized for the user. |
| I8 | Editor-only traces do not leak. | Runtime manifest leakage scans. |
| I9 | Unsaved AI edits are session-scoped. | Prompt edits stay in session worktree/journal until Save creates a commit. |
| I10 | Project versioning is non-destructive. | Save creates commits; rollback creates revert/restore commits; platform UI never runs destructive reset. |
| I11 | Plugin edits stay in project plugin boundary. | Plugin validation gates and platform purity scans. |
| I12 | Project-local plugin architecture is explicit. | User-editable plugins live under `games/<gameId>/plugins/<pluginId>/`, not under platform app source. |

## 4. Execution Slices

| Slice | Goal | Main Write Scope | Acceptance Evidence | Validation | Status |
| --- | --- | --- | --- | --- | --- |
| E0 | Documentation closeout | ADR, design docs, TSK, matrix, NEXT_STEPS | Preview-first target documented and large-JSON guardrail recorded | `git diff --check` | Implemented |
| E1A | Authoring v2 schema draft | `docs/architecture/schemas`, compiler docs | `_label` and root-owned entities defined; minimal v2 fixtures compile | schema validation fixtures | Implemented |
| E1B | Full authoring manifest migration | `games/*/authoring`, migration scripts, generated manifests | Existing authoring manifests use v2 semantic structure | `verify:manifest-authoring` | Implemented |
| E2 | Compiler v2 production hardening | compiler + source maps | v2 generated parity and source maps validated for migrated manifests | `verify:manifest-authoring` | Implemented |
| E3 | Renderer adapter protocol | `packages/editor-engine`, editor-web types | renderer-neutral descriptors and hit-test contract | unit tests | Implemented |
| E4 | Thin React DOM adapter | `apps/editor-web`, player preview integration | `data-*` metadata maps to descriptors | component/e2e tests | Implemented baseline |
| E5 | Preview workspace shell | `apps/editor-web` | preview-first layout with rails and bands | screenshot/e2e | Implemented baseline |
| E6 | Entity tree projection | editor-engine + editor-web | semantic tree uses `_label`, marks fallback labels, hides technical fields and routes parameters to property panel | unit + e2e | Implemented |
| E7 | Preview selection overlay | editor-web overlay + player preview bridge | click, overlap picker, drag region and highlight baseline work through iframe messages | unit + smoke/e2e | Implemented baseline |
| E8 | Timeline model | editor-engine + editor-web | manifest chronology and trace rollback work | unit + e2e | Implemented core + UI band baseline |
| E8A | Runtime-authoritative preview rollback | contracts-session + runtime-api + player-web bridge + editor-web timeline | player preview emits runtime snapshots, editor trace records them linearly, runtime-api restores preview-only sessions, future trace is discarded after rollback | runtime integration + editor/player typecheck + browser e2e follow-up | Implemented baseline |
| E9 | AI prompt intent flow | editor-web + AI patch boundary | prompt captures editor intent with target pointers and passes scoped active-file context to the patch route | focused tests | Implemented baseline |
| E10 | Phaser/canvas readiness | docs + adapter contract tests | contract supports non-DOM renderer | adapter tests | Planned |
| E11 | Automatic AI ChangeSet apply | editor-engine + editor-web + AI route | prompt applies bounded active-file JSON ChangeSet after dry-run validation and shows diff summary | unit + component + route tests | Implemented baseline |
| E12 | Incremental undo journal | editor-engine + editor-web | unsaved AI patches record forward/inverse ChangeSets and support undo/redo without Git reset | unit + e2e | Implemented baseline |
| E13 | Project Git workspace | editor repository service + editor-web routes | session worktree, session-backed file/layout open, Save commit helper and restore-commit rollback helper work | integration tests + route build | Implemented file workflow baseline |
| E14 | Plugin-aware ChangeSets | plugin project boundary + validation | plugin file edits stay in project/plugin boundary and cannot touch platform core | boundary tests; typecheck/test/smoke gates remain follow-up | Implemented boundary baseline |
| E15 | Session-aware compile/preview | compiler workflow + preview route + runtime content boundary | validate/compile read session worktree; preview registers a session `contentSourceId` and player/runtime consume generated manifests from the same worktree; runtime content-root allowlist supports isolated local project repos | integration + browser e2e | Implemented local e2e baseline |
| E15A | Project-local plugin contract | ADR, schemas, editor validation design | ADR-037 accepted: trusted project-local `player-web` plugins now, marketplace-safe sandbox path later, npm dependencies forbidden until verification, Antarctica migration target fixed | docs + `git diff --check` | Architecture accepted |
| E15A.1 | Player-web plugin bundle handoff | ADR, preview and production boundary design | ADR-039 accepted: local preview uses session-scoped browser bundles; production target uses immutable content-hash published bundles exposed through `PlayerFacingContent.pluginBundles` | docs + review | Accepted; production implementation planned |
| E15A.2 | Runtime-api extension policy | ADR, sandbox and protocol options, mechanics language docs | ADR-040 accepted: manifest/platform capabilities first, no functionality tied to one concrete game in generic `runtime-api`, trusted project runtime plugins use a separate process with JSON protocol and separate review, marketplace uses container sandbox or WebAssembly/WASI for pure computation | docs + review | Accepted |
| E15B.0 | Antarctica player plugin migration | project-local plugin + player-web facade | `Antarctica` plugin lives in `games/antarctica/plugins/antarctica-player`, the former platform-local plugin directory is removed, `simple-choice` remains plugin-free | player-web tests/build + scans | Implemented |
| E15B.1 | Plugin discovery and validation runner | discovery helper + editor validation/save gate | plugin roots are discovered from `games/<gameId>/plugins/<pluginId>/plugin.json`; schema/dependency/path/typecheck diagnostics block Save/preview; `build`/`test` stay reserved until a separate runner contract | schema/unit/editor tests | Implemented local preview baseline |
| E15B.2 | Session plugin bundle handoff | bundle builder + runtime metadata + player preview loader | session plugin code is bundled, registered under `contentSourceId`, loaded only in preview mode and refreshed by content hash without restarting `player-web` | integration/e2e | Implemented local preview baseline |
| E15B.3 | Production/published plugin boundary | publish metadata + player loader policy | production player loads only immutable published bundle references and never editor worktree code; implementation tracked in `TSK-20260531-player-web-published-plugin-bundle-handoff` | build/e2e/static scans | Planned |
| E15B.4 | Antarctica manifest cleanup | runtime manifest, authoring source, schema/runtime effects | `capabilityFamily: "antarctica.opening"` заменен на нейтральные семейства, бывшие `script` actions переведены в manifest-driven UI/runtime effects, runtime-script заглушка удалена, поведение остается прежним по focused runtime/player checks | manifest-authoring/runtime/player/e2e + cleanup scans | Implemented baseline |
| E15B.5 | Runtime-api plugin runner debt | legacy register + ADR-040 boundary | full runtime-api plugin runner остается вне scope и зафиксирован как `LEGACY-0014`, пока отдельный slice не докажет необходимость и не выполнит правила separate-process/JSON-protocol/sandbox | `node scripts/ci/validate-legacy.js` | Documented debt |
| E15B.6 | Antarctica plugin migration closeout | project and execution docs | итоговое состояние миграции, факты репозитория, приемочные критерии, проверки и оставшийся долг собраны в `antarctica-plugin-migration-closeout.md` | docs review + `git diff --check` | Implemented |
| E15B.7 | Antarctica effects normalization | schema, contracts, runtime-api, Antarctica authoring/generated manifests | `Antarctica` использует общие `effects[]` для изменений состояния, timeline, флагов, коллекций и условий `when` | runtime focused tests + manifest-authoring check + scans | Implemented |
| E15B.8 | Plugin diagnostics journal | editor-web footer UI | plugin validation diagnostics are visible in a dedicated journal row; Save HTTP 422 shows plugin diagnostics instead of a generic failure | editor-web typecheck + focused UI/lib tests | Implemented |
| E16 | Governance closeout | docs, scans, handoff | all gates recorded | full validation | Planned |

## 5. Adapter Strategy

| Adapter path | Role | Decision |
| --- | --- | --- |
| React DOM adapter | First reference implementation. Reads explicit editor metadata from rendered elements and exposes neutral descriptors. | Build first. |
| Iframe message adapter | Production isolation boundary for preview. Uses postMessage with schema/origin checks. | Implemented baseline for runtime pointer descriptors and preview session snapshots. |
| Phaser adapter | Future non-DOM renderer adapter. Uses Game Object metadata, hit areas, camera/world coordinate conversion. | Do not build until a Phaser game or prototype is in scope. |
| Direct DOM traversal without adapter | Simplest prototype path. | Reject for production because it couples editor-engine to DOM renderer shape. |

## 6. Timeline Matrix

| Timeline type | Source | Storage | Rollback strategy | Acceptance |
| --- | --- | --- | --- | --- |
| Manifest chronology | `root.logic.flows`, `steps`, `next`, branches | authoring JSON | select step and build preview state from deterministic references | linear game timeline appears without playing |
| Recorded playthrough | preview action events + runtime snapshots | in-memory first; `.tmp/editor-playthroughs/` planned | runtime-api restores exact preview snapshot first; sparse snapshot replay remains compatible follow-up | nonlinear session can move backward; rollback/new play keeps one linear path |
| Named scenario | future test artifact | not in this slice | explicit schema and review | out of scope |

## 7. Entity Tree Matrix

Default entity tree is a semantic outline, not a pointer-complete JSON tree. Row labels use `_label` first. Temporary display fallback to `title`, `name` or `id` keeps incomplete documents readable, but missing `_label` still produces diagnostics and does not satisfy authoring validation.

| Entity class | Default tree visibility | Tree label source | Property panel role | Technical fields |
| --- | --- | --- | --- | --- |
| Game/root | visible | `_label`; fallback `title`/`name`/`id` with diagnostic | meta, labels, settings | `$schema`, `_schemaVersion` hidden |
| Flow/step | visible | `_label`; fallback `title`/`name`/`id` with diagnostic | sequence, conditions, references | compiler-only fields hidden |
| Action/rule/condition | visible | `_label`; fallback `title`/`name`/`id` with diagnostic | action params, guards, state effects | generated template internals hidden unless advanced |
| State/metric | visible | `_label`; fallback `title`/`name`/`id` with diagnostic | initial values, bindings, visibility | raw nested scalars hidden unless selected |
| UI screen | visible | `_label`; fallback `title`/`name`/`id` with diagnostic | title, layout mode, routing | runtime map key hidden if redundant with `id` |
| UI component | visible | `_label`; fallback `title`/`name`/`id` with diagnostic | props, children summary, action binding | raw `props` fields shown in property panel |
| Prototype definition | hidden by default except prototype mode | `_label` optional for prototype mode | reusable defaults | `_extends` visible only in advanced/prototype mode |

## 8. Validation Gates

| Gate | Command or Check | Blocks |
| --- | --- | --- |
| Diff hygiene | `git diff --check` | Markdown/whitespace drift. |
| Structure index | `node scripts/dev/generate-structure.js` | Stale `PROJECT_STRUCTURE.yaml` after new artifact directory. |
| Core verification | `npm run verify:editor-engine` | Broken DocumentStore, adapter model, timeline model. |
| Editor web tests | `npm test --workspace @cubica/editor-web` | Preview workspace regressions. |
| Editor web verification | `npm run verify:editor-web` | Build/lint/type regressions. |
| Authoring verification | `npm run verify:manifest-authoring` | Broken authoring/generated relation. |
| Entity label completeness | Schema validation plus entity projection diagnostics for missing `_label` on default-tree entities. | Tree-visible game/UI entity without author-facing label. |
| Entity tree UI assertions | Unit/e2e checks that default tree hides technical fields and scalar params while property panel shows selected entity parameters. | Regressions to raw JSON tree behavior. |
| Runtime purity scan | `rg -n "editor-engine" apps/player-web services/runtime-api` | Runtime/player imports editor code. |
| Runtime leakage scan | `rg -n "_source_trace|editor\\.layout|editor-playthrough" games/*/game.manifest.json games/*/ui/*/ui.manifest.json` | Editor-only state in generated manifests. |
| Renderer purity scan | `rg -ni "Phaser|GameObject|document\\.elementFromPoint" packages/editor-engine` | Renderer-specific dependency in core. |
| Authoring v2 fixture gate | `node scripts/ci/validate-manifest-authoring.js` | Broken v2 schema or compiler fixture support. |
| AI ChangeSet dry-run | engine unit tests and local planner tests for bounded active-file ChangeSet apply before mutation | AI full-file rewrites, invalid paths or invalid JSON changes. |
| Undo journal | inverse ChangeSet tests and editor undo/redo controls; e2e coverage remains follow-up | Unsaved AI edits cannot be reversed. |
| Project Git workspace | integration tests around worktree/session branch/commit/restore commit | Destructive or non-isolated versioning behavior. |
| Session file workflow | editor-session-store tests and editor-web build for `/api/editor/session`, `/api/editor/file`, `/api/editor/files`, `/api/editor/layout` | Browser saves bypass worktree or mutate main checkout. |
| Session compile/preview | editor-web tests/build; runtime-api content source integration test; Playwright editor session preview e2e with `EDITOR_PREVIEW_WORKTREES_ROOTS` for isolated local project repos | Preview shows main checkout instead of session edits, compile writes generated files outside the session worktree, or runtime-api accepts arbitrary content roots. |
| Preview rollback | runtime-api integration test for `/sessions/:id/preview-restore`; editor-web preview message tests; player-web/editor-web typecheck; browser e2e follow-up for full iframe rollback | Rollback mutates authoring JSON, works for production sessions, branches future trace, or desynchronizes player-web from runtime-api. |
| Plugin validation | boundary tests, `verify:manifest-authoring`, editor-web plugin validation tests and Playwright preview bundle test cover `plugin.json`, `platform-only`, discovery, direct `typecheck`, timeout diagnostics and local hot preview reload | Broken or unsafe game plugin edits. |
| Plugin diagnostics journal | `npm test --workspace @cubica/editor-web -- plugin-diagnostics-journal editor-web-adapter project-plugin-validation` | Plugin validation failures become invisible or generic in editor UI. |
| Plugin location | scan for former platform-local Antarctica imports in `apps/player-web` and `games/antarctica` | No matches after migration. Antarctica lives under `games/antarctica/plugins/antarctica-player`; `apps/player-web/src/plugins` only exposes the platform facade and bundle loader. |
| Antarctica manifest cleanup | `rg -n '"capabilityFamily": "antarctica\\.opening"' games/antarctica/game.manifest.json` and `rg -n '"handlerType": "script"' games/antarctica/game.manifest.json` after cleanup | Game-specific family names or legacy script markers remain in generated runtime manifest without explicit debt. |
| Legacy debt register | `node scripts/ci/validate-legacy.js` | Runtime-api plugin runner debt is not mirrored between `debt-log.csv` and `stubs-register.md`. |

## 9. Risk Register

| Risk | Impact | Control |
| --- | --- | --- |
| Adapter becomes a large framework. | React path slows down and complexity grows. | Keep first adapter thin; build only descriptor/hit-test/highlight. |
| Preview overlay desynchronizes from rendered objects. | Selection frames point to wrong entity. | Adapter invalidates descriptors on layout/resize/preview state changes. |
| Timeline rollback mutates authoring document. | User loses source changes. | Separate preview session history from DocumentStore undo/redo. |
| AI prompt writes uncontrolled JSON. | Validation, locality and undo are bypassed. | Require bounded ChangeSet, scoped context, dry-run validation and undo journal before automatic apply. |
| Multiple prompt edits corrupt session state. | User cannot continue or undo reliably. | Append every step to patch journal with inverse ChangeSet and before/after hashes. |
| Git workflow damages project history. | Project rollback becomes unsafe. | Use session worktrees, Save commits and revert/restore commits; prohibit destructive reset in platform UI. |
| Plugin edits leak into platform core. | Game-specific hacks enter shared runtime/player/editor layers. | Keep plugins inside project repo and run platform purity scans for touched files. |
| Manifest cleanup becomes hidden runtime-plugin work. | `Antarctica` debt is solved by adding server code that bypasses manifest/schema validation. | Use `antarctica-manifest-cleanup.md`; full runtime-api plugin runner remains `LEGACY-0014` and needs a separate ADR-040 implementation slice. |
| Authoring v2 migration breaks generated parity. | Runtime behavior changes unexpectedly. | Migrate through fixtures and compile/runtime schema gates. |
| Large authoring JSON exhausts model context. | Manual edits become unsafe or incomplete. | Use targeted JSON Pointer extraction, deterministic migration scripts and generated reports. |
| Phaser support drives premature abstraction. | Extra work without current need. | Document Phaser contract; implement only when scoped. |

## 10. Handoff Checklist

- ADR-036 and project design doc agree on preview-first direction.
- TSK and matrix are listed in `NEXT_STEPS.md`.
- `docs/tasks/active/.desc.json` includes the new TSK.
- New artifact directory has `.desc.json`.
- `PROJECT_STRUCTURE.yaml` regenerated after structural changes.
- React DOM adapter remains the first implementation path.
- Phaser remains a supported future adapter, not a core dependency.
