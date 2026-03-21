# Gameplay Slice Records

Gameplay Slice Records (GSR) capture bounded, delivery-specific gameplay mechanics for one concrete migration slice.

They complement ADRs instead of replacing them.

## Use GSR when

- a document needs step-, board-, line-, or card-level scope for one bounded slice;
- the document lists explicit actions, state fields, thresholds, branches, or legacy provenance needed for that slice;
- the document records the delivery boundary and out-of-scope follow-up for that slice.

## Do not use GSR when

- the document is making a project-level architecture decision;
- the document is deciding whether Cubica should add or reject a reusable engine, DSL, or platform-wide abstraction;
- the document is acting as an execution queue, a generic next-steps list, or a runtime handoff.

## Relationship to ADR

- ADRs contain only stable architecture decisions, constraints, alternatives, and consequences.
- GSRs carry the bounded gameplay delivery details that used to be mixed into ADR-020 through ADR-023.
- The architecture rule for bounded manifest-driven gameplay mechanics lives in `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`.

## Current Records

- `GSR-020` - Antarctica step `15` team selection.
- `GSR-021` - Antarctica step `19` threshold-based board progression.
- `GSR-022` - Antarctica step `21` metric-gated board outcomes and line switch.
- `GSR-023` - Antarctica step `23` locked go-card unlock and entry-time alt-card swap.
- `GSR-025` - Antarctica step `26` public communication board and explicit `i15` follow-up.
- `GSR-026` - Antarctica step `28` trusted messengers board and explicit `i16` follow-up.
- `GSR-027` - Antarctica step `30` acceleration board and explicit `i17` follow-up.
- `GSR-028` - Antarctica step `32` scout dispatch board, locked card `66`, and explicit `i18` follow-up.
- `GSR-029` - Antarctica step `34` relocation aftermath, `i19/i19_1` variant routing, and terminal `i21`.
