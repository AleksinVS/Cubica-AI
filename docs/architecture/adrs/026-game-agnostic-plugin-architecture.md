# ADR-026: Game-Agnostic Plugin Architecture

**Status:** Accepted
**Date:** 2026-05-07
**Context:** Game Platform "Cubica"

## Оглавление

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision](#decision)
- [Consequences](#consequences)
- [2026-05-28 Amendment](#2026-05-28-amendment)
- [Related ADRs](#related-adrs)

## Context and Problem Statement

Generic player and runtime layers must support games with different state
shapes, screen models and action vocabularies. If a platform component imports a
concrete game's state type, recognizes its screen names or selects actions by
game-specific identifiers, adding another game requires changing shared code.

The platform therefore needs a stable extension boundary that keeps shared
rendering, presentation and content delivery game-agnostic while allowing a
game-owned plugin to provide projections that cannot be expressed directly by
the manifest.

## Decision

Adopt a **game-agnostic plugin architecture** with the following rules.

### 1. Generic platform contracts

- Shared platform state is treated as a schema-validated record rather than a
  concrete game's domain type.
- Generic player, presenter and renderer contracts must not import types,
  identifiers or rules owned by one game.
- Game-specific typed views of state belong to the game's package or plugin.

### 2. Manifest-first rendering

- The UI manifest is the primary source for screens, component trees, routing
  metadata and layout intent.
- Shared rendering follows one manifest-driven path.
- A generic safe fallback may render schema-known state without understanding a
  game's domain semantics.
- A custom fallback belongs to the game plugin and must not introduce a
  game-specific branch into the shared renderer.

### 3. Extensible action boundary

- UI commands are translated to canonical manifest action identifiers through
  a generic adapter.
- Static mappings and bounded dynamic resolution may be supplied by the game
  plugin.
- The adapter validates the resolved action against the published manifest; a
  plugin cannot invent an undeclared runtime action.

### 4. Context-based expression resolution

- Data binding supports arbitrary schema-valid state paths and a bounded local
  context for repeated items.
- Expression resolution is generic and must not special-case a metric, screen
  or other domain object by identifier.
- The supported expression language and fallback semantics are public
  contracts and remain deterministic.

### 5. Manifest-driven routing and layout

- Screen selection and layout are derived from declarative manifest data by
  default.
- A plugin resolver is optional and is used only when the published declarative
  contract cannot express a game-owned projection.
- Design annotations may inform rendering, but they do not create hidden
  gameplay behavior.

### 6. Plugin responsibility

A game plugin may own:

- typed projections over that game's state;
- bounded command-to-action resolution;
- game-specific fallback presentation;
- derived values that are not part of the generic player contract.

It must not own shared transport, session authority, manifest validation or
generic renderer behavior.

## Consequences

### Positive

- New games do not require game-specific changes in shared platform layers.
- Declarative games can run without a custom plugin.
- Complex games retain a bounded extension point for projections and command
  resolution.
- Routing, layout and data binding remain inspectable in published content.

### Negative

- Plugin registration adds an extension contract that must be versioned.
- Generic fallback rendering cannot reproduce every domain-specific experience.
- Dynamic action resolution and derived projections require explicit validation
  to preserve the manifest as source of truth.

## 2026-05-28 Amendment

ADR-026 remains valid for the game-agnostic resolver and ownership boundaries.
ADR-037 supersedes the originally assumed plugin location and lifecycle:

- user-editable plugins are owned by their game package;
- marketplace and server-side plugin targets require the sandbox-ready
  lifecycle and trust boundaries defined by ADR-037;
- physical source location does not change the architectural ownership rule.

## Related ADRs

- ADR-001: MVP and LLM-first game manifests
- ADR-002: Abstract View Protocol
- ADR-003: Hybrid SDUI Schema
- ADR-013: Manifest text anchors and UI split
- ADR-018: Game logic source of truth is JSON manifest
- ADR-019: Runtime API owns content loading
- ADR-037: Project-local plugins and marketplace-safe evolution
