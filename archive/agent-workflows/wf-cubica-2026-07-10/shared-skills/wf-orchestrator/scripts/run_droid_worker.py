#!/usr/bin/env python3
"""Compile a workflow prompt packet and run it through the canonical Droid CLI runner."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from worker_runtime import infer_expected_artifacts, infer_watchdog_tuning, probe_artifacts, run_with_watchdog


SCRIPT_DIR = Path(__file__).resolve().parent
COMPILE = SCRIPT_DIR / "compile_cli_prompt_packet.py"
# Workflow wrappers stay in wf-orchestrator; generic CLI runners stay in cli-subagents.
WRAPPER = SCRIPT_DIR.parents[1] / "cli-subagents" / "scripts" / "run_droid_subagent.py"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=".")
    parser.add_argument("--model")
    parser.add_argument("--auto", choices=["low", "medium", "high"])
    parser.add_argument("--reasoning-effort")
    parser.add_argument("--mission", action="store_true")
    parser.add_argument("--skip-permissions-unsafe", action="store_true")
    parser.add_argument("--session-id")
    parser.add_argument("--role-skill-file", required=True)
    parser.add_argument("--project-skill-file")
    parser.add_argument("--project-config-file")
    parser.add_argument("--architect-plan-file")
    parser.add_argument("--handoff-report-file")
    parser.add_argument("--user-instruction-file")
    parser.add_argument("--task-summary")
    parser.add_argument("--expected-artifact", action="append", default=[])
    parser.add_argument("--idle-timeout-seconds", type=int, default=None)
    parser.add_argument("--probe-interval-seconds", type=int, default=None)
    parser.add_argument("--max-idle-retries", type=int, default=1)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    with tempfile.NamedTemporaryFile("w+", suffix=".md", delete=False) as tmp:
        prompt_path = Path(tmp.name)
    try:
        compile_cmd = [sys.executable, str(COMPILE), "--role-skill-file", args.role_skill_file, "--output-file", str(prompt_path)]
        for key, value in [
            ("--project-skill-file", args.project_skill_file),
            ("--project-config-file", args.project_config_file),
            ("--architect-plan-file", args.architect_plan_file),
            ("--handoff-report-file", args.handoff_report_file),
            ("--user-instruction-file", args.user_instruction_file),
            ("--task-summary", args.task_summary),
        ]:
            if value:
                compile_cmd.extend([key, value])
        compile_proc = subprocess.run(compile_cmd, text=True, capture_output=True)
        if compile_proc.returncode != 0:
            sys.stderr.write(compile_proc.stderr)
            return compile_proc.returncode

        cmd = [sys.executable, str(WRAPPER), "--dir", args.dir, "--prompt-file", str(prompt_path)]
        for key, value in [
            ("--model", args.model),
            ("--auto", args.auto),
            ("--reasoning-effort", args.reasoning_effort),
            ("--session-id", args.session_id),
        ]:
            if value:
                cmd.extend([key, value])
        if args.mission:
            cmd.append("--mission")
        if args.skip_permissions_unsafe:
            cmd.append("--skip-permissions-unsafe")

        expected_artifacts = infer_expected_artifacts(
            role_skill_file=args.role_skill_file,
            architect_plan_file=args.architect_plan_file,
            explicit_artifacts=args.expected_artifact,
        )
        tuning = infer_watchdog_tuning(
            role_skill_file=args.role_skill_file,
            architect_plan_file=args.architect_plan_file,
        )
        idle_timeout_seconds = args.idle_timeout_seconds if args.idle_timeout_seconds is not None else tuning["idle_timeout_seconds"]
        probe_interval_seconds = (
            args.probe_interval_seconds if args.probe_interval_seconds is not None else tuning["probe_interval_seconds"]
        )

        run = run_with_watchdog(
            cmd=cmd,
            cwd=args.dir,
            idle_timeout_seconds=idle_timeout_seconds,
            probe_interval_seconds=probe_interval_seconds,
            max_idle_retries=args.max_idle_retries,
        )
        try:
            payload = json.loads(run.stdout) if run.stdout.strip() else {}
        except json.JSONDecodeError:
            payload = {
                "ok": run.exit_code == 0,
                "tool": "droid",
                "model": args.model,
                "cwd": str(Path(args.dir).resolve()),
                "command": cmd,
                "text": run.stdout.strip(),
                "stdout": run.stdout,
                "stderr": run.stderr,
                "exit_code": run.exit_code,
                "error_type": None if run.exit_code == 0 else "cli_error",
            }

        artifact_probe = probe_artifacts(expected_artifacts)
        payload["watchdog"] = run.watchdog
        payload["watchdog_tuning"] = tuning
        payload["artifact_probe"] = artifact_probe
        if run.stalled:
            payload["ok"] = False
            payload["error_type"] = "worker_stall"
        if artifact_probe["missing"]:
            payload["ok"] = False
            payload["error_type"] = "artifact_missing"
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        if payload.get("ok"):
            return 0
        return run.exit_code if run.exit_code else 3
    finally:
        prompt_path.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
