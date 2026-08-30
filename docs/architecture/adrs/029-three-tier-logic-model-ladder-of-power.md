# ADR-029: Three-Tier Logic Model (The Ladder of Power)

**Date:** 2026-05-13
**Status:** Superseded by ADR-084
**Authors:** Senior SE (Gemini CLI)
**Deciders:** Senior SE, User

> Это историческое решение заменено единым контрактом Game Intent →
> типизированный Mechanics IR. Runtime больше не выбирает между templates,
> JsonLogic и script actions: authoring-макросы раскрываются до публикации,
> типизированные планы исполняются общей транзакцией, а необходимый игровой код
> допускается только как изолированное расширение игры.

## Context

The Cubica-AI platform requires a way to define game logic that is simultaneously:
1.  **AI-First:** Readable and predictable for LLM agents without execution.
2.  **Maintainable:** Free of massive structural duplication (as seen in the 9000-line Antarctica manifest).
3.  **Powerful:** Capable of handling complex mechanics (e.g., inventory, dynamic scoring, branching narratives).
4.  **Secure & Portable:** Safe to run on the server and potentially on different client platforms.

Existing ADRs introduced "User Scripts" (ADR-015) and "Action Templates" (ADR-028), but we lacked a unified strategy for when to use which tool.

## Decision

We establish a **Three-Tier Logic Model**, also known as the **"Ladder of Power"**. Developers and AI agents MUST always prefer the lowest possible tier that solves the problem.

### Tier 1: Action Templates (Macros)
*   **Purpose:** Structural reuse and high-level semantics.
*   **Mechanism:** Root `templates` section in the manifest with parameter substitution (`{{param}}`).
*   **Use Case (80%):** Standard transitions, advancing steps, simple flag updates, basic log entries.
*   **AI Benefit:** High-level intent is clear (e.g., `"templateId": "info_advance"`).
*   **Platform Benefit:** Massive reduction in manifest size and easy maintenance of global patterns.

### Tier 2: Bounded Logic (JsonLogic / DSL)
*   **Purpose:** Declarative calculations and complex conditions.
*   **Mechanism:** Logic represented as JSON data (e.g., [JsonLogic](https://jsonlogic.com/)).
*   **Use Case (15%):** Calculating bonuses based on state, complex multi-variable guards, filtering collections.
*   **AI Benefit:** Transparent logic. The agent can "simulate" the result by reading the JSON tree.
*   **Platform Benefit:** High performance (pure interpretation), cross-platform compatibility, and built-in security (no access to FS/Network).

### Tier 3: User Scripts (Imperative JS)
*   **Purpose:** Advanced algorithms and highly dynamic content generation.
*   **Mechanism:** JavaScript execution in a strict sandbox (`isolated-vm`), as per ADR-010.
*   **Use Case (5%):** Procedural generation, complex math libraries, legacy logic that cannot be expressed declaratively.
*   **AI Benefit:** Lowest. The script is a "black box" to the LLM.
*   **Platform Benefit:** Infinite flexibility, but high overhead (memory/CPU isolates) and strict security constraints.

## Constraints & Rules

1.  **Lowest Tier First:** A "User Script" MUST NOT be used if the logic can be expressed via JsonLogic. JsonLogic MUST NOT be used if the intent can be covered by a pure Template.
2.  **Template Integration:** Templates can contain Tier 2 (JsonLogic) or Tier 3 (Script calls) internally. This allows abstracting complex logic away from the main scenario flow.
3.  **State Immunitity:** Tier 1 and 2 operations MUST be deterministic and side-effect free relative to the platform core (only modifying the designated `state` delta).

## Consequences

**Positive:**
*   **Optimized AI Context:** Manifests are compact (Templates) and logically transparent (JsonLogic).
*   **Scalability:** Changes to game-wide mechanics are made in one place (the template).
*   **Security:** 95% of game logic runs without the risks or overhead of full JS sandboxing.
*   **Low-Code Readiness:** Tiers 1 and 2 are easily representable in visual "drag-and-drop" editors.

**Negative:**
*   **Learning Curve:** Authors need to understand three different ways to define logic.
*   **Implementation Complexity:** The `runtime-api` must support all three dispatch paths.
