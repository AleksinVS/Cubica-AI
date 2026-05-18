# Root Hygiene Inventory

## Оглавление

- [Итог](#итог)
- [Перенесено](#перенесено)
- [Удалено локально](#удалено-локально)
- [Оставлено в корне](#оставлено-в-корне)

## Итог

Корень репозитория очищен от одноразовых debug-скриптов, пустого локального лога и локального `test-results`.

## Перенесено

- Root debug-скрипты `capture-target-journal.mjs`, `check-*.cjs`, `check-*.mjs`, `final-compare.cjs`, `test-*.cjs`, `visual-diff-journal.mjs` перенесены в `scripts/debug/`.
- `BACKLOG.md` перенесен в `docs/tasks/archive/BACKLOG.md`, потому что текущая доска проекта ведется в `NEXT_STEPS.md`.

## Удалено локально

- `droid_worker.log` — пустой локальный лог.
- `test-results/` — локальный результат запуска тестов.

## Оставлено в корне

- Канонические входы: `AGENTS.md`, `README.md`, `PROJECT_OVERVIEW.md`, `PROJECT_STRUCTURE.yaml`, `NEXT_STEPS.md`.
- Package metadata: `package.json`, `package-lock.json`.
- Tool configs: `.claude/`, `.codex/`, `.cursor/`, `.gemini/`, `.geminiignore`, `.gitmodules`, `CLAUDE.md`, `PROJECT_WORKFLOW_CONFIG.json`.
