# Required CI Checks

## Оглавление

- [Purpose](#purpose)
- [Required Checks](#required-checks)
- [Triggers](#triggers)
- [Repository Setting](#repository-setting)
- [Temporary Legacy Exception](#temporary-legacy-exception)

## Purpose

This file names the five CI status checks whose coverage must remain present. CI means Continuous Integration, an automated check suite that runs before merge.

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

Целевая настройка защиты ветки `main` требует все пять проверок на ветке,
обновлённой относительно `main`. Изменения должны поступать через pull request,
все обсуждения должны быть закрыты, а правило должно действовать и для
администраторов. Force-push и удаление ветки запрещены. Обязательное число
одобрений человеком не задаётся: текущими шлюзами служат автоматические
проверки и закрытие обсуждений.

## Temporary Legacy Exception

Защита `main` сейчас остаётся отключённой по прямому решению PM, поэтому статусы
пока не являются техническим запретом на прямой push или merge. Отклонение
зарегистрировано как `LEGACY-0043`; текущая задача оптимизации тестирования
явно не включает восстановление защиты. Это не отменяет ранее зафиксированную
целевую настройку: её восстановление и закрытие записи легаси остаются
отдельной будущей работой после решения PM.

CI при этом сохраняет все пять имён статусов, запускает дешёвые шлюзы раньше
E2E, отменяет устаревшие прогоны одного pull request и сохраняет расширенную
диагностику только при ошибке.
