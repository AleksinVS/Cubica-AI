#!/usr/bin/env python3
"""Validate the Codex routing skill, project defaults, and named agent profiles.

The routing policy is mostly semantic, but its fixed infrastructure can drift:
an agent file may silently change model, effort, or write access. This script
parses the TOML configuration and rejects that mechanical drift while leaving
task classification to the primary agent.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import tomllib
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = ROOT / ".codex" / "config.toml"
AGENTS_ROOT = ROOT / ".codex" / "agents"
ROOT_INSTRUCTIONS = ROOT / "AGENTS.md"

EXPECTED_PROFILES = {
    "lead-architect": ("gpt-5.6-sol", "high", "workspace-write"),
    "scout": ("gpt-5.6-luna", "low", "read-only"),
    "luna-medium": ("gpt-5.6-luna", "medium", "workspace-write"),
    "luna-high": ("gpt-5.6-luna", "high", "workspace-write"),
    "luna-xhigh": ("gpt-5.6-luna", "xhigh", "workspace-write"),
    "builder-low": ("gpt-5.6-terra", "low", "workspace-write"),
    "builder": ("gpt-5.6-terra", "medium", "workspace-write"),
    "builder_complex": ("gpt-5.6-sol", "high", "workspace-write"),
    "qa-reviewer": ("gpt-5.6-terra", "low", "workspace-write"),
    "qa-reviewer-medium": ("gpt-5.6-terra", "medium", "workspace-write"),
    "critical-reviewer": ("gpt-5.6-sol", "medium", "read-only"),
    "critical-reviewer-high": ("gpt-5.6-sol", "high", "read-only"),
}


def load_toml(path: Path) -> dict[str, Any]:
    """Load one TOML file and report a precise configuration error."""
    try:
        with path.open("rb") as source:
            return tomllib.load(source)
    except (OSError, tomllib.TOMLDecodeError) as error:
        raise ValueError(f"{path.relative_to(ROOT)}: {error}") from error


def validate_project_config(failures: list[str]) -> None:
    """Check the shared Codex defaults and concurrency ceiling."""
    try:
        config = load_toml(CONFIG_PATH)
    except ValueError as error:
        failures.append(str(error))
        return

    expected_root = {
        "model": "gpt-5.6-sol",
        "model_reasoning_effort": "high",
    }
    expected_agents = {
        "max_threads": 2,
        "max_depth": 1,
        "interrupt_message": True,
    }

    for key, expected in expected_root.items():
        if config.get(key) != expected:
            failures.append(
                f".codex/config.toml: {key} must be {expected!r}, "
                f"got {config.get(key)!r}"
            )

    agents = config.get("agents", {})
    for key, expected in expected_agents.items():
        if agents.get(key) != expected:
            failures.append(
                f".codex/config.toml: agents.{key} must be {expected!r}, "
                f"got {agents.get(key)!r}"
            )


def validate_profiles(failures: list[str]) -> None:
    """Check that every fixed profile keeps its intended capability boundary."""
    expected_files = {f"{name}.toml" for name in EXPECTED_PROFILES}
    actual_files = {path.name for path in AGENTS_ROOT.glob("*.toml")}

    for unexpected in sorted(actual_files - expected_files):
        failures.append(f".codex/agents/{unexpected}: unregistered profile")
    for missing in sorted(expected_files - actual_files):
        failures.append(f".codex/agents/{missing}: missing profile")

    for name, expected in EXPECTED_PROFILES.items():
        path = AGENTS_ROOT / f"{name}.toml"
        if not path.is_file():
            continue
        try:
            profile = load_toml(path)
        except ValueError as error:
            failures.append(str(error))
            continue

        model, effort, sandbox = expected
        for key, expected_value in {
            "name": name,
            "model": model,
            "model_reasoning_effort": effort,
            "sandbox_mode": sandbox,
        }.items():
            if profile.get(key) != expected_value:
                failures.append(
                    f"{path.relative_to(ROOT)}: {key} must be "
                    f"{expected_value!r}, got {profile.get(key)!r}"
                )

        for required_string in ("description", "developer_instructions"):
            value = profile.get(required_string)
            if not isinstance(value, str) or not value.strip():
                failures.append(
                    f"{path.relative_to(ROOT)}: {required_string} must be non-empty"
                )


def validate_instruction_link(failures: list[str]) -> None:
    """Ensure agents can discover the policy from the repository entry point."""
    try:
        content = ROOT_INSTRUCTIONS.read_text(encoding="utf-8")
    except OSError as error:
        failures.append(f"AGENTS.md: {error}")
        return

    target = "skills/C_codex-agent-routing/SKILL.md"
    if target not in content:
        failures.append(f"AGENTS.md: missing link to {target}")


def validate_installed_models(failures: list[str]) -> None:
    """Confirm that local Codex supports every pinned model and effort pair."""
    try:
        result = subprocess.run(
            ["codex", "debug", "models"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        payload = json.loads(result.stdout)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        failures.append(f"codex debug models: {error}")
        return

    supported: dict[str, set[str]] = {}
    for model in payload.get("models", []):
        supported[model["slug"]] = {
            level["effort"] for level in model.get("supported_reasoning_levels", [])
        }

    pairs = {(model, effort) for model, effort, _ in EXPECTED_PROFILES.values()}
    pairs.add(("gpt-5.6-sol", "high"))
    for model, effort in sorted(pairs):
        if model not in supported:
            failures.append(f"Codex model is unavailable: {model}")
        elif effort not in supported[model]:
            failures.append(f"Codex model {model} does not support effort {effort}")


def main() -> int:
    """Run deterministic validation and return a CI-friendly status code."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check-installed-models",
        action="store_true",
        help="also query the local Codex model catalog",
    )
    args = parser.parse_args()

    failures: list[str] = []
    validate_project_config(failures)
    validate_profiles(failures)
    validate_instruction_link(failures)
    if args.check_installed_models:
        validate_installed_models(failures)

    if failures:
        for failure in failures:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1

    print("Codex agent routing configuration is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
