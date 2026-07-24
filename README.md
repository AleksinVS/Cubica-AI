# Платформа бизнес-игр Cubica

Монорепозиторий платформы Cubica: сервисы, SDK, игры, скрипты и документация.

## Быстрый старт
- Общий обзор и целевая архитектура: `PROJECT_OVERVIEW.md`.
- Структура репозитория: `PROJECT_STRUCTURE.yaml`.
- Стратегия планирования: `docs/tasks/STRATEGY.md`.
- Текущие приоритеты: `NEXT_STEPS.md`.
- Правила задач и передачи артефактов: `docs/tasks/README.md`.
- Ручные debug-скрипты: `scripts/debug/README.md`.
- Локальная браузерная диагностика: `docs/processes/local-browser-diagnostics.md`.

## Разработка на Windows
- Рекомендуемый путь рабочей копии: `C:\Work\Tallent\Cubica`, оболочка — PowerShell.
- Перед запуском сервисов проверьте инструменты: `node -v`, `python -m pip --version`, `docker compose version`.
- Перед переключением веток делайте commit или stash, чтобы рабочая копия оставалась чистой.

## WSL (архив)
Поддержка WSL сейчас на паузе. Если она будет восстановлена, используйте `docs/legacy/dev-environment-wsl.md`.

## Процесс разработки
- `main` должен быть защищённой веткой: запрет прямых коммитов, обязательные проверки CI, минимум одно одобрение.
- Рабочие ветки: `feature/<component>-<topic>`, срочные исправления: `hotfix/<component>-<topic>`.
- Canonical verification: `npm run verify:canonical`.
