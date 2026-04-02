---
name: cubica-project-context
description: Cubica-specific project context skill. Adds repository truth model, read order, canonical boundaries, and documentation rules to the generic workflow roles.
---

# Cubica Project Context

## Use When

Use this skill together with the generic `wf-*` role skill whenever the task is inside the Cubica repository.

**Always use Context7 MCP when you need planning, library/API documentation, code generation, setup or configuration steps to get up-to-date documentation and best practices**

## Workflow Fit With `wf-*` Skills

This skill is a project-specific overlay for the generic `wf-*` workflow roles. It must not override the role boundaries defined by `wf-architect`, `wf-orchestrator`, `wf-executor*`, and `wf-pm*`.

- Architect owns: block selection, methodology choice, architecture decisions, and ADR requirements.
- Orchestrator owns: mechanical routing and artifact/run-log hygiene (no plan rewriting).
- Executor owns: `task_acceptance`.
- PM owns: `block_acceptance`.

## Project-Specific Workflow Examples

When bootstrapping a new Cubica block, reuse the local examples before inventing a plan shape from scratch:

- `references/architect-plan.cubica-example.json` for a realistic Cubica `ARCHITECT_PLAN.json`;
- `references/slice-export-spec.cubica-example.json` for the matching task-materialization contract.

Treat them as starting points only. Replace the block goal, file scopes, tests, docs, and runtime bindings with the needs of the current block.

Before `ARCHITECT_PLAN.json`, the Architect must also produce a user-facing `BLOCK_BRIEF.md` and wait for user feedback or approval on the block and proposed architecture.

Block workspace location rule:

- First, use `PROJECT_WORKFLOW_CONFIG.json` paths as the source of truth.
- If the project config does not define block paths, fall back to the shared workflow recommendation: `workflow/{block_id}/` in the project root.
- Do not create a new workflow root directory (for example `workflow/`) “just in case” when the project config points elsewhere.

## Settings Resolution

Look for project-local workflow settings in `PROJECT_WORKFLOW_CONFIG.json` first.

If a needed setting is absent there, fall back to these local Cubica references and then to the shared workflow references.

For an active block, explicit `ARCHITECT_PLAN.json`, `task-packets/*.json`, and task-level overrides are stronger than project-local defaults.

## Startup Read Order

Read these first:

1. `AGENTS.md`
2. `PROJECT_OVERVIEW.md`
3. `PROJECT_STRUCTURE.json`
4. `docs/architecture/PROJECT_ARCHITECTURE.md`
5. `repo-manifest.json`
6. `NEXT_STEPS.md`
7. `new-workflow_V2.md`
8. `services/runtime-api/HANDOFF.md` when runtime behavior matters

## Cubica Truth Model

- executable game logic lives in `games/<id>/game.manifest.json`;
- UI intent comes from `games/<id>/design/mockups/`;
- shared contracts live in `packages/contracts/*`;
- canonical runnable slice is `services/runtime-api/` plus `apps/player-web/`;
- code, tests, and validation beat prose when they disagree.

## Cubica Non-Truth Zones

- `draft/*` is reference-only unless a document explicitly says it is a factual extraction source;
- `draft/antarctica-nextjs-player/` is UI reference only;
- `draft/Antarctica/GameFull.html` is a factual extraction source during migration, not a runtime source of truth;
- `draft/Antarctica/README.md` is a legacy mechanics reference, not a source of truth;
- placeholder services are target direction, not current runtime reality.

## Documentation Rules

- update `PROJECT_STRUCTURE.json` for structural changes;
- update `repo-manifest.json` when artifact authority changes;
- write ADRs only for stable project architecture decisions;
- put delivery-specific gameplay migration details into Gameplay Slice Records, not ADRs.

## Cubica-Specific Guardrails

- do not introduce a generic engine, DSL, selector system, or reusable abstraction without a proven repeat use case;
- do not promote draft artifacts into source-of-truth status;
- do not let `apps/player-web` read `games/*` directly as runtime truth when backend ownership is expected.

## Delegation And Reasoning Defaults

These defaults should match (not fight) the active `role_runtime_bindings` from `PROJECT_WORKFLOW_CONFIG.json` and from the current block plan:

- Architecture planning and risky diff review: built-in Codex subagents with `high` reasoning effort.
- Code-writing implementation slices: prefer the `minimax-coding-plan/MiniMax-M2.7` implementation worker when available (the project default is typically `droid`).
- Use an extra high-review worker only for genuinely risky or non-trivial bounded diffs; final review stays with the main agent.
- Use `medium` reasoning effort for normal bounded implementation; use `low` only for small mechanical follow-ups.

## External CLI Notes (Droid / Gemini)

- **Droid model id:** Use the exact model names that `droid` reports as available (for example `MiniMax-M2.7`). Do not assume registry-style prefixes like `minimax-coding-plan/...` are accepted by the CLI.
- **Gemini approval mode:** If Gemini must write workflow artifacts into `.tmp/agent-workflow/...`, `--approval-mode plan` may restrict writes to `~/.gemini/tmp/.../plans`. Prefer `auto_edit` while keeping prompts explicitly “do not edit code files”, or have Orchestrator copy artifacts from the plans directory when plan-mode is required.

## Verification Shortcuts

Use the smallest safe check loop first, then escalate to broader verification as needed:

- `npm run verify:runtime-api`
- `npm run verify:player-web`
- `npm run verify:canonical`

## Temporary Workflow Artifacts

For Cubica, temporary orchestration artifacts should live outside committed product paths.

Preferred pattern:

- keep workflow plans, reviews, reports, and temporary task packets under the block workspace configured by `PROJECT_WORKFLOW_CONFIG.json`;
- keep `ORCHESTRATOR_RUN_LOG.jsonl` near that block workspace;
- if a repository-specific exception requires another storage location, document it explicitly in the relevant local workflow settings file and in the current `ARCHITECT_PLAN.json`;
- keep committed source artifacts such as `ARCHITECT_PLAN.json`, `SLICE_EXPORT_SPEC.json`, and any durable architecture or planning docs in tracked workflow paths only when the current process explicitly requires them.

Rules:

- task packets (`task-packets/*.json`) are temporary and should not be committed;
- after PM acceptance, accepted task packets should be removed;
- the Architect should define the exact temp locations before the Orchestrator starts dispatching work;
- if those locations are not defined, the Orchestrator should escalate back to Architect instead of inventing them.

## Workflow Priority

- `new-workflow_V2.md` is the current workflow source of truth for this repository-local skill set.
- `new-workflow.md` is superseded for active skill design.
