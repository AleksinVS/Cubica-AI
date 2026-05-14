# ADR-028: Action Templates for Compact Manifests

**Date:** 2026-05-13
**Status:** Proposed
**Authors:** Senior SE (Gemini CLI)

## Context

The current `game.manifest.json` for complex games like Antarctica is extremely large (over 9000 lines). A significant portion of this size comes from repetitive action definitions, especially deterministic transitions between info screens or board steps. These actions often share the same `handlerType`, `guard` patterns, `stateUpdate` shapes, and `log` structures, differing only in specific parameters like `stepIndex` or text messages.

This redundancy has several negative consequences:
1. **Context Bloat:** Large manifests consume significant tokens in LLM context windows, leading to attention degradation and errors during AI-assisted development.
2. **Maintainability:** Updating a shared logic pattern requires hundreds of manual edits.
3. **Readability:** It is difficult for humans and AI agents to see the "forest" for the "trees" when the manifest is dominated by boilerplate.

## Decision

We will implement **Action Templates** (also referred to as Macros) to allow defining reusable logic patterns within the manifest.

### 1. Root `templates` Section
Add a `templates` section to the root of the `GameManifest`. This section will store reusable action fragments.

```json
{
  "templates": {
    "advance_step": {
      "handlerType": "manifest-data",
      "deterministic": {
        "guard": {
          "timeline": { "line": "main", "stepIndex": "{{current}}", "canAdvance": false }
        },
        "stateUpdate": { "timelineStepIndex": "{{next}}" },
        "log": {
          "kind": "opening-info-advance",
          "stageId": "stage_intro",
          "summary": "{{summary}}"
        }
      }
    }
  }
}
```

### 2. Template Reference in Actions
Actions can now reference a template using `templateId` and provide a `params` object for variable substitution.

```json
"actions": {
  "opening.info.i02.advance": {
    "templateId": "advance_step",
    "params": {
      "current": 1,
      "next": 2,
      "summary": "Интро i02 завершено, переход к i03."
    }
  }
}
```

### 3. Resolution Logic
The `runtime-api` engine will resolve templates at execution time (or loading time).
- If an action has a `templateId`, the engine retrieves the template from the manifest.
- It performs a deep merge of the template over the action definition (action fields take precedence).
- It substitutes placeholders in the format `{{paramName}}` using the values provided in `params`.
- The resolved action is then processed normally.

### 4. Schema Updates
The JSON schema for `game.manifest.json` will be updated to include the `templates` section and the new fields in `GameManifestActionDefinition`.

## Consequences

**Positive:**
- **Massive Size Reduction:** We expect a 5-10x reduction in manifest size for repetitive flows.
- **Improved AI Performance:** Agents will have more room in their context window and a clearer understanding of game logic.
- **Standardization:** Common patterns like "advance step" or "apply metric delta" will be centralized and easier to evolve.

**Negative:**
- **Indirection:** Understanding a single action now requires looking up its template.
- **Implementation Overhead:** The `runtime-api` needs logic for template resolution and parameter substitution.

## Implementation Plan

1. **Contracts:** Update `@cubica/contracts-manifest` with `templates` and `templateId`/`params`.
2. **Schema:** Update `game-manifest.schema.json`.
3. **Runtime API:**
    - Update `manifestActions.ts` to expose template info.
    - Update `deterministicHandlers.ts` to resolve templates before applying logic.
4. **Verification:** Add a test case with a templated action.
5. **Refactoring:** (Optional/Later) Migrating Antarctica to use these templates.
