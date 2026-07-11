# Required CI Checks

## Оглавление

- [Purpose](#purpose)
- [Required Checks](#required-checks)
- [Triggers](#triggers)
- [Repository Setting](#repository-setting)
- [Temporary Legacy Exception](#temporary-legacy-exception)

## Purpose

This file documents the checks that must be configured as required status checks in GitHub branch protection or a repository ruleset. CI means Continuous Integration, an automated check suite that runs before merge.

## Required Checks

- `legacy/stub gate` - blocks malformed legacy registries, invalid or incomplete task `.desc.json` metadata, task status/queue drift in `NEXT_STEPS.md`, missing task or `stub_reference` paths, stale `PROJECT_STRUCTURE.yaml`, and unregistered stub markers.
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

Целевая настройка branch protection для `main` требует все пять проверок на
ветке, обновленной относительно `main`. Изменения должны поступать через pull
request, все обсуждения должны быть закрыты, а правило должно действовать и для
администраторов. Force-push и удаление ветки запрещены. Обязательное число
одобрений человеком не задается: текущими шлюзами служат автоматические
проверки и закрытие обсуждений.

## Temporary Legacy Exception

С 2026-07-11 защита `main` временно отключена по прямому решению PM для
объединения ветки `draft-trains`. Отклонение зарегистрировано как
`LEGACY-0043`. Все пять CI-проверок продолжают запускаться, но до восстановления
защиты не блокируют прямой push или merge технически. После завершения
временного периода защита должна быть восстановлена, а запись легаси закрыта.
