# AGENTS

This file defines global rules for AI agents working in this repository.

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
1. **For any work in Cubica, use `$cubica` as the Codex wrapper.**
   - If the user explicitly invokes a workflow role skill (`wf-architect`, `wf-orchestrator`, `wf-executor*`, `wf-pm*`), treat that as an explicit routing decision and follow the invoked `wf-*` skill contract for that work.
2. **When planning, configuring, and developing, always use Context7 MCP to get up-to-date documentation and best practices.**
3. **Use reasoning effort deliberately**
   - Use built-in **Codex subagents** with **high reasoning effort** for architecture work, decomposition of large tasks, and review of risky diffs.
   - Use **opencode subagents** with preferred model **`minimax-coding-plan/MiniMax-M2.7`** for code-writing implementation slices when that worker is available; otherwise fall back to built-in Codex subagents for the same bounded slice.
   - Use an **opencode high-review worker** only for risky or non-trivial slices that benefit from an additional bounded review pass.
   - Use **medium reasoning effort** by default for bounded implementation slices unless the task clearly needs more depth.
   - Use **low reasoning effort** only for simple mechanical follow-up edits.
4. **After any full context compaction, reload the canonical process files**
   - Re-read the nearest `AGENTS.md`.
   - Re-read the active workflow wrapper/role skill that governs the current work (for example: `$cubica`, `wf-architect`, `wf-orchestrator`).
   - Treat this reload as mandatory before continuing implementation, review, or planning after a compaction boundary.
5. **Maintain documentation**
   - Create and update documentation wherever it is needed:
   - Never leave documentation in a state that contradicts the actual code or structure.

6. **Write clear and rich comments in code**
   - Comment code so that a **complete newcomer to the project** can quickly understand what is happening by reading:
     - The file-level header comment (what this file/module is for).
     - Function/method/class docstrings.
     - Key inline comments for non-obvious logic and decisions.
   - Comments should explain **why** something is done, not only **what** is done.

7. **Rules for user interaction**
   - Prefer clear, standard terminology over slang or project-specific jargon.
   - If a term might not be obvious to a new developer, treat it as non-standard and explain it (see the next point).
   - When using a term that is not widely understood or is domain-specific (for example: “daemon”, “middleware”, “RPC gateway”, “filter graph”, or Russian terms like «демон», «промежуточное ПО», «шлюз RPC», «граф фильтров»):
     - On its **first appearance** in a file or document, provide a **short definition**:
       - In code: as an inline comment or part of the docstring.
       - In docs: as a parenthetical definition or a short glossary-style note.
   - After the first clear definition, you may use the term without repeating the explanation in that same file.
   - Write in a simple and understandable way, avoiding complex phrasing and unnecessary professional jargon.
   - When using a special or domain-specific term, give a short explanation or definition the first time it appears in the response, file, or document (this rule reinforces points 5–6 above).

8. **Write ADR for any architecture changes**
   - All architectural solutions must be reflected in the ADR.
   - ADRs must contain only project architecture decisions, constraints, rejected alternatives, and consequences.
   - ADRs must not be used as execution plans, slice trackers, next-step lists, or card-by-card migration specs.
   - Delivery-specific bounded gameplay details must go in Gameplay Slice Records under `docs/architecture/gameplay-slices/`.
9. **Keep architectural authority and final review with the main agent**
   - Built-in Codex subagents may support architecture work only as analysts: they may gather facts, compare options, and analyze bounded areas.
   - Built-in Codex subagents must not be treated as the final decision-maker for architectural choices.
   - `opencode` high-review workers may perform additional focused or intermediate review for risky or non-trivial slices, but they must not replace the final review by the main agent before commit.
   - `opencode` subagents with model `minimax-coding-plan/MiniMax-M2.7` are the preferred implementation workers for code-writing slices when available; otherwise use built-in Codex subagents for the same slice.

---

## 2.1 Workflow role compatibility (`wf-*`)

When using the `wf-*` workflow skills, follow their role boundaries in addition to these global rules:

- Architect (`wf-architect`) owns block selection, methodology choice, and architecture decisions (and records durable decisions in ADRs).
- Orchestrator (`wf-orchestrator`) routes work mechanically and must not rewrite the architect plan.
- Executor owns `task_acceptance`; PM owns `block_acceptance` (per the `wf-*` contracts).

## 3. Key project documents to read first

Before planning anything, use these entry points:

---

- [PROJECT_OVERVIEW.md](/home/abc/projects/Cubica-AI/PROJECT_OVERVIEW.md) - high-level product and platform context.
- [PROJECT_STRUCTURE.json](/home/abc/projects/Cubica-AI/PROJECT_STRUCTURE.json) - current repository layout and workspace map.
- [docs/architecture/PROJECT_ARCHITECTURE.md](/home/abc/projects/Cubica-AI/docs/architecture/PROJECT_ARCHITECTURE.md) - canonical architecture overview and ADR cross-links.
- [docs/architecture/gameplay-slices/README.md](/home/abc/projects/Cubica-AI/docs/architecture/gameplay-slices/README.md) - rules and index for bounded gameplay slice records; use these for delivery-specific migration details instead of ADRs.
- [repo-manifest.json](/home/abc/projects/Cubica-AI/repo-manifest.json) - machine-readable index of canonical, draft, and target artifacts.
- [NEXT_STEPS.md](/home/abc/projects/Cubica-AI/NEXT_STEPS.md) - current execution priorities and the next bounded slices.
- [draft/Antarctica/README.md](/home/abc/projects/Cubica-AI/draft/Antarctica/README.md) - explains the structure of the legacy `GameFull.html` prototype used for current Antarctica mechanics extraction.
- `draft/Antarctica/GameFull.html` - current factual source for Antarctica scenario/mechanics extraction during migration; do not read it whole in-chat, inspect it via scripts and targeted queries only.
- [docs/architecture/adrs/017-modular-monolith-transition-and-service-extraction.md](/home/abc/projects/Cubica-AI/docs/architecture/adrs/017-modular-monolith-transition-and-service-extraction.md) - backend transition rulebook for the modular monolith phase.
- [docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md](/home/abc/projects/Cubica-AI/docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md) - current rule for where game logic truth lives.
- [services/runtime-api/HANDOFF.md](/home/abc/projects/Cubica-AI/services/runtime-api/HANDOFF.md) - practical runtime-api state, behavior, and next steps.
