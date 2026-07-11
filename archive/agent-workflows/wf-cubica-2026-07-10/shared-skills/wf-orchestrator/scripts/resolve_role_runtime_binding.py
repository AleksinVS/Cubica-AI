#!/usr/bin/env python3
"""Resolve a deterministic runtime binding for a workflow role.

This version is adapted for the simplified workflow:
- architectural plans are Markdown, not JSON, so the resolver does not parse plans;
- task packets are optional/removed, so the resolver does not depend on them;
- PM is no longer a required workflow role;
- Architect and Orchestrator may share one skill, so role aliasing between them is supported.

The resolver stays data-driven: it reads only PROJECT_WORKFLOW_CONFIG.json and any
explicit method/phase overrides passed on the command line.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_NAME = "PROJECT_WORKFLOW_CONFIG.json"
ROLE_ALIASES: dict[str, tuple[str, ...]] = {
    "architect": ("orchestrator",),
    "orchestrator": ("architect",),
}


@dataclass(frozen=True)
class BindingResolution:
    requested_role: str
    resolved_role: str | None
    development_method: str | None
    method_phase: str | None
    binding: dict[str, Any] | None
    source: str | None
    used_role_alias: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resolve a deterministic runtime binding for a workflow role from PROJECT_WORKFLOW_CONFIG.json."
    )
    parser.add_argument("--role", required=True, help="Workflow role to resolve, for example orchestrator or executor.")
    parser.add_argument(
        "--project-config-file",
        help="Explicit path to PROJECT_WORKFLOW_CONFIG.json. Preferred input for the Markdown-first workflow.",
    )
    parser.add_argument(
        "--config-file",
        dest="project_config_file",
        help="Alias for --project-config-file.",
    )
    parser.add_argument(
        "--cwd",
        default=".",
        help="Working directory used to auto-discover PROJECT_WORKFLOW_CONFIG.json when --project-config-file is omitted.",
    )
    parser.add_argument(
        "--architect-plan-file",
        help="Optional compatibility input. The file is not parsed; its parent chain is searched for PROJECT_WORKFLOW_CONFIG.json.",
    )
    parser.add_argument(
        "--task-file",
        help="Optional compatibility input kept for older wrappers. It is not parsed in the Markdown-first workflow.",
    )
    parser.add_argument(
        "--development-method",
        help="Explicit development method selected by the orchestrator for the current block or iteration.",
    )
    parser.add_argument(
        "--method-phase",
        help="Explicit phase inside the selected method, for example scaffold or harden.",
    )
    parser.add_argument(
        "--required",
        action="store_true",
        help="Exit non-zero when no binding can be resolved.",
    )
    return parser.parse_args()


def _normalize_text(value: object) -> str | None:
    if isinstance(value, str):
        value = value.strip()
        if value:
            return value
    return None


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _iter_search_roots(args: argparse.Namespace) -> list[Path]:
    roots: list[Path] = []

    if args.project_config_file:
        roots.append(Path(args.project_config_file).resolve())

    if args.architect_plan_file:
        roots.append(Path(args.architect_plan_file).resolve())

    if args.task_file:
        roots.append(Path(args.task_file).resolve())

    roots.append(Path(args.cwd).resolve())
    return roots


def _discover_project_config(args: argparse.Namespace) -> Path | None:
    explicit = _normalize_text(args.project_config_file)
    if explicit:
        path = Path(explicit).resolve()
        return path if path.exists() else None

    seen: set[Path] = set()
    for root in _iter_search_roots(args):
        current = root if root.is_dir() else root.parent
        while True:
            if current in seen:
                break
            seen.add(current)
            candidate = current / DEFAULT_CONFIG_NAME
            if candidate.exists():
                return candidate
            if current.parent == current:
                break
            current = current.parent
    return None


def _extract_role_binding(container: object, role: str) -> dict[str, Any] | None:
    if isinstance(container, dict):
        direct = container.get(role)
        if isinstance(direct, dict):
            return direct
        if container.get("role") == role and isinstance(container.get("launcher"), str):
            return container

    if isinstance(container, list):
        for item in container:
            if isinstance(item, dict) and item.get("role") == role and isinstance(item.get("launcher"), str):
                return item

    return None


def _resolve_from_method_bindings(
    config: dict[str, Any],
    role_candidates: list[str],
    method: str | None,
    phase: str | None,
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    bindings = config.get("method_role_runtime_bindings", {})
    if not isinstance(bindings, dict):
        return None, None, None

    method_keys: list[str] = []
    if method and phase:
        method_keys.append(f"{method}:{phase}")
    if method:
        method_keys.append(method)

    for key in method_keys:
        bucket = bindings.get(key)
        for role in role_candidates:
            hit = _extract_role_binding(bucket, role)
            if hit:
                return hit, role, f"project_config.method_role_runtime_bindings[{key}]"

    return None, None, None


def _resolve_from_role_bindings(
    config: dict[str, Any],
    role_candidates: list[str],
) -> tuple[dict[str, Any] | None, str | None, str | None]:
    bindings = config.get("role_runtime_bindings", [])
    for role in role_candidates:
        hit = _extract_role_binding(bindings, role)
        if hit:
            return hit, role, f"project_config.role_runtime_bindings[{role}]"
    return None, None, None


def resolve_role_runtime_binding(
    *,
    role: str,
    project_config: dict[str, Any],
    explicit_method: str | None = None,
    explicit_phase: str | None = None,
) -> BindingResolution:
    requested_role = role.strip()
    method = _normalize_text(explicit_method)
    phase = _normalize_text(explicit_phase)

    role_candidates = [requested_role]
    role_candidates.extend(alias for alias in ROLE_ALIASES.get(requested_role, ()) if alias not in role_candidates)

    binding, resolved_role, source = _resolve_from_method_bindings(
        project_config,
        role_candidates,
        method,
        phase,
    )
    if binding:
        return BindingResolution(
            requested_role=requested_role,
            resolved_role=resolved_role,
            development_method=method,
            method_phase=phase,
            binding=binding,
            source=source,
            used_role_alias=resolved_role != requested_role,
        )

    binding, resolved_role, source = _resolve_from_role_bindings(project_config, role_candidates)
    if binding:
        return BindingResolution(
            requested_role=requested_role,
            resolved_role=resolved_role,
            development_method=method,
            method_phase=phase,
            binding=binding,
            source=source,
            used_role_alias=resolved_role != requested_role,
        )

    return BindingResolution(
        requested_role=requested_role,
        resolved_role=None,
        development_method=method,
        method_phase=phase,
        binding=None,
        source=None,
        used_role_alias=False,
    )


def main() -> int:
    args = parse_args()
    config_path = _discover_project_config(args)
    if config_path is None:
        raise SystemExit(
            "Could not find PROJECT_WORKFLOW_CONFIG.json. Pass --project-config-file or run from a project tree that contains it."
        )

    project_config = _load_json(config_path)
    resolution = resolve_role_runtime_binding(
        role=args.role,
        project_config=project_config,
        explicit_method=args.development_method,
        explicit_phase=args.method_phase,
    )

    payload = {
        "requested_role": resolution.requested_role,
        "resolved_role": resolution.resolved_role,
        "development_method": resolution.development_method,
        "method_phase": resolution.method_phase,
        "binding": resolution.binding,
        "source": resolution.source,
        "used_role_alias": resolution.used_role_alias,
        "project_config_file": str(config_path),
        "ok": resolution.binding is not None,
    }

    if args.required and not payload["ok"]:
        raise SystemExit(f"Missing runtime binding for role={args.role}")

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
