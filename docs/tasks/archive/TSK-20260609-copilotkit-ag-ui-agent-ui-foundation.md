# TSK-20260609-copilotkit-ag-ui-agent-ui-foundation: CopilotKit/AG-UI Agent UI Foundation

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Why](#why)
- [Architecture Baseline](#architecture-baseline)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Implementation Result](#implementation-result)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Handoff Log](#handoff-log)

## Status

implemented-baseline

## Understanding

Задача понята так: CopilotKit and AG-UI are accepted as the Cubica foundation for user-facing AI assistants. The implementation must start with the editor assistant, but the design must already support portal, facilitator, player and admin helpers.

The key constraint: the assistant UI can guide, propose and request tools, but all durable changes must still pass through Cubica contracts, validation and ownership boundaries.

## Why

Cubica already has a local AI prompt baseline in `apps/editor-web`, but it is a deterministic planner and not a reusable platform assistant foundation.

This work should deliver:

- one UI/protocol pattern for all future assistants;
- a production-ready path from editor preview prompt to validated `EditorChangeSet`;
- a server-side route for agent runtime and provider secrets;
- an assistant registry with explicit context and tool boundaries;
- a clear distinction between assistant state and canonical Cubica state.

## Architecture Baseline

This task implements ADR-043.

Relevant existing architecture:

- ADR-025: JSON Schema remains source of truth for manifest structures.
- ADR-030: authoring manifests compile into runtime manifests.
- ADR-036: preview-first editor and `EditorChangeSet` discipline.
- ADR-038: testing policy for deterministic and AI behavior.
- ADR-040: runtime mechanics must be manifest/platform capability first.
- ADR-042: editor sessions are versioned resources with lifecycle and cleanup.
- `docs/architecture/agent-ui-foundation.md`: project architecture for assistant UI.

Terms:

- CopilotKit - React/Next.js assistant UI framework.
- AG-UI - event protocol between user-facing app and AI agent backend.
- Human-in-the-loop - explicit user approval before a risky or mutating operation.

## Scope

In scope:

- add CopilotKit/AG-UI dependencies with pinned versions and telemetry configuration;
- create an app-local CopilotKit runtime route in `apps/editor-web`;
- introduce assistant registry metadata for `editor.authoring`;
- map current editor AI prompt context into CopilotKit context;
- expose initial editor tools through the assistant boundary:
  - plan change set;
  - dry-run change set;
  - apply change set;
  - undo last patch;
  - prepare preview;
  - save session after approval;
- keep the current local planner as the first backend behind the new boundary;
- add AG-UI event normalization or adapter tests where protocol events enter Cubica code;
- document future assistant registry entries for portal, facilitator, player and admin helpers.

Out of scope:

- replacing `editor-engine`;
- replacing `runtime-api` gameplay execution;
- adding marketplace plugin sandboxing;
- live production model quality evals as a required PR gate;
- player helper implementation before role/session data boundaries are explicit;
- portal payment or purchase automation beyond documented future tools.

## Non-Goals

- Do not use CopilotKit state as authoring or runtime state.
- Do not write assistant output directly to files.
- Do not bypass JSON Schema, semantic validation or plugin boundary checks.
- Do not put agent-only metadata into generated runtime manifests.
- Do not add game-specific runtime branches for assistant behavior.

## Execution Plan

### Phase 1. Dependency And Policy Gate

1. [x] Add pinned CopilotKit and AG-UI packages to `apps/editor-web`.
2. [x] Add a dependency note covering versions, license, telemetry and upgrade policy.
3. [x] Configure third-party telemetry disabled by default.
4. [x] Add CI or test coverage that makes dependency upgrades visible.

### Phase 2. Assistant Registry

1. [x] Define an `editor.authoring` assistant record.
2. [x] Include `agentId`, owner app, allowed context, allowed tools, side-effect policy, audit level and version.
3. [x] Add tests for registry shape and tool allowlist.
4. [x] Keep the shape ready for later extraction to `packages/contracts/ai`.

### Phase 3. Editor CopilotKit Shell

1. [x] Wrap the editor assistant surface with CopilotKit provider.
2. [x] Add `/api/copilotkit` route for editor-web.
3. [x] Keep the assistant disabled by default behind an environment flag until the first flow is validated.
4. [x] Add UI placement that does not replace Monaco, property panel or preview selection overlay.

### Phase 4. Context Projection

1. [x] Build scoped context from active file, selected preview entities, selected JSON pointers, diagnostics and preview trace summary.
2. [x] Redact forbidden fields and avoid whole-manifest payloads.
3. [x] Add tests for redaction and max context size.
4. [x] Add diagnostics when context is insufficient for a requested tool.

### Phase 5. Tool Adapter To Existing Editor Flow

1. [x] Implement `editor.planChangeSet` by calling the existing planner boundary first.
2. [x] Implement `editor.dryRunChangeSet` through existing `dryRunEditorChangeSet`.
3. [x] Implement `editor.applyChangeSet` only after dry-run success and journal creation.
4. [x] Implement `editor.undoLastPatch` through existing inverse change sets.
5. [x] Implement `editor.preparePreview` through existing session-aware preview route.
6. [x] Implement `editor.saveSession` behind human-in-the-loop approval.

### Phase 6. AG-UI Event Adapter

1. [x] Normalize run lifecycle, text, tool-call, state snapshot, state delta and error events into app UI state.
2. [x] Confirm AG-UI state deltas never apply directly to canonical Cubica state.
3. [x] Add contract tests for event normalization and rejected unsafe deltas.

### Phase 7. Provider Backend Replacement

1. [x] Keep the deterministic local planner as the first backend.
2. [ ] Add a production agent backend behind the same AG-UI boundary.
3. [ ] Add replay fixtures for representative editor prompts.
4. [ ] Add provider error handling, retries and user-facing diagnostics.

### Phase 8. Future Assistant Readiness

1. [x] Add registry stubs or documentation-only entries for portal, facilitator, player and admin assistants.
2. [x] Define their allowed context and forbidden tools.
3. [ ] Create follow-up tasks only after the editor assistant proves the foundation.

## Implementation Result

Implemented baseline:

- Pinned editor-web dependencies: CopilotKit `1.59.5`, AG-UI `0.0.53`, Zod `3.25.76`.
- Added disabled-by-default editor CopilotKit provider behind `NEXT_PUBLIC_CUBICA_EDITOR_AGENT_UI=1`.
- Added app-local `/api/copilotkit` route behind `CUBICA_EDITOR_AGENT_RUNTIME=1`.
- Added built-in local `/api/editor/agent/ag-ui` AG-UI backend for baseline/dev verification.
- Added optional external AG-UI backend connection through `CUBICA_EDITOR_AGENT_AG_UI_URL` and `CUBICA_EDITOR_AGENT_AG_UI_TOKEN`; external configuration overrides the local backend.
- Added a no-backend guard: when the CopilotKit shell is enabled but no AG-UI backend is available, editor-web shows connection status and does not mount `editor.authoring` hooks that require a registered runtime agent.
- Added `editor.authoring` registry and planned portal/facilitator/player/admin records.
- Added scoped context projection with redaction and selected-pointer limits.
- Registered editor frontend tools: plan, dry-run, apply, undo, preview and save.
- Kept mutating apply behind `approved=true`, `dryRunEditorChangeSet`, semantic/schema diagnostics and undo journal creation. This baseline rule is superseded by ADR-047: current code requires a Cubica approval envelope instead of trusting `approved=true`.
- Added AG-UI event normalization tests that mark unsafe canonical state deltas as rejected.

Deferred:

- External production agent backend implementation.
- Replay/eval fixtures for live model quality.
- Production audit hardening for the newly introduced dependency tree.

## Acceptance

1. ADR-043 and `docs/architecture/agent-ui-foundation.md` describe CopilotKit/AG-UI as the platform Agent UI foundation.
2. `apps/editor-web` can run a disabled-by-default CopilotKit assistant shell.
3. The editor assistant can produce a bounded `EditorChangeSet` through the existing planner boundary.
4. Applying assistant output still requires dry-run validation and undo journal recording.
5. The assistant does not receive whole large manifests or secrets.
6. AG-UI events are normalized without mutating canonical Cubica state.
7. Mutating tools require human approval where the side-effect policy says so.
8. Tests cover registry, context projection, tool allowlist and unsafe state delta rejection.
9. Documentation records how portal/player/facilitator/admin helpers will use the same foundation.
10. Local editor-web mode registers `editor.authoring` through the built-in AG-UI backend and does not throw `Agent not found` when `CUBICA_EDITOR_AGENT_AG_UI_URL` is absent.

## Validation

Planned validation commands:

```bash
npm run typecheck --workspace @cubica/editor-web
npm test --workspace @cubica/editor-web
npm run verify:editor-engine
npm run verify:manifest-authoring
git diff --check
```

Manual checks:

- Open editor with assistant flag disabled and verify no UI/runtime behavior changes.
- Enable assistant flag locally and verify prompt -> change set -> dry-run -> apply -> undo.
- Confirm assistant context contains only selected pointers and diagnostics, not full manifests.
- Confirm telemetry settings are disabled unless explicitly enabled.

## Artifacts

- `docs/architecture/adrs/043-copilotkit-ag-ui-agent-ui-foundation.md` - architecture decision.
- `docs/architecture/agent-ui-foundation.md` - project architecture document.
- `docs/tasks/archive/TSK-20260609-copilotkit-ag-ui-agent-ui-foundation.md` - this execution plan.

## Handoff Log

### 2026-06-09 — Codex Implementation Baseline

- Changed:
  - `apps/editor-web/package.json`
  - `package-lock.json`
  - `apps/editor-web/app/api/copilotkit/route.ts`
  - `apps/editor-web/app/api/copilotkit/.desc.json`
  - `apps/editor-web/app/client.tsx`
  - `apps/editor-web/app/layout.tsx`
  - `apps/editor-web/app/globals.css`
  - `apps/editor-web/src/components/editor-agent-ui.tsx`
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `apps/editor-web/src/lib/agent-assistant-registry.ts`
  - `apps/editor-web/src/lib/agent-context-projection.ts`
  - `apps/editor-web/src/lib/ag-ui-event-adapter.ts`
  - `apps/editor-web/src/lib/agent-assistant-registry.test.ts`
  - `apps/editor-web/src/lib/agent-context-projection.test.ts`
  - `apps/editor-web/src/lib/ag-ui-event-adapter.test.ts`
  - `docs/architecture/agent-ui-foundation.md`
- Validation:
  - `npm run typecheck --workspace @cubica/editor-web` - OK.
  - `npm test --workspace @cubica/editor-web` - OK, 16 files / 67 tests.
  - `npm run build --workspace @cubica/editor-web` - OK; `/api/copilotkit` is present in the App Router route table.
  - `npm run verify:editor-engine` - OK, 1 file / 29 tests.
  - `npm run verify:manifest-authoring` - OK.
  - `node scripts/dev/generate-structure.js` - OK, regenerated `PROJECT_STRUCTURE.yaml`.
  - `git diff --check` - OK.
- Done: implemented the disabled-by-default editor assistant foundation, scoped context, frontend tool adapter and AG-UI event adapter.
- Remaining: implement a production AG-UI agent backend, replay/eval fixtures and production dependency audit remediation as follow-up work.
- Risks: `npm install` reports 18 dependency audit findings in the expanded CopilotKit/runtime tree; production enablement needs an explicit audit review.

### 2026-06-10 — Local AG-UI Backend Wiring

- Changed:
  - `apps/editor-web/package.json`
  - `package-lock.json`
  - `apps/editor-web/app/api/copilotkit/route.ts`
  - `apps/editor-web/app/api/editor/agent/.desc.json`
  - `apps/editor-web/app/api/editor/agent/ag-ui/.desc.json`
  - `apps/editor-web/app/api/editor/agent/ag-ui/route.ts`
  - `apps/editor-web/src/lib/editor-agent-local-backend.ts`
  - `apps/editor-web/src/lib/editor-agent-local-backend.test.ts`
  - `docs/architecture/agent-ui-foundation.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `PROJECT_OVERVIEW.md`
  - `NEXT_STEPS.md`
  - `PROJECT_STRUCTURE.yaml`
- Validation:
  - `npm run typecheck --workspace @cubica/editor-web` - OK.
  - `npm test --workspace @cubica/editor-web` - OK, 17 files / 70 tests.
  - `npm run build --workspace @cubica/editor-web` - OK; `/api/editor/agent/ag-ui` is present in the App Router route table.
  - `node scripts/dev/generate-structure.js` - OK, regenerated `PROJECT_STRUCTURE.yaml`.
  - `git diff --check` - OK.
  - Manual HTTP verification: `/api/copilotkit` returns `agUiBackendConfigured: true`, `agUiBackendMode: "local"`; `/api/editor/agent/ag-ui` streams AG-UI SSE events and tool calls.
  - Manual browser verification: CopilotKit chat opens without `Backend missing`; a user message reaches the local AG-UI backend, calls `editor.planChangeSet`, and returns the tool result to the chat.
- Done: configured a built-in deterministic local AG-UI backend for `editor.authoring`; external production backends can still override it with `CUBICA_EDITOR_AGENT_AG_UI_URL`.
- Remaining: replace the deterministic local backend with a production LLM-backed AG-UI service when model provider, authentication and evaluation gates are ready.

### 2026-06-09 — Codex

- Changed:
  - `docs/architecture/adrs/043-copilotkit-ag-ui-agent-ui-foundation.md`
  - `docs/architecture/agent-ui-foundation.md`
  - `docs/tasks/archive/TSK-20260609-copilotkit-ag-ui-agent-ui-foundation.md`
  - `PROJECT_OVERVIEW.md`
  - `PROJECT_STRUCTURE.yaml`
  - `docs/architecture/.desc.json`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `docs/architecture/README.md`
  - `docs/tasks/STRATEGY.md`
  - `docs/tasks/active/.desc.json`
  - `NEXT_STEPS.md`
- Validation:
  - `node scripts/dev/generate-structure.js` - OK, regenerated `PROJECT_STRUCTURE.yaml`.
  - `git diff --check` - OK.
- Done: captured the accepted architecture and prepared executable implementation phases.
- Remaining: implement the assistant shell and adapter layers.
- Next: start with Phase 1 dependency/policy gate and Phase 2 assistant registry.
- Risks: CopilotKit/AG-UI version churn and accidental use of assistant state as domain state.
