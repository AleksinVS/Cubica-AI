# CLAUDE

This file defines global rules for AI agents working in this repository.

---

## Table of Contents
- [1. Scope and precedence of `CLAUDE.md`](#1-scope-and-precedence-of-agentsmd)
- [2. General rules for agents](#2-general-rules-for-agents)
- [3. Key project documents to read first](#3-key-project-documents-to-read-first)
- [4. General workflow: Plan → Implement → Refactor](#4-general-workflow-plan--implement--refactor)

---

## 1. Scope and precedence of `CLAUDE.md`

A **global**, short and stable `CLAUDE.md` lives in the **repository root** (this file).

---


## 2. General rules for agents

Agents must always:

1. **Start each response with a thumbs up emoji: 👍**

2. **Maintain documentation**
   - Create and update documentation wherever it is needed:
     - `README` files.
     - ADRs.
     - `PROJECT_STRUCTURE.md`.
     - `docs/architecture/PROJECT_ARCHITECTURE.md`
     - Task files in `docs/tasks/`.
     - Other reference / how-to / architecture docs.
   - Never leave documentation in a state that contradicts the actual code or structure.

3. **Provide tables of contents with internal links**
   - For all documentation files that are more than a few sections long, add a **Table of Contents** at the top.
   - The TOC should use **internal anchors/links** to sections within the same file.

4. **Write clear and rich comments in code**
   - Comment code so that a **complete newcomer to the project** can quickly understand what is happening by reading:
     - The file-level header comment (what this file/module is for).
     - Function/method/class docstrings.
     - Key inline comments for non-obvious logic and decisions.
   - Comments should explain **why** something is done, not only **what** is done.

5. **Avoid jargon**
   - Prefer clear, standard terminology over slang or project-specific jargon.
   - If a term might not be obvious to a new developer, treat it as non-standard and explain it (see the next point).

6. **Define non-common terms on first usage**
   - When using a term that is not widely understood or is domain-specific (for example: “daemon”, “middleware”, “RPC gateway”, “filter graph”, or Russian terms like «демон», «промежуточное ПО», «шлюз RPC», «граф фильтров»):
     - On its **first appearance** in a file or document, provide a **short definition**:
       - In code: as an inline comment or part of the docstring.
       - In docs: as a parenthetical definition or a short glossary-style note.
   - After the first clear definition, you may use the term without repeating the explanation in that same file.
   
7. **Use simple and clear language**
   - Write in a simple and understandable way, avoiding complex phrasing and unnecessary professional jargon.
   - When using a special or domain-specific term, give a short explanation or definition the first time it appears in the response, file, or document (this rule reinforces points 5–6 above).

8. **Write ADRs, tasks and README in Russian**
   - All ADRs, task descriptions, and README files must be written in Russian.

9. **Write ADR for any architecture changes**
   - All architectural solutions must be reflected in the ADR.

10. **Use subagents if you can allocate a separate context for a task and execute it in a separate process.** 
   - Each subagent reads only the necessary part of the context.
---

## 3. Key project documents to read first

Before planning anything, use these entry points:

1. **`PROJECT_OVERVIEW.md`**
   - Purpose: general overview of the project.
   - Use when:
     - Getting a general understanding of the project.
     - Starting architecture-related tasks.
   - Obligation: **whenever architecture changes**, plan and implement an update of `PROJECT_OVERVIEW.md`.

2. **`PROJECT_STRUCTURE.md`**
   - Purpose: understand the current structure of the project (directories and key files).
   - Use when:
     - Navigating the repo.
     - Planning changes that affect structure (new services, modules, folders, etc.).
   - Obligation: **any change in project structure** must be reflected in `PROJECT_STRUCTURE.md`.

3. **`docs/architecture/PROJECT_ARCHITECTURE.md`**
   - Purpose: understand the target architecture.
   - Use when:
     - Getting a general understanding of the project.
     - Starting architecture-related tasks or large refactorings.
   - Obligation: **whenever architecture changes**, plan and implement an update of `docs/architecture/PROJECT_ARCHITECTURE.md`.


4. **`docs/tasks/README.md`**
   - Purpose: learn how the task and planning system works (Milestones, Epics, Features, statuses, checklists, etc.).
   - Always consult this for **rules of creating/updating tasks**.

5. **`docs/tasks/ROADMAP.md`**
   - Purpose: see the **roadmap**, its current state, and the list of planned work.
   - Keep it **up to date**:
     - When tasks are added/changed/completed.
     - When priorities or sequencing change.

---

## 4. General workflow: Plan → Implement → Refactor 

Agents must follow the **Plan–Implement–Refactor** methodology. **Each part is made by a separate subagent**

> **Source of truth for work:** tasks in `docs/tasks/` (Milestones / Epics / Features).

### 0. Source tasks from the roadmap 

- Work is driven by `docs/tasks/ROADMAP.md`.
- Optional preliminary step (usually with the user/human owner):
  - Discuss the roadmap and **form / refine** the list of tasks in `ROADMAP.md`.
  - Find or create task files under:
    - `docs/tasks/milestones/`
    - `docs/tasks/epics/`
    - `docs/tasks/features/`
  - Follow the rules from `docs/tasks/README.md` when creating or changing tasks.

### 1. Select and plan the next task (ExecPlan creation) 

For each iteration:

1. **Read planning rules**:
   - Open and understand `docs/tasks/content-packs/PLAN.md`.
   - Follow its rules for planning.

2. **Create an ExecPlan**:
   - Based on:
     - `docs/tasks/content-packs/PLAN.md` rules.
     - The selected task’s description (ROADMAP/Milestone/Epic/Feature).
   - ExecPlan must be **concrete, actionable and checkable**:
     - Steps small enough to implement and review.
     - Clear mapping to files and components to be changed.
     - Include any required documentation updates.
     - **Include PROJECT_STRUCTURE.md, PROJECT_ARCHITECTURE.md, ROADMAP.md, tasks updates** if needed.

### 2. Implement the ExecPlan
- Implement steps of the ExecPlan **strictly**:
  - Make changes in code, tests, docs, tasks, ADRs as defined.
  - Keep changes small and coherent.

### 3. Refactor and review changes

After each implementation iteration:

1. **Review all changes** made in the codebase:
   - Verify they **match the ExecPlan exactly**.
   - Ensure code is understandable, maintainable, and consistent with project conventions.

2. **Refinement**:
   - Within the scope of the current task and ExecPlan:
     - Identify problems, inconsistencies, or possible improvements.
     - Extend or adjust the ExecPlan accordingly (keeping it in sync with reality).

### 4. Iterate

- Repeat steps **2–3** (Implement ↔ Refactor/Review) until the ExecPlan is fully completed.
- Keep the ExecPlan status accurate (see Section 4).

### 5. Finalization

When the ExecPlan is completed:

- Mark ExecPlan status as **`done`** (see naming and statuses below).
- In `docs/tasks/ROADMAP.md`:
  - Mark the relevant tasks as completed or move them to the appropriate state.
  - Add or propose new tasks if necessary (follow `docs/tasks/README.md`).
- Update:
  - The specific task files (`milestones/`, `epics/`, `features/`) to reflect actual work, status, and checklists.
  - `PROJECT_STRUCTURE.md` if the project structure changed.
  - `docs/architecture/PROJECT_ARCHITECTURE.md`, `PROJECT_OVERVIEW.md` if the project architecture changed.
  - Make sure to update the checkboxes in the ROADMAP.md file and the task files (milestones, epics, and features) that you are working on.
---
