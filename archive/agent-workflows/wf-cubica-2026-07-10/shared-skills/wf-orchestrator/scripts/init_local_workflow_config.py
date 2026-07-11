#!/usr/bin/env python3
"""Initialize a project-local workflow config for the generic workflow skills."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create PROJECT_WORKFLOW_CONFIG.json from the shared workflow template."
    )
    parser.add_argument(
        "--cwd",
        default=".",
        help="Project root where the local workflow config should be created.",
    )
    parser.add_argument(
        "--output",
        default="PROJECT_WORKFLOW_CONFIG.json",
        help="Output path relative to --cwd.",
    )
    parser.add_argument(
        "--project-id",
        default=None,
        help="Optional explicit project id. Defaults to the project directory name.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite an existing config file.",
    )
    return parser.parse_args()


def load_template() -> dict:
    template_path = (
        Path(__file__).resolve().parents[2]
        / "_shared"
        / "references"
        / "project-workflow-config.template.json"
    )
    return json.loads(template_path.read_text(encoding="utf-8"))


def main() -> int:
    args = parse_args()
    project_root = Path(args.cwd).resolve()
    output_path = project_root / args.output

    if output_path.exists() and not args.force:
        print(f"exists: {output_path}")
        return 0

    data = load_template()
    data["project_id"] = args.project_id or project_root.name

    workflow_root = data.get("paths", {}).get("workflow_root", "workflow")
    (project_root / workflow_root).mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"created: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
