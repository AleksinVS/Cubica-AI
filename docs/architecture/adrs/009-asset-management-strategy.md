# ADR-009: Centralized Asset Management Strategy

- **Status**: Accepted
- **Date**: 2025-11-27
- **Author**: AI Agent
- **Context**: Epic E_0010 (Game Manifest Architecture)

## 1. Context
As games become more complex, they require not only logic (rules, scripts) but also media resources: images, audio, and video.
Currently, the `game.json` manifest's `assets` section is used only for "logic assets" (Markdown files, JS scripts) that are loaded by the Engine.
We need a unified way to declare media assets so that:
1.  **Decoupling**: The UI and Logic can refer to assets by logical ID, not physical path.
2.  **Source of Truth**: All external dependencies of the game are listed in one place (`game.json`).
3.  **Hybrid SDUI**: The UI definition remains JSON-serializable and platform-agnostic (using IDs instead of hardcoded paths).

## 2. Decision

We will expand the `assets` section of the Game Manifest to act as a **Central Asset Registry**.

### 2.1. Structure
The `assets` object will support specific sub-sections for different media types:

```json
"assets": {
  // Logic Assets (Processed by Engine Backend)
  "rules": "assets/rules.md",
  "scenario": "assets/scenario.md",
  "scripts": "assets/game.js",

  // Media Assets (Consumed by Client/View)
  "images": {
    "hero_idle": "assets/img/hero_idle.png",
    "forest_bg": "https://cdn.external.com/forest.webp"
  },
  "audio": {
    "bgm_main": "assets/audio/theme.mp3",
    "sfx_hit": "assets/audio/hit.wav"
  },
  "video": {
    "intro": "assets/video/intro.mp4"
  }
}
```

- **Keys**: Logical IDs (snake_case recommended).
- **Values**:
    - **Relative Path**: String starting with `assets/`. Resolves relative to the manifest file location (or Game Base URL).
    - **Absolute URL**: String starting with `http://` or `https://`.

### 2.2. Usage in UI (Hybrid SDUI)
UI components reference assets using **Data Binding** syntax or specific protocol.
The standard binding syntax `{{path}}` is extended to support `assets`:

```json
{
  "type": "image",
  "props": {
    "src": "{{assets.images.hero_idle}}",
    "alt": "Hero"
  }
}
```
The Client (SDK) is responsible for resolving `{{assets.images.hero_idle}}` to the absolute URL before rendering.

### 2.3. Usage in Logic (Audio/Video)
Game Logic (LLM or Script) triggers media playback via **View Commands** (Abstract View Protocol), referencing the Asset ID.

```json
{
  "command": "PLAY_SOUND",
  "payload": {
    "asset_id": "sfx_hit"
  }
}
```

## 3. Consequences

### Positive
- **Portability**: Moving a game to a new host only requires changing the Base URL in the client configuration, not rewriting the manifest.
- **Maintainability**: Changing a file name (e.g., `hero_v2.png`) happens in one place (`assets`), not in every UI screen definition.
- **Performance**: Clients can preload assets listed in the manifest before starting the game.

### Negative
- **Verbosity**: Requires declaring every image in `assets` before using it. (Mitigation: tooling/editors can automate this).

## 4. Implementation Status
- Manifest Structure Spec: Updated in `docs/architecture/schemas/manifest-structure.md`.
- UI Schema: Compatible with existing binding logic.

