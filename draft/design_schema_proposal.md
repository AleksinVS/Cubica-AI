# Proposal: Updates to Design Artifact Schema (Refined)

Based on the analysis of `left-sidebar-6-cards.jpg` and user feedback, I propose the following extensions to the `design-artifact` schema (ADR-016) to optimize for AI image generation and semantic understanding.

## Part 1: QA & Rationale

### 1. Why `style_tokens`?
**Question**: What is the purpose of `style_tokens`? Can they be replaced by inline styles?

**Answer**: `style_tokens` are critical for **AI Generation Context**, not just rendering.
- **Prompt Injection**: Tokens are used to construct the generation prompt (e.g., "Style: Antarctica Theme, Colors: #0b1d3a (primary), #dcecf9 (accent)"). Inline styles make this extraction difficult.
- **Consistency**: They ensure the AI generates consistent assets (e.g., "Ice Shard Button") across different screens by referencing the same token.
- **Theme Swapping**: Allows regenerating the entire artifact with a new visual theme just by changing tokens.

**Decision**: Keep `style_tokens` as the "Design System Source of Truth". Inline `style` in regions should be used for specific overrides or extracted properties.

### 2. Prompts per Element
**Question**: Should every element have a prompt?

**Answer**: **Yes.**
For high-fidelity generation (especially inpainting or composite generation), the AI needs to know exactly what a specific region represents visually.
- **Field**: `generation.prompt` (string) for each element in `regions`.
- **Usage**: Used for masking/inpainting specific elements without regenerating the whole image.

### 3. Optimization for Generation
**Question**: How to structure JSON for the main goal of Image Generation?

**Answer**: The structure should act as a **ControlNet Guide**.
- **Bounds**: Act as the layout constraints.
- **Type**: Maps to a ControlNet model (e.g., "button" -> standard UI button LoRA).
- **Prompt**: Textual description.
- **Layering**: `regions` array order determines z-index (painters algorithm) for composition.

---

## Part 2: Proposed Schema Extensions

### 1. Element-Level Generation Prompts
**Proposal**: Add a `generation` object to every element in `regions`.

```json
{
  "id": "btn-journal",
  "type": "button",
  "generation": {
     "prompt": "Ice-shard shaped button, translucent, glowing blue edge, text 'Journal' carved in ice",
     "negative_prompt": "metal, plastic, square corners"
  }
}
```

### 2. Layout & Composition
**Proposal**: Add explicit `layout` properties to containers to guide Compositional Generation.

```json
{
  "type": "container",
  "layout": {
      "type": "grid",
      "rows": 2,
      "columns": 3,
      "gap": 20
  }
}
```

### 3. Visual State
**Proposal**: Add `state` and `visual_tags` to help the AI understand *why* an element looks distinct.

```json
{
  "id": "card-3",
  "type": "card",
  "state": "selected",
  "visual_tags": ["highlighted", "glowing", "scale-up"]
}
```

---

## Part 3: Example Updated JSON

```json
{
  "$schema": "https://cubica.platform/schemas/design-artifact.v2.json",
  "id": "left-sidebar-6-cards",
  "type": "mockup",
  
  "generation_params": {
    "global_prompt": "Game interface, Antarctica theme, deep blue ocean background",
    "style_tokens": {
        "primary_color": "ice-blue",
        "shape": "shard"
    }
  },

  "regions": [
    {
      "id": "sidebar-left",
      "bounds": { "x": 0, "y": 0, "width": 380, "height": 1080 },
      "generation": {
         "prompt": "Vertical sidebar panel, frosted glass texture, dark blue tint"
      },
      "elements": [
         {
           "id": "days-counter",
           "generation": {
             "prompt": "Circular ice indicator showing number 45"
           }
         }
      ]
    }
  ]
}
```
