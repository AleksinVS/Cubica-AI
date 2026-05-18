# Cubica Workflow Files

This directory stores the **canonical latest** workflow files for the repository.

`canonical latest` means the newest repository-level pointer file that helps an agent quickly find the current workflow state without scanning every block folder.

What belongs here:

- `ARCHITECT_PLAN.json` — the latest canonical architect plan pointer for the active block
- `SLICE_EXPORT_SPEC.json` — the latest canonical task-materialization contract for the active block
- short repo-level notes like this README

What does **not** belong here:

- temporary per-block workspaces
- task packets for execution
- run logs, executor reports, PM packets, or other block-local artifacts

Per-block workspaces live under:

- `.tmp/agent-workflow/{block_id}/`

That temporary workspace is the main place for block-specific files such as:

- `BLOCK_BRIEF.md`
- `task-packets/*.json`
- `WORKFLOW_HEALTH.md`
- `ORCHESTRATOR_RETROSPECTIVE.md`
- `ORCHESTRATOR_RUN_LOG.jsonl`

Legacy note:

- `slice-tasks/` is an older name kept only for backward compatibility.
- `task-packets/` is the current preferred name in the `wf-*` workflow contracts.

Repository workflow reference:

- `new-workflow_V2.md`
