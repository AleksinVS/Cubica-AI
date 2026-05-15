# Game Authoring Guide

This guide explains how to author game logic in Cubica manifests using the **Three-Tier Logic Model** (Ladder of Power) defined in [ADR-029](adrs/029-three-tier-logic-model-ladder-of-power.md).

## Table of Contents

- [Overview](#overview)
- [Tier 1: Action Templates](#tier-1-action-templates)
  - [Defining Templates](#defining-templates)
  - [Referencing Templates from Actions](#referencing-templates-from-actions)
  - [Parameter Substitution](#parameter-substitution)
  - [Action-Specific Overrides](#action-specific-overrides)
  - [Guard Evaluation](#guard-evaluation)
  - [State Updates](#state-updates)
- [Tier 2: JsonLogic Expressions](#tier-2-jsonlogic-expressions)
  - [Guard Conditions](#guard-conditions)
  - [Computed Metric Deltas](#computed-metric-deltas)
- [Tier 3: Script Actions](#tier-3-script-actions)
- [Manifest Schema Reference](#manifest-schema-reference)

---

## Overview

The Three-Tier Logic Model organizes game logic by complexity:

| Tier | Mechanism | Use Case | Coverage |
|------|-----------|----------|----------|
| **Tier 1** | Action Templates | Reusable deterministic patterns with per-action parameters | ~80% of actions |
| **Tier 2** | JsonLogic | Declarative conditional expressions for guards and computed values | ~15% of actions |
| **Tier 3** | Script Actions | Custom JavaScript for complex interactions | ~5% of actions |

Each tier is strictly more powerful than the previous one. Prefer the lowest tier that satisfies your requirements.

---

## Tier 1: Action Templates

Templates define reusable deterministic action structure. Actions reference a template and provide action-specific values via `params` and `overrides`.

### Defining Templates

Templates live in the `templates` section of the manifest (sibling to `actions`):

```json
{
  "templates": {
    "opening-card-resolution": {
      "deterministic": {
        "guard": {
          "timeline": {
            "line": "main",
            "stepIndex": "{{stepIndex}}",
            "canAdvance": false
          }
        },
        "metricDeltas": [],
        "log": {
          "kind": "opening-card-resolution",
          "stageId": "stage_intro",
          "cardId": "{{cardId}}",
          "summary": "{{summary}}"
        },
        "stateUpdate": {
          "timelineCanAdvance": false,
          "cardFlags": {
            "cardId": "{{cardId}}",
            "selected": true,
            "resolved": true
          }
        }
      }
    }
  }
}
```

A template defines only the `deterministic` block. Action-level metadata (`handlerType`, `capabilityFamily`, `tags`, etc.) stays on each action.

### Referencing Templates from Actions

Actions reference templates via `templateId`:

```json
{
  "actions": {
    "opening.card.1": {
      "handlerType": "manifest-data",
      "templateId": "opening-card-resolution",
      "capabilityFamily": "antarctica.opening",
      "capability": "antarctica.opening.card.1",
      "displayName": "Select card 1",
      "description": "First card in the opening",
      "tags": ["antarctica", "opening", "legacy-card", "deterministic"],
      "params": {
        "cardId": "1",
        "stepIndex": 9,
        "summary": "Card 1 description"
      }
    }
  }
}
```

### Parameter Substitution

Parameters are substituted into template strings using `{{paramName}}` syntax:

- **Full-value substitution**: `"{{cardId}}"` — replaces the entire string with the parameter value
- **Inline substitution**: `"Card {{cardId}} selected"` — embeds the parameter within a string
- **Nested paths**: Parameters can be used inside nested objects and arrays

```json
"params": {
  "cardId": "1",
  "stepIndex": 9,
  "nextStepIndex": 10,
  "summary": "Description of the action"
}
```

### Action-Specific Overrides

When an action needs fields not in the template, use `overrides.deterministic`:

```json
{
  "actions": {
    "opening.card.3": {
      "handlerType": "manifest-data",
      "templateId": "opening-card-resolution",
      "capabilityFamily": "antarctica.opening",
      "capability": "antarctica.opening.card.3",
      "params": {
        "cardId": "3",
        "stepIndex": 9,
        "summary": "Card 3 description"
      },
      "overrides": {
        "deterministic": {
          "guard": {
            "opening": { "selectedCardIdAbsent": true }
          },
          "metricDeltas": [
            { "metricId": "pro", "delta": 5 },
            { "metricId": "rep", "delta": -2 }
          ]
        }
      }
    }
  }
}
```

**Merge behavior**: Action `overrides.deterministic` is deep-merged on top of the resolved template:
- Top-level fields (`metricDeltas`, `conditionalMetricBonuses`, `conditionalLineSwitch`) replace template values
- `guard` and `stateUpdate` are deep-merged (action fields override individual keys)

### Guard Evaluation

Guards are preconditions that must pass for an action to execute. The runtime evaluates these guard types:

| Guard Key | Description | Example |
|-----------|-------------|---------|
| `timeline` | Timeline state checks | `{ "line": "main", "stepIndex": 9, "canAdvance": false }` |
| `board` | Board card resolution count | `{ "cardIds": ["1","2","3"], "resolvedCountAtLeast": 2 }` |
| `card` | Individual card state | `{ "id": "1", "selected": false, "resolved": false }` |
| `opening` | Selected card ID checks | `{ "selectedCardIdAbsent": true }` or `{ "selectedCardIdEquals": "3" }` |
| `team` | Team member selection state | `{ "memberId": "fedya", "selected": false }` |
| `teamSelection` | Team pick count | `{ "pickCountLessThan": 5 }` or `{ "pickCountEquals": 5 }` |
| `stateConditions` | Generic path-based state checks | `[{ "path": "public/flags/cards/1/selected", "operator": "==", "value": true }]` |
| `jsonLogic` | Tier 2 JsonLogic expression | See [Tier 2](#tier-2-jsonlogic-expressions) |

All guard types in a single guard object must pass (logical AND).

### State Updates

State updates modify the game state after an action executes. Common state update fields:

| Field | Description |
|-------|-------------|
| `timelineCanAdvance` | Whether the timeline can advance |
| `timelineStepIndex` | Next timeline step index |
| `timelineStageId` | Timeline stage identifier |
| `timelineScreenId` | Timeline screen identifier |
| `activeInfoId` | Currently active info panel |
| `selectedCardId` | Card selected in secret state |
| `cardFlags` | Update card state (`{ cardId, selected, resolved, locked, available }`) |
| `teamFlags` | Update team member state (`{ memberId, selected }`) |
| `teamSelection` | Update team selection (`{ pickCountDelta, selectedMemberIdsAppend }`) |

---

## Tier 2: JsonLogic Expressions

For conditions that can't be expressed with hardcoded guard keys, use [JsonLogic](https://jsonlogic.com/) expressions.

### Guard Conditions

Add a `jsonLogic` field to the guard:

```json
{
  "guard": {
    "timeline": { "line": "main", "stepIndex": 23, "canAdvance": false },
    "jsonLogic": {
      "and": [
        { ">": [{ "var": "public.metrics.pro" }, 25] },
        { "<": [{ "var": "public.metrics.time" }, 50] }
      ]
    }
  }
}
```

The `var` operator accesses the runtime state using dot-delimited paths (e.g., `public.metrics.pro`).

### Computed Metric Deltas

Metric delta values can be JsonLogic expressions:

```json
{
  "metricDeltas": [
    {
      "metricId": "score",
      "delta": {
        "*": [{ "var": "public.metrics.pro" }, 2]
      }
    }
  ]
}
```

This computes `score += pro * 2` dynamically based on the current state.

### Available Operators

Standard JsonLogic operators are available: `var`, `if`, `==`, `!=`, `>`, `<`, `>=`, `<=`, `and`, `or`, `not`, `+`, `-`, `*`, `/`, `%`, `in`, `cat`, `substr`, `log`, `merge`, `map`, `filter`, `reduce`, `all`, `none`, `some`.

---

## Tier 3: Script Actions

Script actions are capability triggers for complex interactions that can't be expressed declaratively. They are defined with `handlerType: "script"`:

```json
{
  "actions": {
    "showHint": {
      "handlerType": "script",
      "capabilityFamily": "ui.panel",
      "capability": "ui.panel.hint",
      "function": "showHint"
    }
  }
}
```

Script actions are **capability triggers**, not sandboxed user scripts. They signal the runtime to perform a specific operation (show UI panel, request server action, etc.).

---

## Manifest Schema Reference

The full JSON Schema is at [`docs/architecture/schemas/game-manifest.schema.json`](schemas/game-manifest.schema.json).

Key schema types:
- `GameManifest` — root manifest structure
- `GameManifestActionDefinition` — action definition with optional `templateId` and `overrides`
- `GameManifestTemplateDefinition` — template definition (like action but `handlerType` not required)
- `GameManifestDeterministicGuard` — guard conditions (timeline, board, card, opening, team, teamSelection, stateConditions, jsonLogic)
- `GameManifestDeterministicActionMetadata` — full deterministic action metadata
- `JsonLogicExpression` — recursive JsonLogic operator expression
