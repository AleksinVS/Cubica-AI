# ADR 003: Hybrid Server-Driven UI (SDUI) Schema

**Status**: Accepted
**Date**: 2025-11-26
**Context**: Game Platform "Cubica"

## Context and Problem Statement

The platform requires a mechanism to describe Game UI within the Game Manifest (JSON). The UI definition must satisfy conflicting requirements:
1.  **LLM-First**: The structure must be concise and understandable for Large Language Models to generate UI on the fly (e.g., based on visual mockups or text descriptions).
2.  **Cross-Platform**: The same game must run on Web (React) and Messaging Platforms (Telegram Bot API).
3.  **Complex Interaction**: Games require complex widgets (inventory, maps) that are hard to describe using only basic primitives.

Existing standard solutions (HTML/CSS) are too verbose for LLMs and difficult to adapt for Telegram. Purely semantic approaches ("list of buttons") lack the flexibility for visual customization.

## Decision Drivers

*   Minimization of token usage in LLM prompts.
*   Requirement for Data Binding (connection between UI and Game State).
*   Need for a unified protocol for different frontends.
*   Extensibility for future rendering engines (e.g., Canvas/WebGL).

## Decision

We adopt a **Hybrid Server-Driven UI (SDUI)** approach with a custom JSON Schema.

### 1. Hybrid Structure
The schema combines two levels of abstraction:
*   **Atomic Primitives (Layout Level)**: Basic elements for defining visual structure (`container`, `v-stack`, `h-stack`, `text`, `button`, `image`). Used by LLMs to build layouts and styling.
*   **Semantic Widgets (Logic Level)**: High-level "black boxes" (`widget:inventory`, `widget:map`, `widget:stats`) that encapsulate complex logic and rendering. The Manifest only defines their type and properties, while the implementation resides on the Client.

### 2. Custom JSON Schema
We define a strict JSON Schema (instead of reusing heavy industry standards) to control the dictionary of allowed components and properties. This reduces "hallucinations" by the LLM and simplifies the writing of adapters for Telegram.

### 3. Extensibility
The schema is designed to be extensible.
*   **Renderer-Specific Extensions**: The `style` object and component properties can be extended to support specific engines (e.g., adding `x`, `y`, `rotation`, `texture` for Phaser.js/WebGL renderers) without breaking the core tree structure.
*   **Asset Management**: The schema allows defining an `assets` section for preloading resources required by specific rendering engines.

## Consequences

### Positive
*   **LLM Efficiency**: The format is compact and strictly typed, reducing context usage and generation errors.
*   **Flexibility vs. Stability**: Layouts can be changed dynamically, while complex logic remains stable within Widgets.
*   **Adaptability**: Easier to map to non-visual interfaces (Telegram) by stripping the Atomic layer and keeping the Semantic flow.

### Negative
*   **Implementation Cost**: Requires developing and maintaining custom Renderers (Parsers) for each client platform (Web/React, Telegram).
*   **Learning Curve**: Game developers (and prompt engineers) need to learn the specific JSON dialect.

