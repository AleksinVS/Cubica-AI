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
  - [State Effects](#state-effects)
- [Tier 2: JsonLogic Expressions](#tier-2-jsonlogic-expressions)
  - [Guard Conditions](#guard-conditions)
  - [Computed Metric Changes](#computed-metric-changes)
- [Tier 3: Declarative Effects](#tier-3-declarative-effects)
- [Gameplay Object State](#gameplay-object-state)
- [Manifest Schema Reference](#manifest-schema-reference)

---

## Overview

The Three-Tier Logic Model organizes game logic by complexity:

| Tier | Mechanism | Use Case | Coverage |
|------|-----------|----------|----------|
| **Tier 1** | Action Templates | Reusable deterministic patterns with per-action parameters | ~80% of actions |
| **Tier 2** | JsonLogic | Declarative conditional expressions for guards and computed values | ~15% of actions |
| **Tier 3** | Declarative Effects | Schema-validated UI/runtime effects for interactions that are not covered by templates alone | ~5% of actions |

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
        "effects": [
          { "op": "timeline.set", "canAdvance": false },
          {
            "op": "flag.set",
            "path": "/public/flags/cards/{{cardId}}",
            "values": { "selected": true, "resolved": true }
          },
          {
            "op": "log.append",
            "kind": "opening-card-resolution",
            "stageId": "stage_intro",
            "cardId": "{{cardId}}",
            "summary": "{{summary}}"
          }
        ]
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
      "capabilityFamily": "game.card.resolve",
      "capability": "game.card.resolve",
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
      "capabilityFamily": "game.card.resolve",
      "capability": "game.card.resolve",
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
          "effects": [
            { "op": "metric.add", "metricId": "pro", "delta": 5 },
            { "op": "metric.add", "metricId": "rep", "delta": -2 }
          ]
        }
      }
    }
  }
}
```

**Merge behavior**: Action `overrides.deterministic` is deep-merged on top of the resolved template:
- `guard` is deep-merged, so action fields override individual guard keys.
- `effects[]` is concatenated in order: template effects first, then action-specific effects.
- When a journal entry must include metric snapshots, put `metric.add` effects before `log.append` and set `auditMetrics: true` on `log.append`.

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

### State Effects

State changes are expressed only through `effects[]`. The runtime validates every operation against the JSON Schema before applying it.

| Effect | Description |
|-------|-------------|
| `timeline.set` | Set timeline fields such as `stepIndex`, `stageId`, `screenId`, `activeInfoId`, `canAdvance` |
| `state.patch` | Apply small JSON Patch-like changes under `/public` or `/secret` |
| `flag.set` | Update a named flags object, for example `/public/flags/cards/1` |
| `counter.add` | Add a number to a counter |
| `collection.append` | Append an item to an array |
| `metric.add` | Add to a numeric metric |
| `log.append` | Append a runtime journal entry |
| `object.create` | Create a dynamic gameplay object during a session |
| `object.state.set` | Set one state facet on a gameplay object |
| `object.attribute.patch` | Patch mutable object attributes |

`object.*` effects are implemented for session-scoped object state. `scope: "player"` is reserved for a future per-player slice and is intentionally rejected by the current runtime manifest schema.

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

### Computed Metric Changes

`metric.add` values can be JsonLogic expressions:

```json
{
  "effects": [
    {
      "op": "metric.add",
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

## Tier 3: Declarative Effects

Declarative effects are explicit JSON operations that the runtime validates and applies. They are used for small game-runtime commands that should not become arbitrary JavaScript:

```json
{
  "actions": {
    "recordFacilitatorNote": {
      "handlerType": "manifest-data",
      "capabilityFamily": "log",
      "capability": "log.append",
      "deterministic": {
        "effects": [
          {
            "op": "log.append",
            "kind": "facilitator-note",
            "summary": "Команда зафиксировала риск в обсуждении",
            "data": { "riskLevel": "medium" }
          }
        ]
      }
    }
  }
}
```

Effects are **capability triggers**, not sandboxed user scripts. They signal the runtime to perform a specific allowed operation, for example append a game log entry, update a timeline field, change a metric, or apply an object-state change. Local UI-only commands such as opening a hint panel should live in the UI manifest and Presenter state, not in the logical game manifest. Full runtime plugins are a separate architecture topic and must not be introduced by adding ad hoc `handlerType: "script"` actions.

---

## Gameplay Object State

Gameplay object state is the authoritative state of a game object inside session state.
It is not frontend-local state.

Authoring manifests should describe object types and state facets through `objectTypes`.
The compiler emits runtime `objectModels`.

Example authoring shape:

```json
{
  "objectTypes": {
    "card.basic": {
      "collection": "cards",
      "idField": "cardId",
      "scope": "session",
      "facets": {
        "face": {
          "initial": "front",
          "values": {
            "front": { "view": { "summaryFrom": "summary" } },
            "back": { "view": { "summaryFrom": "backText", "visualState": "resolved" } }
          }
        },
        "availability": {
          "initial": "available",
          "values": {
            "available": { "visible": true, "interactive": true },
            "locked": { "visible": true, "interactive": false }
          }
        }
      }
    }
  }
}
```

Use object effects for object state changes:

```json
{
  "effects": [
    {
      "op": "object.state.set",
      "visibility": "public",
      "collection": "cards",
      "objectId": "{{cardId}}",
      "facet": "face",
      "value": "back"
    }
  ]
}
```

Use `object.create` for dynamic resources:

```json
{
  "op": "object.create",
  "visibility": "public",
  "collection": "resources",
  "objectId": "fuel-1",
  "objectType": "resource.supply",
  "facets": { "availability": "available" },
  "attributes": { "title": "Emergency fuel", "amount": 3 }
}
```

State is separate from logic:

- object state definitions list valid facets and values;
- `guard.object` checks object type, facets and attributes before an action runs;
- guards and JsonLogic read object state;
- effects change object state;
- Presenter builds UI-ready object views;
- React components render projected props and do not decide gameplay rules.

See [ADR-041](adrs/041-gameplay-object-state-model.md) for the accepted architecture.

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
- `objectModels` — compiled runtime object-state model emitted from authoring `objectTypes`
