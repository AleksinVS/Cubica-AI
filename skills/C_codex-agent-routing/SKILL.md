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

Start with one subagent. Add concurrent agents only when each owns a genuinely
independent bounded result and the expected latency or review benefit exceeds
the coordination and context-transfer cost. Stay within the current runtime
ceiling and safe host capacity; do not encode a lower universal cap in the
workflow. More than two active subagents require at least three independent
workstreams, explicit non-overlapping ownership, sufficient context for every
agent, and confirmation that their commands will not compete for constrained
memory, browser, database, or worktree resources. Only the primary agent
delegates; project configuration prevents nested subagent delegation.

## Route by error cost

Use these logical roles and project profiles:

| Logical role | Codex profile | Model and effort | Use |
| --- | --- | --- | --- |
| Lead architect | `lead-architect` | Sol high | One architecture pass, decomposition, or integration analysis; no final acceptance |
| Scout | `scout` | Luna low | Narrow repository search and evidence gathering |
| Luna worker | `luna-medium` | Luna medium | Bounded routine implementation, documentation, and focused verification with low architectural risk |
| Deep Luna worker | `luna-high` | Luna high | Bounded non-critical work requiring deeper analysis or careful handling of edge cases |
| Deepest Luna worker | `luna-xhigh` | Luna xhigh | Deepest bounded non-critical work when Luna high is insufficient but no Sol-owned high-error-cost decision is required |
| Builder | `builder-low` | Terra low | Mechanical implementation from an exact plan |
| Builder | `builder` | Terra medium | Ordinary feature and bug-fix implementation |
| Complex builder | `builder_complex` | Sol high | Non-obvious or critical implementation and complex test design |
| QA reviewer | `qa-reviewer` | Terra low | Ordinary independent diff and regression review |
| QA reviewer | `qa-reviewer-medium` | Terra medium | State-heavy, concurrent, transactional, or complex negative-path review |
| Diagnostic reviewer | `critical-reviewer` | Sol medium | One focused complex-debugging or root-cause investigation after a concrete blocker |
| Critical reviewer | `critical-reviewer-high` | Sol high | Architecture, security, or high-error-cost review |

Architecture, material planning, critical or risk review, and final acceptance
require Sol high. The primary Sol-high agent always reviews the actual delegated
diff and evidence inside the changed boundary. This bounded acceptance check is
not a request to reread the repository or repeat settled discovery.

Use `critical-reviewer-high` for an additional independent review only when it
is justified by a concrete trigger: architecture or public-contract impact,
security or authorization, storage or migration, concurrency or transactions,
payments, irreversible behavior, a large cross-module integration boundary, a
completed large delivery block or release gate, unresolved contradictory
evidence, or an explicit review request. Scope that review to the changed
boundary, its contracts, and affected consumers. Never turn it into a
whole-repository review unless that is the explicitly commissioned task.
Lower-cost reviewers may collect evidence or perform an explicitly preliminary
check, but they cannot provide a high-risk judgment.

The installed Luna model does not expose reasoning `none`; `scout` therefore
uses its cheapest supported level, `low`. `luna-medium`, `luna-high`, and
`luna-xhigh` are general bounded worker profiles, not architecture or
final-acceptance roles.
Every write made by a Luna worker requires a bounded review of the changed diff,
relevant contracts, and fresh evidence by the primary Sol-high agent. A separate
Sol-high reviewer is required only when one of the independent-review triggers
above applies.

A Luna worker may act as a critic only as an optional preliminary, read-only
pass over work produced by a different Luna executor. Do not use a Luna critic
after Terra or Sol execution, and never treat that pass as final review or
acceptance; both remain with Sol high. If the preliminary critic finds defects,
route correction to a Luna worker and rerun the focused tests before the
primary agent's bounded acceptance check.

Do not use `ultra` or `pro`. Do not route Luna or Terra to `max`, Terra to
`high`, or Sol directly to `max`. Keep architecture, security, public contract,
and other high-error-cost decisions on Sol even when Luna high could complete
the mechanical implementation. Escalate with this default ladder:

```text
Luna low -> Luna medium -> Luna high -> Luna xhigh -> Sol medium -> Sol high
```

Escalate only with a concrete blocker, failed criterion, risky uncertainty, or
evidence that the current profile is insufficient.

### Comparative visual analysis

A systematic final comparison of an implemented interface with a mockup,
reference, or screenshot is a high-error-cost assessment. Route the final
judgment of differences, causes, and fix priorities to Sol high: use
`critical-reviewer-high` for read-only assessment or `builder_complex` when the
same bounded task also owns non-obvious implementation or test design.

Luna or Terra may collect screenshots, dimensions, colors, and other mechanical
evidence, but must not make the final comparative assessment.

## Choose the workflow

### Small task

- Primary Sol-high agent handles the task directly.
- Do not spawn subagents.
- Change the code and run the focused checks directly.
- Check the changed boundary and evidence before completion; do not commission
  a separate review without a concrete risk or independence benefit.

### Ordinary feature or bug fix

- Primary agent or `lead-architect`: Sol high creates the bounded plan.
- `builder`: Terra medium implements. Use a Luna worker instead when bounded
  non-critical work benefits from Luna's context or reasoning profile.
- Run focused tests after implementation. A Luna critic is optional only after
  a Luna executor and remains preliminary.
- Primary Sol-high agent reviews the changed diff, relevant contracts, and
  evidence, then accepts the result.
- Add `critical-reviewer-high` only when an independent-review trigger applies;
  keep that review inside the affected boundary.

Use `builder-low` for renames, routine CRUD edits, schema or type updates,
mechanical refactoring, or implementation from a detailed plan. Terra medium
gets one complete attempt. If it cannot finish, pass the exact diff, error, and
unmet criterion to `critical-reviewer` or the primary Sol agent.

### Large cross-module task

- Primary agent or `lead-architect`: Sol high fixes the architecture in one
  pass.
- `scout`: Luna low maps the change only when the relevant files are unknown.
- One or more `builder` or Luna agents own independent, non-overlapping
  implementation areas, subject to the adaptive concurrency rule above.
- `qa-reviewer-medium` may collect integration evidence and preliminary defects.
- `critical-reviewer-high`: Sol high performs a bounded independent review when
  the cross-module integration or another concrete trigger makes it necessary.
- Primary Sol-high agent verifies evidence and performs final acceptance.

The architecture pass must end in a short approved plan or ADR that fixes
component boundaries, interfaces, invariants, and verification criteria.
Implementation then moves to Terra or Luna according to the routing policy
without repeating the architecture phase.

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

Use `luna-medium` for routine bounded work, `luna-high` when that same
non-critical scope needs deeper reasoning or careful edge-case handling, and
`luna-xhigh` when Luna high is concretely insufficient but the task still does
not cross a Sol-owned high-error-cost boundary. Do not use a Luna worker to
approve architecture, security, public contracts, or final acceptance. Review
every Luna-authored integrated diff before accepting it.

Do not let a builder approve architecture. Route non-obvious logic, critical
blocks, and non-obvious test design to `builder_complex` with Sol high.

### QA reviewer

Require an independent diff review, the narrowest relevant checks, omitted edge
cases, and real defects only. Terra low may add a trivial regression test that
copies an established local pattern. New state models, concurrency,
transactions, complex negative scenarios, or non-obvious test design require
Sol high through `builder_complex`. QA results are preliminary evidence and do
not replace the final Sol-high integrated review or acceptance.

### Critical reviewer

Use `critical-reviewer` with Sol medium only for one focused complex-debugging
or root-cause question after a concrete blocker. It may collect evidence and
recommend the next step, but it must not issue a critical, risk, architecture,
final-review, or acceptance judgment.

Use `critical-reviewer-high` with Sol high for data migration, security or
authorization, concurrency, public API changes, payments, cross-module risk,
architecture review, and other explicitly justified independent-review
triggers. Review the relevant diff, invariants, contracts, and affected
consumers—not unrelated code.

Ask one concrete question and allow one focused pass. Do not request another
full review of the project.

## Send a narrow context packet

For built-in Codex delegation, use `fork_turns: "none"` by default. Build a
**narrow and deep** packet: omit unrelated history and repository narrative,
but include all material context needed to complete the bounded task without
guessing. Token economy is not a reason to omit a governing decision,
dependency, consumer, invariant, or known concurrent edit. Include:

1. exact objective and expected result;
2. applicable `AGENTS.md` files, accepted decisions, and established facts;
3. relevant public contracts, invariants, dependencies, callers, consumers,
   fixtures, and existing tests;
4. exact files, sections, symbols, current diff, or filtered log fragments to
   inspect, plus known edits by other agents in the same worktree;
5. allowed edit scope and explicit non-goals;
6. acceptance criteria and focused verification commands;
7. required response format;
8. stop and escalation conditions, including what missing context must be
   reported rather than guessed.

Do not paste complete files or raw logs that the agent can read locally. Filter
large logs with command-line tools first. After a failed attempt, pass the next
agent the concrete diff, failure output, and remaining blocker instead of
asking it to rediscover the repository.

Require a bounded response containing only results, changed files or evidence,
checks, residual risks, and blockers. Do not ask for narration of every action.

## Accept and close

The primary Sol-high agent performs a bounded review of the actual diff,
relevant contracts, affected consumers, and fresh verification evidence before
accepting delegated work. Add an independent reviewer only when its expected
risk reduction or independence benefit justifies the extra pass. Architecture
decisions remain with the primary agent after PM approval. Close every
completed, failed, or obsolete subagent after collecting its result.
