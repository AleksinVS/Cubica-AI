# ADR-027: Platform Universality Improvements

**Date:** 2026-05-08
**Status:** Accepted

## Оглавление

- [Context](#context)
- [Decision](#decision)
- [Consequences](#consequences)

## Context

The player platform must render games with different navigation models, metrics,
languages and hint rules. A plugin boundary alone is insufficient if generic
components still assume that every game has boards, a particular score field,
fixed action strings or one locale.

Those assumptions make the shared player a hidden implementation of one game
and force otherwise declarative games to provide unnecessary code.

## Decision

Adopt the following universality rules for the player platform.

### 1. Optional game-owned resolvers

- Board, screen, layout and hint resolvers are optional extension points.
- A game that can express its behavior through published manifest data does not
  require resolver code.
- When a resolver is present, it owns only the game-specific projection and does
  not replace manifest or session validation.

### 2. Data-driven routing and presentation

- Screen routing, layout mode and metric presentation are declared in the UI
  manifest.
- Generic defaults operate on the declarative fields and do not infer domain
  meaning from game identifiers.
- Visual prominence and other presentation variants are explicit properties,
  not special treatment of a field named `score` or any other semantic ID.

### 3. Canonical UI action vocabulary

- Shared UI actions use a typed, versioned vocabulary from the public manifest
  contract.
- Generic components emit canonical action intent rather than scattered string
  literals.
- Game-specific command resolution remains inside the game plugin and must
  resolve to an action declared by the manifest.

### 4. Localization boundary

- User-facing strings in shared components come from a locale provider.
- Shared components do not embed one language as a game rule.
- A missing game-specific text may use a generic localized fallback; choosing a
  narrative fallback from game state belongs to the game plugin or manifest.

### 5. Plugin-optional default path

- The default player path builds its configuration from player-facing content
  and UI-manifest data.
- Custom plugins remain available for bounded state projection and action
  resolution, but are not mandatory for a declarative game.
- Tooling may scaffold a plugin, but generated file layout is not part of this
  architecture decision.

## Consequences

Positive:

- Shared player components contain no game-specific branches.
- Simple games can be delivered entirely from validated manifests.
- Routing, metrics and visual variants are inspectable and portable.
- Localization and game-specific narrative fallback have separate ownership.

Negative:

- Public UI contracts gain optional routing, metric and presentation fields.
- Generic defaults must remain backward-compatible when those fields are absent.
- Complex games may still require a small plugin, whose contract must be
  versioned and tested independently.
- A neutral manifest fixture is required to prove that shared behavior does not
  depend on one game's data.
