#!/usr/bin/env python3
"""Compile workflow artifacts into one prompt packet for external CLI workers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def _read_text(path: str | None) -> str | None:
    if not path:
        return None
    return Path(path).read_text(encoding="utf-8")


def _read_json(path: str | None) -> str | None:
    if not path:
        return None
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return json.dumps(data, ensure_ascii=False, indent=2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compile workflow context into a single Markdown prompt packet for an external CLI worker."
    )
    parser.add_argument("--role-skill-file", required=True)
    parser.add_argument("--project-skill-file")
    parser.add_argument("--project-config-file")
    parser.add_argument("--architect-plan-file")
    parser.add_argument("--handoff-report-file")
    parser.add_argument("--user-instruction-file")
    parser.add_argument("--task-summary")
    parser.add_argument("--output-file")
    return parser.parse_args()


def build_packet(args: argparse.Namespace) -> str:
    sections: list[str] = [
        "# External Worker Packet",
        "",
        "Use this packet as the full execution contract for the current run.",
        "Do not assume hidden context outside the packet.",
    ]

    if args.task_summary:
        sections.extend(["", "## Run Summary", "", args.task_summary.strip()])

    user_instruction = _read_text(args.user_instruction_file)
    if user_instruction:
        sections.extend(["", "## User Instruction", "", user_instruction.strip()])

    project_config = _read_json(args.project_config_file)
    if project_config:
        sections.extend(["", "## Project Workflow Config", "", "```json", project_config, "```"])

    architect_plan = _read_text(args.architect_plan_file)
    if architect_plan:
        sections.extend(["", "## Architectural Plan", "", architect_plan.strip()])

    handoff_report = _read_text(args.handoff_report_file)
    if handoff_report:
        sections.extend(["", "## Current Handoff Report", "", handoff_report.strip()])

    role_skill = _read_text(args.role_skill_file)
    if role_skill:
        sections.extend(["", "## Role Skill", "", role_skill.strip()])

    project_skill = _read_text(args.project_skill_file)
    if project_skill:
        sections.extend(["", "## Project Skill Overlay", "", project_skill.strip()])

    sections.extend(
        [
            "",
            "## Output Contract",
            "",
            "Return only the work product or status requested for this run.",
            "If you hit auth, environment, token, or tool limits, stop and report that state exactly.",
            "Do not invent missing project facts, architecture decisions, or requirements.",
        ]
    )
    return "\n".join(sections).strip() + "\n"


def main() -> int:
    args = parse_args()
    packet = build_packet(args)
    if args.output_file:
        out = Path(args.output_file)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(packet, encoding="utf-8")
    else:
        print(packet, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
