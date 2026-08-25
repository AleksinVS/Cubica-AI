# AGENTS

Short, stable rules for all AI agents working on Cubica. Domain-specific
instructions live next to the code and documentation they govern.

## Table of contents

- [1. Scope and precedence](#1-scope-and-precedence)
- [2. Context and sources](#2-context-and-sources)
- [3. User communication](#3-user-communication)
- [4. Architecture and documentation](#4-architecture-and-documentation)
- [5. Code and contracts](#5-code-and-contracts)
- [6. Execution and verification](#6-execution-and-verification)
- [7. Game-led development](#7-game-led-development)
- [8. Optional `$cubica` workflow](#8-optional-cubica-workflow)
- [9. Temporary files](#9-temporary-files)

## 1. Scope and precedence

- Direct user and runtime instructions take precedence over repository files.
- A target file is governed by the full instruction chain from the repository
  root to its directory. A closer `AGENTS.md` wins on conflict;
  `AGENTS.override.md` replaces `AGENTS.md` in the same directory. Read the
  applicable chain for every affected area before working there. A root
  override is forbidden: the global canonical file is `AGENTS.md`.
- After a full context compaction, re-read the root and nearest local
  instructions before continuing planning, implementation, or review. When
  `$cubica` is active, also re-read `skills/C_cubica/SKILL.md`.
- Canonical project skills live in `skills/`; `.codex/skills/` is only a
  discovery bridge. Never execute snapshots from `skill-candidates/` as skills.

The root file must remain at or below 16 KiB. Every applicable instruction
chain must remain at or below 28 KiB and the current agent's limit. Run
`npm run verify:agent-instructions` to validate both constraints.

## 2. Context and sources

Load only the entry points required for the current task:

| Need | Canonical source |
| --- | --- |
| Product context | [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) |
| Repository navigation | [`PROJECT_STRUCTURE.yaml`](PROJECT_STRUCTURE.yaml) |
| Architecture | [`PROJECT_ARCHITECTURE.md`](docs/architecture/PROJECT_ARCHITECTURE.md) and its local [`AGENTS.md`](docs/architecture/AGENTS.md) |
| Gameplay slice delivery | [`gameplay-slices/README.md`](docs/architecture/gameplay-slices/README.md) |
| Execution planning | [`docs/tasks/AGENTS.md`](docs/tasks/AGENTS.md) |
| Selecting the next work | [`STRATEGY.md`](docs/tasks/STRATEGY.md) and [`NEXT_STEPS.md`](NEXT_STEPS.md) |
| Browser diagnostics | [`local-browser-diagnostics.md`](docs/processes/local-browser-diagnostics.md) |

### Context7 and external research

- Use Context7 when work depends on current or version-specific behavior of an
  external library, framework, SDK, API, CLI, or cloud service. This includes
  maintainer-recommended practices and evaluation of candidate tools not yet
  used by Cubica.
- Select the exact official source and version. Keep one query focused on one
  concept. Never send secrets, personal data, or proprietary project code.
- For Cubica facts, business logic, code review, and architecture, start with
  repository evidence and checks. Use web research with primary sources for
  broad comparisons; Context7 does not replace that research.

## 3. User communication

Reply in Russian unless the user requests another language. Unless stated
otherwise, treat the user as a product manager (PM): they own goals and approve
architecture but are not expected to know the codebase or ADR numbers.

- Lead with the product outcome, risk, or decision, then explain architecture,
  and only then provide implementation details.
- Make the answer understandable without opening links. On first mention,
  explain an internal component or specialist term and why it matters.
- Clearly distinguish accepted decisions, new proposals requiring approval,
  autonomous implementation details, and known technical debt.
- When requesting an architecture decision, state what must be decided, why it
  is needed now, the recommendation, realistic alternatives and consequences,
  and what approval enables.
- Use plain, standard language. Define specialist terms at first use. When
  replying in Russian, avoid unnecessary anglicisms.

## 4. Architecture and documentation

- Changes to a public contract, source of truth, trust or security boundary,
  storage, compatibility, or material operating cost require a PM decision.
  Classification and the ADR lifecycle are defined in
  [`docs/architecture/AGENTS.md`](docs/architecture/AGENTS.md).
- The primary agent accepts an architecture decision only after PM approval.
  A subagent may research options or implement an accepted boundary, but it may
  not approve a new one.
- At the end of a large plan, look for fewer components, abstractions,
  dependencies, and steps without losing functionality, quality, or safety.
  Ask the PM before changing an accepted boundary.
- Update affected maintained documentation with the code and leave no
  contradictions. A document with six or more second-level sections needs a
  table of contents with internal links. Change generated files only through
  their generators.
- `PROJECT_STRUCTURE.yaml` is the machine-readable map of the active structure,
  not a historical inventory. Add `.desc.json` to a new significant directory.
  After changing directories or `.desc.json`, run
  `node scripts/dev/generate-structure.js`. Archives use `"_collapse": true`.
- After changing the root `AGENTS.md`, run
  `node scripts/dev/generate-claude-rules.cjs`. `CLAUDE.md` is only a generated
  compatibility copy.

## 5. Code and contracts

- Comments and docstrings should explain the purpose of a public boundary, an
  invariant, or the reason for non-obvious logic. Do not narrate obvious code or
  add boilerplate comments to every function or generated file.
- Record an unavoidable gap from target architecture as bounded technical debt
  with a removal plan. Unplanned architectural drift is forbidden.
- A declarative cross-platform contract such as JSON Schema or OpenAPI remains
  the source of truth for data shape. Validate it with a standard validator and
  generate derived types. A handwritten guard or language-specific schema must
  not duplicate that contract. Separate semantic and cross-field invariant
  checks are allowed.

## 6. Execution and verification

- Before delegating Codex agents, apply
  [`skills/C_codex-agent-routing/SKILL.md`](skills/C_codex-agent-routing/SKILL.md).
  Other agent environments use an equivalent risk-based mapping while keeping
  the shared process in
  [`parallel-agent-coordination.md`](docs/processes/parallel-agent-coordination.md).
  Delegate only a bounded independent result when it reduces latency or adds a
  justified independent review. Keep small, tightly coupled work with the
  primary agent.
- Only the primary agent creates subagents. Keep at most two active at once and
  give parallel writers non-overlapping ownership. Do not duplicate assignments
  or delegate one known deterministic command.
- The primary agent of a root `TSK-*` is its coordinator and normally also its
  integrator. Game-specific investigation may run in parallel in `open` mode.
  Before any shared schema, Mechanics IR, runtime, player, storage, or trust
  write, the coordinator publishes one `exclusive` owner and working branch for
  the exact shared boundary in `NEXT_STEPS.md` on current `origin/main`, then
  fetches and rechecks uniqueness before writing starts. Known complementary
  game requirements must be synthesized before that owner starts writing.
- Authors of dependent branches under one exclusive shared boundary hand off
  their head SHA instead of merging independently. The coordinator, or a
  separately appointed integrator when risk requires it, composes them in a
  clean worktree. A semantic conflict stops integration and returns to PM when
  it crosses an architecture decision.
- Pass a narrow context packet without full history: objective, established
  facts, exact files, boundaries, criteria, checks, and stop conditions. The
  primary agent verifies the result against contracts and fresh evidence, then
  closes unnecessary sessions.
- Choose the narrowest checks that prove the changed behavior. Run full
  canonical verification at a stage or release boundary, after a high-risk
  shared-contract or infrastructure change, when explicitly requested, or when
  narrower evidence is insufficient. Do not repeat expensive checks for
  unchanged code.
- Keep complete failure logs in `.tmp/` and pass only relevant excerpts into
  context. Retry with a new hypothesis. Never run full suites, builds, or E2E in
  parallel in one worktree.
- Before claiming completion, apply
  [`skills/verification-before-completion/SKILL.md`](skills/verification-before-completion/SKILL.md).
  Report commands and results, intentionally omitted checks, and residual risk.
- Before merging a completed branch into `main`, summarize the result and checks
  and obtain approval unless the user already gave a direct merge instruction.
  Integrate into current `main` from a clean separate worktree without rewriting
  history.

## 7. Game-led development

- Start product development with one concrete game and one complete vertical
  slice. Do not implement unused features for hypothetical future needs.
- Before changing a mechanic, classify it as general to a class of games or
  specific to one package. Follow the local rules in
  [`games/AGENTS.md`](games/AGENTS.md),
  [`services/runtime-api/AGENTS.md`](services/runtime-api/AGENTS.md), and
  [`packages/contracts/AGENTS.md`](packages/contracts/AGENTS.md) where relevant.
- Build a new rule first from the existing Game Intent -> typed Mechanics IR
  path and general operation catalog. Game-specific branches and hard-coded
  game identifiers are forbidden in shared runtime and player layers.
- If the language is insufficient, use the accepted isolated game-extension
  boundary or ask the PM to approve a general operation or public schema
  extension. Prove a general capability with both a game scenario and a neutral
  fixture.

## 8. Optional `$cubica` workflow

Apply [`skills/C_cubica/SKILL.md`](skills/C_cubica/SKILL.md) only when the user
explicitly requests `$cubica` or the autonomous Cubica workflow. In that mode,
the user approves the root `TSK-*` plan and architecture decisions, while the
orchestrator performs non-architectural work autonomously within those bounds.
The full contract lives in the skill and ADR-068; an ordinary request to change
code does not activate this workflow.

## 9. Temporary files

- Store screenshots, logs, and intermediate artifacts only under `.tmp/` with
  descriptive names. Store temporary subagent packets under
  `.tmp/agent-workflow/`.
- Never add `.tmp/` to Git. At completion, remove only your own obsolete
  artifacts; do not touch files owned by the user or other agents.
