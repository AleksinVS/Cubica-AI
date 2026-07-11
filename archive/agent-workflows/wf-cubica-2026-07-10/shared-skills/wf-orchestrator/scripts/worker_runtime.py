#!/usr/bin/env python3
"""Runtime helpers for external workflow workers."""

from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CommandRunResult:
    stdout: str
    stderr: str
    exit_code: int
    attempts: int
    stalled: bool
    stall_reason: str | None
    watchdog: dict


def infer_expected_artifacts(
    *,
    role_skill_file: str,
    architect_plan_file: str | None = None,
    explicit_artifacts: list[str] | None = None,
) -> list[str]:
    if explicit_artifacts:
        return [value for value in explicit_artifacts if value]

    skill_name = Path(role_skill_file).resolve().parent.name
    plan_path = Path(architect_plan_file).resolve() if architect_plan_file else None
    block_dir = plan_path.parent if plan_path else None

    if skill_name == "wf-executor" and block_dir is not None:
        return [
            str(block_dir / "HANDOFF_REPORT.md"),
        ]

    return []


def infer_watchdog_tuning(
    *,
    role_skill_file: str,
    architect_plan_file: str | None = None,
) -> dict:
    skill_name = Path(role_skill_file).resolve().parent.name
    if skill_name == "wf-executor":
        return {
            "idle_timeout_seconds": 300,
            "probe_interval_seconds": 300,
        }
    return {
        "idle_timeout_seconds": 180,
        "probe_interval_seconds": 300,
    }


def probe_artifacts(paths: list[str]) -> dict:
    existing = []
    missing = []
    for raw in paths:
        path = Path(raw)
        if path.exists():
            existing.append(str(path))
        else:
            missing.append(str(path))
    return {
        "existing": existing,
        "missing": missing,
        "ok": not missing,
    }


def run_with_watchdog(
    *,
    cmd: list[str],
    cwd: str,
    idle_timeout_seconds: int,
    probe_interval_seconds: int,
    max_idle_retries: int,
) -> CommandRunResult:
    attempts = 0
    while True:
        attempts += 1
        started_at = time.time()
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            text=True,
            capture_output=True,
        )
        duration_seconds = round(time.time() - started_at, 3)
        stalled = duration_seconds > idle_timeout_seconds
        watchdog = {
            "idle_timeout_seconds": idle_timeout_seconds,
            "probe_interval_seconds": probe_interval_seconds,
            "duration_seconds": duration_seconds,
            "attempt": attempts,
            "max_idle_retries": max_idle_retries,
        }
        if not stalled or attempts > max_idle_retries:
            return CommandRunResult(
                stdout=proc.stdout,
                stderr=proc.stderr,
                exit_code=proc.returncode,
                attempts=attempts,
                stalled=stalled,
                stall_reason="duration_exceeded_idle_timeout" if stalled else None,
                watchdog=watchdog,
            )
