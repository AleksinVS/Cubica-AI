# Required CI Checks

## Оглавление

- [Purpose](#purpose)
- [Required Checks](#required-checks)
- [Triggers](#triggers)
- [Repository Setting](#repository-setting)

## Purpose

This file documents the checks that must be configured as required status checks in GitHub branch protection or a repository ruleset. CI means Continuous Integration, an automated check suite that runs before merge.

## Required Checks

- `legacy/stub gate` - blocks malformed legacy registries, invalid `.desc.json`, missing `stub_reference` paths and unregistered stub markers.
- `manifest authoring gate` - blocks stale generated manifests, invalid authoring manifests and authoring-only keys in runtime manifests.
- `canonical verification` - runs the canonical runtime and player verification path.
- `portal rule tests` - keeps portal launch rule tests green while the portal launch task remains active.
- `player-web e2e` - runs browser-level Playwright checks for the player/runtime and portal launch binding paths.

## Triggers

The workflow in `.github/workflows/ci.yml` runs on:

- `pull_request` targeting `main`;
- `push` to `main`;
- `merge_group` with `checks_requested`, so merge queues receive the same required checks.

## Repository Setting

Branch protection or a repository ruleset must require `legacy/stub gate` and `manifest authoring gate` before merge. The other checks should also remain required for `main` while their corresponding code paths are active.
