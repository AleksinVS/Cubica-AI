# Architectural Plan: Antarctica UI Alignment with Canonical Mockups (V2)

## 1. Objective
Achieve full visual parity between the Antarctica game UI and the canonical mockups located in `games/antarctica/design/mockups`. The system must support dynamic switching between **TopBar** and **Left Sidebar** layouts based on the screen type.

## 2. Reference Context (Ground Truth)
- **Canonical Mockups:** `games/antarctica/design/mockups/`
    - `top-sidebar-6-cards.jpg`: Main board reference (TOPBAR).
    - `leftsidebar-infocard.jpg`: Info/Intro screen reference (SIDEBAR).
    - `moves-journal.jpg`: Journal screen reference (SIDEBAR).
- **Draft Implementation (Technical Reference):** `draft/game-player-nextjs/`
    - Use this to inspect how the prototype handles CSS and local data loading.
- **Target Files:**
    - `apps/player-web/src/components/antarctica-player.tsx`: Layout logic and panel renderers.
    - `apps/player-web/app/globals.css`: Visual styling and colors.
    - `games/antarctica/ui/web/ui.manifest.json`: Screen definitions and component classes.

## 3. Architecture Decisions & Constraints
- **Manifest-Driven Priority:** The `cssClass` defined in the UI manifest (e.g., `topbar-screen-shell`) MUST take precedence over any hardcoded component defaults in the renderer.
- **Layout Rules:**
    - **Boards (S2, S3, etc.):** Use `topbar` layout.
    - **Info Screens (S1 variants):** Use `leftsidebar` layout.
    - **Panels (Journal, Hint):** Use `leftsidebar` layout.
- **Visual Parity Details:**
    - **Sidebar/Topbar Background:** `#0f4c75` (Solid).
    - **Main Content Background:** `#1b262c` (Solid).
    - **Sidebar Decoration:** The "two penguins" illustration (`sidebar-decoration`) must be visible in all `leftsidebar` views.

## 4. Execution Slices (Task for Droid)

### Slice 1: Renderer Logic Fix
- **File:** `apps/player-web/src/components/antarctica-player.tsx`
- **Action:** Update `resolveAntarcticaLayoutMode`. 
    - **Critical Fix:** Move the manifest `screenDefinition.root.props.cssClass` check to the TOP of the function. It must return `topbar` if `topbar-screen-shell` is present, even if it's an `S1` screen or info entry.
    - **Action:** Remove hardcoded `S1` -> `leftsidebar` overrides that conflict with manifest settings.
    - **Action:** Ensure `AntarcticaJournalRenderer` and `AntarcticaHintRenderer` explicitly use `leftsidebar` mode and include the `sidebar-decoration` div.

### Slice 2: CSS Hardening
- **File:** `apps/player-web/app/globals.css`
- **Action:** Update backgrounds using `!important` to ensure mockup parity:
    - `.game-variables-container` (in sidebar/info/journal modes) -> `background: #0f4c75 !important`.
    - `.main-content-area` (in sidebar/info/journal modes) -> `background: #1b262c !important`.
    - `.topbar-variables-container` -> `background: #0f4c75 !important`.
    - `.topbar-main-content` -> `background: #1b262c !important`.
- **Action:** Ensure the `sidebar-decoration` class points to the correct penguin asset and is positioned correctly.

### Slice 3: Manifest Verification
- **File:** `games/antarctica/ui/web/ui.manifest.json`
- **Action:** Ensure board screens (e.g., `55..60`) have `topbar-screen-shell` in their root `cssClass`.
- **Action:** Ensure info screens (e.g., `S1`) have `leftsidebar-screen` in their root `cssClass`.

## 5. Verification Protocol
Use Playwright to capture and verify:
1. **Initial Screen:** Must show Sidebar + Penguins (`leftsidebar-infocard.jpg` parity).
2. **Board Screen:** Must show TopBar with metrics at the top (`top-sidebar-6-cards.jpg` parity). *Note: Advance steps using 'Continue' buttons to reach step 30.*
3. **Journal Panel:** Open via `btn-journal`. Must show Sidebar + Penguins (`moves-journal.jpg` parity).
4. **Hint Panel:** Open via `btn-hint`. Must show Sidebar + Penguins.

**Stop all servers after verification.**
