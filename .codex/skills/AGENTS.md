# AGENTS for `.codex/skills`

## Scope

These rules apply to everything under `.codex/skills/`.

## Local Priority Rules

- `new-workflow_V2.md` is the workflow source of truth for this subtree.
- If workflow files conflict, `new-workflow_V2.md` overrides `new-workflow.md`, archived skill packs, and older role hierarchies.
- Generic workflow behavior belongs in the `wf-*` skills.
- Cubica-specific repository rules belong in `cubica-project-context`.

## Role Hierarchy

- Architect is `L1`: owns planning, architecture, block selection, and post-acceptance progression.
- Orchestrator is a long-lived execution router: it follows the architect plan mechanically and does not rewrite it.
- PM is `L2`: owns test validation, block acceptance, and the decision packet back to Architect.
- Executor is `L3`: implements bounded tasks inside explicit file and test limits.
- Data Analyst and Web Analyst are specialist support roles used only through explicit contracts.

## Editing Rules

- Keep one skill per role directory.
- Keep `SKILL.md` concise and procedural.
- Keep reusable artifact schemas in `_shared/references/`.
- When `SKILL.md` changes, also check whether any local examples or templates in the same skill subtree need updates.

## Documentation Sync

- If this subtree changes structurally, update `PROJECT_STRUCTURE.json` and `repo-manifest.json`.
- If the workflow hierarchy changes, update this file and the affected skill files together.
