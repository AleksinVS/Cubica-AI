# Next Steps

Текущая доска проекта. Стратегические направления описаны в `docs/tasks/STRATEGY.md`, подробные планы ведутся в `docs/tasks/active/`, постоянные артефакты задач — в `docs/tasks/artifacts/`, архив старой системы — в `docs/tasks/archive/`.

## Оглавление

- [Правило выбора работы](#правило-выбора-работы)
- [Now](#now)
- [Next](#next)
- [Later](#later)
- [Blocked](#blocked)
- [Canonical Context](#canonical-context)

## Правило выбора работы

1. Сначала брать задачи из `Now`.
2. Если нужно выбрать между направлениями, свериться с `docs/tasks/STRATEGY.md`.
3. Если задача требует архитектурного решения, сначала проверить или создать ADR.
4. Каждая активная работа должна иметь один файл `TSK-*` в `docs/tasks/active/`.
5. В конце каждой остановки обновлять `Handoff Log` в активной задаче.

## Now

- [TSK-20260518-architecture-repair-and-task-system-migration](docs/tasks/active/TSK-20260518-architecture-repair-and-task-system-migration.md) — восстановить зеленый canonical slice, устранить архитектурные разрывы из ревью 2026-05-18 и завершить миграцию системы задач на ADR-031.
- [TSK-20260520-project-review-remediation](docs/tasks/active/TSK-20260520-project-review-remediation.md) — реализация исправлений находится на review: структурный индекс, legacy/stub реестры, битые ссылки и блокирующая CI-проверка незарегистрированных заглушек обновлены.
- [TSK-20260521-game-agnostic-architecture-simplification](docs/tasks/active/TSK-20260521-game-agnostic-architecture-simplification.md) — implemented: default game config, исправленный scaffold, neutral journal metadata, `simple-choice` fixture и game-agnostic CI invariant добавлены.

## Next

- [TSK-20260518-portal-test-vps-and-antarctica-launch](docs/tasks/active/TSK-20260518-portal-test-vps-and-antarctica-launch.md) — доработать портал как launch surface, развернуть test VPS и запустить игровые сессии `Antarctica` с контролем ссылок, сроков и запусков.
- [TSK-20260518-json-schema-strict-validation](docs/tasks/active/TSK-20260518-json-schema-strict-validation.md) — перевести Ajv из `strict: false` к строгому режиму без императивного дрейфа.
- [TSK-20260518-workspace-project-references-cleanup](docs/tasks/active/TSK-20260518-workspace-project-references-cleanup.md) — решить статус `SDK/viewers/web-base`, `services/router`, `apps/portal-nextjs`, `services/portal-backend`.
- [TSK-20260518-runtime-repository-boundary-and-readiness](docs/tasks/active/TSK-20260518-runtime-repository-boundary-and-readiness.md) — сделать readiness честным и укрепить runtime repository boundary.
- [TSK-20260518-session-persistence-hardening](docs/tasks/active/TSK-20260518-session-persistence-hardening.md) — оформить и реализовать путь снятия долга по `InMemorySessionStore`.
- [TSK-20260518-contracts-neutrality-cleanup](docs/tasks/active/TSK-20260518-contracts-neutrality-cleanup.md) — очистить contracts layer от game-specific drift.

## Later

- Заменить local-file game repository adapter на конфигурируемую repository boundary.
- Очистить общие contracts от Antarctica-specific комментариев и примеров.
- Ввести TypeScript project references для рабочих пакетов.

## Blocked

- Нет известных внешних блокеров. Основной внутренний блокер: `runtime-api` и `player-web` сейчас не имеют полностью зеленых проверок.

## Canonical Context

- `games/antarctica/game.manifest.json` — источник истины для исполнимой логики Antarctica.
- `games/simple-choice/` — минимальная вторая игра для проверки game-agnostic runtime/player path.
- `games/antarctica/design/mockups/` — источник UI-намерения и экранных макетов.
- `services/runtime-api/` — канонический backend runtime в формате модульного монолита.
- `apps/player-web/` — канонический web delivery layer.
- `packages/contracts/*` — общий contracts layer.
- `draft/cubica-portal-nextjs/` — текущий portal draft для анализа и подготовки test VPS launch; не является source of truth для игровой логики.
- `draft/Antarctica/GameFull.html` — legacy extraction source на время миграции, не runtime source of truth.
