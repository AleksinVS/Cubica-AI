#!/usr/bin/env python3
import argparse
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(description="Generate prompts for the simplified workflow stages.")
    parser.add_argument("--mode", choices=["planning", "execution", "review"], required=True)
    parser.add_argument("--block-dir", required=True)
    parser.add_argument("--output-file", required=True)
    return parser.parse_args()

def build_prompt(args):
    block_dir = Path(args.block_dir)
    plan_file = block_dir / "ARCHITECT_PLAN.md"
    report_file = block_dir / "HANDOFF_REPORT.md"
    correction_log_file = block_dir / "AGENT_CORRECTION_LOG.executor.md"

    if args.mode == "planning":
        return f"""Phase: Architectural Planning.
Objective: Research the project, analyze strategic goals, and produce a detailed `ARCHITECT_PLAN.md`.
Use template: `_shared/references/architect-plan.template.md`.
Output: `{plan_file}`.
Mandate: Pass detailed warm context, explicit boundaries, methodology rules, and executor checklists for each slice."""

    if args.mode == "execution":
        return f"""Phase: Implementation & Self-Review.
Objective: Read `{plan_file}` and implement all slices sequentially.
Output: `{report_file}` (update it frequently with checklist progress, checks, tests, and residual risks).
Optional supporting artifact: `{correction_log_file}` when material corrections or deviations occur.
Role: You are the Executor and self-reviewing implementer.
Mandate: Follow the methodology defined in the plan, use the full plan as your main context source, and map all acceptance criteria to explicit tests or checks."""

    if args.mode == "review":
        return f"""Phase: Final Acceptance & Closeout.
Objective: Perform a final review of the work against `{plan_file}` and `{report_file}`.
Goal: Verify implementation, confirm checklist completion, run extra checks if needed, and decide whether the block is accepted or returned for another iteration.
Outcome: Git commit on success, Roadmap/Backlog updates, or return for rework."""

def main():
    args = parse_args()
    prompt = build_prompt(args)
    Path(args.output_file).write_text(prompt, encoding="utf-8")
    print(f"Generated prompt for {args.mode} at {args.output_file}")

if __name__ == "__main__":
    main()
