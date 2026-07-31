# ADR-028: Action Templates for Compact Manifests

**Date:** 2026-05-13
**Status:** Superseded by ADR-084
**Authors:** Senior SE (Gemini CLI)

> Это историческое решение не является действующим контрактом исполнения.
> Runtime-шаблоны, `{{...}}`-подстановки и `deterministic.effects[]` удалены при
> переходе на Game Intent → типизированный Mechanics IR. Повторное
> использование в authoring допускается только как build-time макрос, который
> полностью раскрывается и проверяется до публикации.

## Context

Large manifests may repeat structurally identical action definitions that differ
only by bounded parameters. Repetition increases authoring cost and obscures the
semantic intent of an action.

This redundancy has several negative consequences:
1. **Context Bloat:** Large manifests consume significant tokens in LLM context windows, leading to attention degradation and errors during AI-assisted development.
2. **Maintainability:** Updating a shared logic pattern requires hundreds of manual edits.
3. **Readability:** It is difficult for humans and AI agents to see the "forest" for the "trees" when the manifest is dominated by boilerplate.

## Decision

The historical decision introduced **Action Templates** (macros): named reusable
action fragments referenced through `templateId` with bounded `params`.

The intended invariants were:

- template references and parameters are validated by the manifest schema;
- expansion is deterministic and produces an ordinary action definition;
- an action-level value takes precedence over the corresponding template value;
- placeholders may reference only declared parameters;
- expansion does not grant access to the environment or introduce hidden runtime
  side effects.

ADR-084 supersedes runtime template resolution. The reusable authoring concept
remains permitted only as a build-time macro that expands completely into typed
Mechanics IR before publication.

## Consequences

**Positive:**
- **Size Reduction:** Repetitive flows can be represented more compactly during authoring.
- **Improved AI Performance:** Agents will have more room in their context window and a clearer understanding of game logic.
- **Standardization:** Common patterns like "advance step" or "apply metric delta" will be centralized and easier to evolve.

**Negative:**
- **Indirection:** Understanding a single action now requires looking up its template.
- **Tooling Cost:** Authoring tooling must expand and validate macros before publication.
