---
name: codex-agent-routing
description: Route work between project-scoped Codex agents by task complexity, error cost, and context needs. Use automatically before spawning, steering, or escalating Codex subagents, choosing a Codex agent model or reasoning effort, or preparing a delegated context packet. Do not use for gameplay AI agents or external CLI agents.
---

# Codex Agent Routing

Choose the smallest sufficient Codex agent profile, pass it a narrow context
packet, and keep architecture and final acceptance with the primary agent.

## Start with no delegation

Do not spawn a subagent when the primary agent already knows the affected files
and can complete and verify a small change directly. Delegation must create a
bounded independent result, reduce latency, or add justified independent review.

Never create an agent only to execute a known deterministic test command. Run
that command directly. Use a QA agent when test design, failure analysis, or an
independent assessment requires model work.

A bounded read-only verification packet is also a valid QA delegation when it
combines many simple commands and inspections that a cheaper model can execute
and summarize without expanding the parent context. The packet must name every
allowed command or check, forbid file changes, define the concise evidence to
return, and still leave integrated acceptance with the primary agent. Do not
disguise one deterministic command as a verification packet.

Keep at most two subagents active concurrently. Give parallel writers
non-overlapping ownership. Only the primary agent delegates; project
configuration prevents nested subagent delegation.

## Route by error cost

Use these logical roles and project profiles:

| Logical role | Codex profile | Model and effort | Use |
| --- | --- | --- | --- |
| Lead architect | `lead-architect` | Sol high | One architecture pass, decomposition, integration, and final acceptance |
| Scout | `scout` | Luna low | Narrow repository search and evidence gathering |
| Builder | `builder-low` | Terra low | Mechanical implementation from an exact plan |
| Builder | `builder` | Terra medium | Ordinary feature and bug-fix implementation |
| Complex builder | `builder_complex` | Sol high | Non-obvious or critical implementation and complex test design |
| QA reviewer | `qa-reviewer` | Terra low | Ordinary independent diff and regression review |
| QA reviewer | `qa-reviewer-medium` | Terra medium | State-heavy, concurrent, transactional, or complex negative-path review |
| Critical reviewer | `critical-reviewer` | Sol medium | Focused complex debugging or risk review |
| Critical reviewer | `critical-reviewer-high` | Sol high | Architecture, security, or high-error-cost review |

The installed Luna model does not expose reasoning `none`; `scout` therefore
uses its cheapest supported level, `low`. The suffixed profiles are fixed-effort
variants of the six logical roles, not additional team roles.

Do not use `ultra` or `pro`. Do not route Luna to `high` or `max`, Terra to
`high` or `max`, or Sol directly to `max`. Escalate the model class before
raising a weaker model's effort:

```text
Luna low -> Terra low/medium -> Sol medium -> Sol high
```

Escalate only with a concrete blocker, failed criterion, risky uncertainty, or
evidence that the current profile is insufficient.

## Choose the workflow

### Small task

- Primary agent: Sol low when the client permits a per-task choice.
- Do not spawn subagents.
- Change the code and run the focused checks directly.

### Ordinary feature or bug fix

- Primary agent: Sol medium creates a short plan.
- `builder`: Terra medium implements.
- `qa-reviewer`: Terra low independently checks the diff and regression risk.
- Primary agent verifies evidence and accepts the result.

Use `builder-low` for renames, routine CRUD edits, schema or type updates,
mechanical refactoring, or implementation from a detailed plan. Terra medium
gets one complete attempt. If it cannot finish, pass the exact diff, error, and
unmet criterion to `critical-reviewer` or the primary Sol agent.

### Large cross-module task

- Primary agent or `lead-architect`: Sol high fixes the architecture in one
  pass.
- `scout`: Luna low maps the change only when the relevant files are unknown.
- One or two `builder` agents: Terra medium own non-overlapping areas.
- `qa-reviewer-medium`: Terra medium checks the integrated behavior.
- Add a critical reviewer only when a trigger below applies.

The architecture pass must end in a short approved plan or ADR that fixes
component boundaries, interfaces, invariants, and verification criteria.
Implementation then moves to Terra without repeating the architecture phase.

## Bound each role

### Scout

Use `scout` to find definitions and calls, map affected files, identify test
commands, extract relevant log errors, or confirm whether an implementation
already exists. Do not launch it if the primary agent already has these facts.

Require only:

1. affected files and symbols;
2. dependencies;
3. concise evidence with paths;
4. uncertainties.

The scout must not design a solution, change code, or summarize the repository.

### Builder

Use Terra low for prescribed mechanical changes and Terra medium for new
functions, connected changes across several files, business logic, error
handling, or several acceptance criteria.

Do not let a builder approve architecture. Route non-obvious logic, critical
blocks, and non-obvious test design to `builder_complex` with Sol high.

### QA reviewer

Require an independent diff review, the narrowest relevant checks, omitted edge
cases, and real defects only. Terra low may add a trivial regression test that
copies an established local pattern. New state models, concurrency,
transactions, complex negative scenarios, or non-obvious test design require
Sol high through `builder_complex`.

### Critical reviewer

Use a critical reviewer only for data migration, security or authorization,
concurrency, a public API change, payments, a hard-to-reproduce failure, a
change spanning many modules, or a blocker unresolved by builder and QA.

Ask one concrete question and allow one focused pass. Do not request another
full review of the project.

## Send a narrow context packet

For built-in Codex delegation, use `fork_turns: "none"` by default. Do not pass
the full chat history. Include:

1. exact objective and expected result;
2. accepted decisions and already established facts;
3. exact files, sections, symbols, or filtered log fragments to inspect;
4. allowed edit scope and explicit non-goals;
5. acceptance criteria and focused verification commands;
6. required response format;
7. stop and escalation conditions.

Do not paste complete files or raw logs that the agent can read locally. Filter
large logs with command-line tools first. After a failed attempt, pass the next
agent the concrete diff, failure output, and remaining blocker instead of
asking it to rediscover the repository.

Require a bounded response containing only results, changed files or evidence,
checks, residual risks, and blockers. Do not ask for narration of every action.

## Accept and close

The primary agent reviews the actual diff, contracts, and fresh verification
evidence before accepting delegated work. Architecture decisions remain with
the primary agent after PM approval. Close every completed, failed, or obsolete
subagent after collecting its result.
