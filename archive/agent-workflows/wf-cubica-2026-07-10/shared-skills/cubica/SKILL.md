---
name: cubica
description: Orchestrates Cubica work with AI-first + Code-first rules, canonical sources, and subagent-driven implementation.
---

# Cubica

## Use When

Use this skill as a high-level wrapper for Cubica work.

If the user explicitly invokes a workflow role skill (`wf-architect`, `wf-orchestrator`, `wf-executor*`, `wf-pm*`), follow the invoked `wf-*` contract and use the project overlay `cubica-project-context` for Cubica-specific truth rules and read order.

## Operating Rules

Cubica is AI-first and Code-first.

- Source of truth for executable game logic is `games/<id>/game.manifest.json`.
- UI intent comes from game mockups.
- Shared contracts live in `packages/contracts/*`.
- The canonical runnable slice is `runtime-api` plus `player-web`.
- `draft/antarctica-nextjs-player` is only a rough UI prototype and is not a runtime or architecture reference.
- `draft/Antarctica/README.md` is only a legacy mechanics reference and is not a source of truth.
- Code, contracts, tests, and validation beat prose when they disagree.
- `docs/architecture/adrs/*` are only for stable project architecture decisions, constraints, rejected alternatives, and consequences.
- ADRs must not be used as execution plans, slice trackers, next-step lists, or card-by-card migration specs.
- Delivery-specific bounded gameplay details belong in Gameplay Slice Records under `docs/architecture/gameplay-slices/`.
- Use built-in Codex subagents for architecture work, decomposition of large tasks, and review of risky diffs.
- Use `high` reasoning effort for those built-in Codex architecture subagents.
- Use `opencode` subagents with model `minimax-coding-plan/MiniMax-M2.7` for code implementation slices.
- Use an `opencode` high-review worker only for risky or non-trivial slices that benefit from an additional bounded review pass. Final pre-commit review still belongs to the main agent.
- Use `medium` reasoning effort by default for bounded implementation slices unless a task clearly needs more depth.
- Use `low` reasoning effort only for simple mechanical follow-up edits.

## Workflow Alignment (`wf-*`)

When working in the structured `wf-*` workflow:

- Architect owns: block selection, methodology choice, architecture decisions, ADR requirements.
- Orchestrator owns: mechanical routing and artifact/run-log hygiene (no plan rewriting).
- Executor owns: `task_acceptance`.
- PM owns: `block_acceptance`.

## Delivery Workflow

1. Set architecture constraints first.
2. Pick one bounded slice.
3. Before delegating a major multi-step task, start a fresh built-in Codex subagent session with only the minimum necessary context. Define the input artifacts, output artifacts, boundaries, acceptance criteria, and verification expectations up front.
4. Reuse an existing subagent session only for follow-up work in the same bounded slice. Treat it as the same slice only if ownership, write-scope, and target module stay materially the same.
5. If ownership, write-scope, or target module changes, start a new subagent session instead of continuing the old thread.
6. When delegating implementation, instruct the subagent to use Context7 MCP to fetch up-to-date framework documentation and current best practices whenever the slice depends on library or framework behavior.
7. Use built-in Codex subagents for architecture analysis. Use `opencode` subagents with model `minimax-coding-plan/MiniMax-M2.7` for code-writing implementation slices.
8. When a slice is risky or non-trivial, run an `opencode` high-review worker on the bounded diff before the main-agent review. Skip this for small mechanical, obvious, or well-covered slices.
9. Review the resulting diff as the architect and final reviewer.
10. If review finds issues, rerun the appropriate subagent before committing.
11. Update the relevant project documentation after each slice so docs, handoff notes, gameplay slice records, ADRs, and next-step plans stay aligned with the code.
12. Update ADRs only when the stable project architecture changes. Put step-scoped gameplay mechanics, migration boundaries, and bounded delivery details into Gameplay Slice Records instead.
13. After each completed slice, write a compact context checkpoint with the decisions made, files changed, verification result, remaining risks, and the next step. Perform full context compaction before the next major slice, after architectural pivots, or when handing work to another agent or runtime.
14. After each full context compaction, re-read the nearest `AGENTS.md` and, for Cubica work, re-read the `$cubica` skill file before continuing planning, implementation, or review.
15. Verify with tests, typechecks, smoke checks, and contract validation.
16. Commit the slice separately.
17. Do not stop after a successful slice. Immediately set the next active bounded slice and continue unless a major architectural decision, a required user clarification, or a hard non-local blocker makes continuation unsafe.

## Review Checklist

- Canonical sources stayed canonical.
- No draft artifact was promoted to source-of-truth status.
- Contracts did not drift from runtime behavior.
- Relevant project documentation was updated for the slice.
- Tests cover the changed boundary.
- The change is small enough to isolate in one commit.

## Role Split

- Main agent: orchestrator, architect, reviewer, and final decision-maker for architecture and commit readiness.
- Built-in Codex subagents: support architecture work as analysts, using Context7 MCP when current library or framework guidance matters.
- `opencode` subagents with model `minimax-coding-plan/MiniMax-M2.7`: write and repair code within the bounded slice.
- `opencode` high-review worker: performs additional and intermediate reviews of bounded diffs only for risky or non-trivial slices before the main-agent review.
- Built-in Codex subagents may support architecture work only as analysts: they can gather facts, compare options, and analyze a bounded area, but they do not make the final architectural decision.
- `opencode` high-review workers may support review as an additional focused review layer, but they do not replace the final review by the main agent.
- The main agent should prefer orchestration and review over direct implementation.
