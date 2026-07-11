# AGENTS for `.codex/skills`

## Contents

- [Scope](#scope)
- [Canonical Workflow](#canonical-workflow)
- [Explicit Activation](#explicit-activation)
- [Skill Rules](#skill-rules)
- [Archived Workflow](#archived-workflow)

## Scope

These rules apply to everything under `.codex/skills/`.

## Canonical Workflow

- The project-local `cubica/SKILL.md` is the workflow entry point for Cubica development.
- ADR-068 and `docs/tasks/README.md` define the durable plan, authority, and task hierarchy.
- Repo-local skills must not reintroduce `ARCHITECT_PLAN`, separate PM/Executor acceptance, or another durable planning hierarchy.

## Explicit Activation

- Use `cubica/SKILL.md` only when the user explicitly invokes `$cubica` or explicitly asks to apply the Cubica autonomous workflow.
- Request similarity, task complexity, or agent preference must not activate `$cubica` automatically.
- Other skills, including project-local skills imported or adapted from `agent-skills` or `superpowers`, retain their normal automatic trigger behavior unless their own contract says otherwise.

## Skill Rules

- Keep each `SKILL.md` concise, procedural, and project-specific.
- Use repository documents as canonical context instead of copying architecture into the skill.
- Adapt external skills through `external-skill-adapter`: keep exact upstream snapshots outside the active skill tree, materialize a clean project-owned version, and record reusable lessons in the adaptation memory.
- Deterministic adapter scripts collect signals and validate structure; the adapting agent owns semantic compatibility and may read targeted project context when needed.
- Store temporary subagent briefs and review packages under `.tmp/agent-workflow/`.
- Keep reusable external-agent runners in the shared `cli-subagents` skill; do not copy them into this subtree.
- When a workflow rule changes, update the skill, root agent instructions, task-system documentation, ADR, and `PROJECT_ARCHITECTURE.md` together.

## Archived Workflow

The former shared `$cubica` and `wf-*` role hierarchy is historical. Its snapshot lives under `archive/agent-workflows/wf-cubica-2026-07-10/` and must not govern files in this subtree.
