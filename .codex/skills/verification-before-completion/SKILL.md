---
name: verification-before-completion
description: Verify implementation claims before reporting work complete by selecting fresh evidence proportional to risk and scope. Use automatically before final acceptance, completion claims, releases, handoffs, or statements that a bug is fixed or tests pass.
---

# Verification Before Completion

Every completion claim needs current evidence that directly supports it. Select checks according to the changed behavior, risk, and affected boundaries.

## Verify Claims

1. List the concrete claims the final response will make: behavior works, regression is fixed, tests pass, documentation matches, or an artifact is valid.
2. Map each claim to direct evidence. Prefer the narrowest authoritative check first, then broaden for shared contracts, cross-module effects, security, migrations, or release risk.
3. Run the selected checks after the final relevant edit. Inspect exit status and meaningful output instead of relying on an earlier run or another agent's summary.
4. Review the final diff and repository status for accidental edits, stale generated files, debug artifacts, secrets, and contradictions between code and documentation.
5. Report what passed, what was not run, and any residual risk. Do not describe unverified behavior as complete.

Examples of direct evidence include a focused regression test for a defect, schema validation for a contract, build or type checking for compilation claims, and an exercised user path for interface behavior. A full test suite is warranted only when the risk or project gate requires it.

## Delegated Work

The parent agent verifies integrated results from delegated workers and checks that no unnecessary subagent remains active. A worker's completion message is evidence to inspect, not final acceptance by itself.

## Safe Verification

Do not prove a regression by destructively reverting user changes. Use an existing failing revision, a focused test that fails without the fix when safely possible, or explain why only post-fix evidence was obtained.

Verification must not silently publish, deploy, commit, push, rewrite history, delete data, or modify external state. Those operations follow the user's request and repository safety rules.
