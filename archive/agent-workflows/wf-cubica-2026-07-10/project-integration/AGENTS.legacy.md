# AGENTS

This file defines global rules for AI agents working in this repository.

---

## Оглавление

- [1. Scope and precedence of `AGENTS.md`](#1-scope-and-precedence-of-agentsmd)
- [2. General rules for agents](#2-general-rules-for-agents)
- [2.1 Workflow role compatibility (`wf-*`)](#21-workflow-role-compatibility-wf-)
- [2.2 ADR and `PROJECT_ARCHITECTURE.md` synchronization](#22-adr-and-project_architecturemd-synchronization)
- [3. Key project documents to read first](#3-key-project-documents-to-read-first)
- [4. Work with temporary files](#4-work-with-temporary-files)

---

## 1. Scope and precedence of `AGENTS.md`

- A **global**, short and stable `AGENTS.md` lives in the **repository root** (this file).
- Each subsystem/service **may** have its own local `AGENTS.md`.
- **Proximity rule:** always follow the **nearest** `AGENTS.md` (closest in the directory tree).
- **Conflict rule:** if global and local rules conflict, the **local `AGENTS.md` has priority**.

Agents must always load and follow the nearest `AGENTS.md` before working in that area of the codebase.

---


## 2. General rules for agents

Agents must always:
1. **When planning, configuring, and developing, use Context7 MCP to get up-to-date documentation and best practices.**
2. **After any full context compaction, reload the canonical process files**
   - Re-read the nearest `AGENTS.md`.
   - Re-read the active workflow wrapper/role skill that governs the current work (for example: `$cubica`, `wf-architect`, `wf-orchestrator`).
   - Treat this reload as mandatory before continuing implementation, review, or planning after a compaction boundary.
3. **Maintain documentation**
   - Create and update documentation wherever it is needed;
   - Never leave documentation in a state that contradicts the actual code or structure.
   - For all documentation files that are more than a few sections long, add a **Table of Contents** at the top.
   - The Table of Contents should use **internal anchors/links** to sections within the same file.

4. **Write clear and rich comments in code**
   - Comment code so that a **complete newcomer to the project** can quickly understand what is happening by reading:
     - The file-level header comment (what this file/module is for).
     - Function/method/class docstrings.
     - Key inline comments for non-obvious logic and decisions.
   - Comments should explain **why** something is done, not only **what** is done.

5. **Rules for user interaction**
   - Prefer clear, standard terminology over slang or project-specific jargon.
   - If a term might not be obvious to a new developer, treat it as non-standard and explain it (see the next point).
   - When using a term that is not widely understood or is domain-specific (for example: “daemon”, “middleware”, “RPC gateway”, “filter graph”, or Russian terms like «демон», «промежуточное ПО», «шлюз RPC», «граф фильтров»):
     - On its **first appearance** in a file or document, provide a **short definition**:
       - In code: as an inline comment or part of the docstring.
       - In docs: as a parenthetical definition or a short glossary-style note.
   - After the first clear definition, you may use the term without repeating the explanation in that same file.
   - Write in a simple and understandable way, avoiding complex phrasing and unnecessary professional jargon.
   - When using a special or domain-specific term, give a short explanation or definition the first time it appears in the response, file, or document (this rule reinforces points 5–6 above).
   - Avoid Anglicisms whenever possible.

6. **Write ADR for any architecture changes**
   - When responding to or working on architectural decisions, proposals, or questions, the agent must always start its response by explicitly describing how it understood the decision/proposal/question.
   - All architectural solutions must be reflected in the ADR.
   - ADRs must contain only project architecture decisions, constraints, rejected alternatives, and consequences.
   - ADRs must not be used as execution plans, slice trackers, next-step lists, or card-by-card migration specs.
   - Delivery-specific bounded gameplay details must go in Gameplay Slice Records under `docs/architecture/gameplay-slices/`; task execution plans and handoffs go in `docs/tasks/active/`.

7. **Manage subagent lifecycle**
   - A subagent is a delegated worker process, thread, or external agent session started to perform a bounded part of the current task.
   - After a subagent finishes its work and its result has been collected, the parent agent MUST explicitly close or terminate that subagent if it is no longer needed.
   - Do not leave completed, failed, or obsolete subagent sessions running or open; this prevents dangling workers from blocking future agent spawns.
   - Before reporting that a subagent-driven task is complete, check that no unnecessary subagents remain active.

9. **Manage architectural drift and legacy gaps**
    - A gap between the current state and the target architecture is allowed, but it MUST be intentional, planned, and strictly documented as tech debt or legacy.
    - Fixing such documented gaps has a high priority. Unplanned architectural drift is strictly prohibited.

10. **Platform purity over game-specific hacks**
    - Any new game mechanic MUST be implemented by extending the manifest schema (capabilities, handlers, state extensions).
    - NEVER add game-specific `if/else` branches or hardcode game IDs (e.g., "antarctica") in the core platform layers (like `services/runtime-api`).
    - Before designing or implementing a game mechanic, the agent MUST explicitly analyze whether the mechanic is:
      - **general**: useful for a whole class of games or the platform as a whole;
      - **game-specific**: meaningful only for one concrete game or scenario.
    - If the classification is unclear, the agent MUST clarify it with the user or document the assumption before implementation.
    - General mechanics belong in platform contracts, schema extensions, reusable handlers, or shared renderer behavior. Game-specific mechanics belong in the concrete game bundle/plugin/manifest and must not leak into generic player/runtime layers.

11. **Maintain PROJECT_STRUCTURE.yaml and .desc files**
    - `PROJECT_STRUCTURE.yaml` is the single machine-readable source of truth for the repository layout.
    - When adding new significant directories, you MUST create a `.desc.json` file inside them containing a short semantic description (1-2 sentences).
    - After any structural changes (adding/removing folders or `.desc.json` files), you MUST run `node scripts/dev/generate-structure.js` to regenerate `PROJECT_STRUCTURE.yaml` and keep the architecture context up to date.

12. **ANTI-PATTERN: Declarative vs. Imperative Drift**
    - NEVER replace declarative, cross-platform contracts (e.g., JSON Schema, OpenAPI specs) with language-specific imperative code (e.g., manual TypeScript type guards, Zod schemas isolated in backend code).
    - JSON Schema is the Single Source of Truth (SSOT) for data structures like Game Manifests. Validation must be performed by executing a standard validator (like AJV) against the JSON Schema, not by writing manual `if (typeof x !== 'string')` checks.

---

## 2.1 Workflow role compatibility (`wf-*`)

When using the `wf-*` workflow skills, follow their role boundaries in addition to these global rules:

- Architect (`wf-architect`) owns block selection, methodology choice, and architecture decisions (and records durable decisions in ADRs).
- Orchestrator (`wf-orchestrator`) routes work mechanically and must not rewrite the architect plan.
- Executor owns `task_acceptance`; PM owns `block_acceptance` (per the `wf-*` contracts).

## 2.2 ADR and `PROJECT_ARCHITECTURE.md` synchronization

When adding or changing any ADR, agents must update `docs/architecture/PROJECT_ARCHITECTURE.md` in the same change.

- The accepted, proposed, or draft decision from the ADR must be reflected in `PROJECT_ARCHITECTURE.md` with the minimum sufficient description: the essence of the decision, key constraints, invariants, and consequences needed to understand the platform architecture unambiguously.
- `PROJECT_ARCHITECTURE.md` must cover all current active and prospective ADRs. This includes `Accepted`, `Proposed`, and `Draft` ADRs that still describe a live or possible architecture direction.
- Agents must keep `PROJECT_ARCHITECTURE.md` current when ADR status, scope, constraints, or consequences change.
- For general architecture understanding, `PROJECT_ARCHITECTURE.md` should be enough. Read individual ADR files only when additional context, detailed alternatives, or deeper reasoning is needed.

## 3. Key project documents to read first

Before planning anything, use these entry points:

---

- [PROJECT_OVERVIEW.md](/home/abc/projects/Cubica-AI/PROJECT_OVERVIEW.md) - high-level product and platform context.
- [PROJECT_STRUCTURE.yaml](/home/abc/projects/Cubica-AI/PROJECT_STRUCTURE.yaml) - current repository layout and workspace map.
- [docs/architecture/PROJECT_ARCHITECTURE.md](/home/abc/projects/Cubica-AI/docs/architecture/PROJECT_ARCHITECTURE.md) - canonical architecture overview and ADR cross-links.
- [docs/architecture/gameplay-slices/README.md](/home/abc/projects/Cubica-AI/docs/architecture/gameplay-slices/README.md) - rules and index for bounded gameplay slice records; use these for delivery-specific migration details instead of ADRs.
- [NEXT_STEPS.md](/home/abc/projects/Cubica-AI/NEXT_STEPS.md) - current execution priorities and the next bounded slices.

---

## 4. Work with temporary files

- **Location:** All temporary files (screenshots, debug logs, intermediate artifacts) must be stored in the `.tmp/` directory at the repository root.
- **Naming:** Use descriptive names with timestamps for screenshots (e.g., `.tmp/verification-topbar-2024-05-20.png`).
- **Cleanup:** Agents are responsible for cleaning up their temporary files in `.tmp/` once the task is completed and verified. **Do not leave temporary files in the repository root.**
- **Persistence:** Never commit files from the `.tmp/` directory to the repository.
