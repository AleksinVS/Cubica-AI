# Implementation Plan - Enhance Design Artifact Schema

Enable richer UI descriptions in design artifacts by extending the JSON schema with layout, state, and specific generation properties.

## User Review Required
> [!NOTE]
> `style_tokens` are retained as a generation source-of-truth. Each element now requires a `generation.prompt` for detailed inpainting/regeneration.

## Proposed Changes

### Schemas

#### [MODIFY] [design-artifact.schema.json](file:///c:/Work/Tallent/Cubica/docs/architecture/schemas/design-artifact.schema.json)
- **New `generation` object** for Regions/Elements:
  - `prompt` (string): Description of the element's visual appearance.
  - `negative_prompt` (string, optional).
  - `model_ref` (string, optional): Specific LoRA/Model for this element.
- **New Layout Properties**:
  - `layout` object on containers (replacing flat `layout_type`).
  - `layout.type` (grid, flex, absolute).
  - `layout.gap`, `layout.rows`, `layout.columns`.
- **New State Properties**:
  - `state` (string): e.g., "hover", "disabled".
  - `visual_tags` (array of strings): e.g., ["glowing", "frosted"].

### Documentation

#### [MODIFY] [016-design-artifacts-in-ui-manifest.md](file:///c:/Work/Tallent/Cubica/docs/architecture/adrs/016-design-artifacts-in-ui-manifest.md)
- Update JSON schema block to reflect new `generation` and `layout` fields.
- Explain the role of `style_tokens` for prompt injection.
- Add example of "Element-Level Prompting".

### Data

#### [MODIFY] [left-sidebar-6-cards.design.json](file:///c:/Work/Tallent/Cubica/games/antarctica/design/mockups/left-sidebar-6-cards.design.json)
- Update to the new schema:
  - Wrap layout props in `layout` object.
  - Add `generation: { prompt: "..." }` to keys elements.

## Verification Plan

### Manual Verification
- **Validate Schema**: Use a JSON validator to check `left-sidebar-6-cards.design.json` against the new schema.
- **Visual Check**: Verify that the ADR markdown renders correctly.
