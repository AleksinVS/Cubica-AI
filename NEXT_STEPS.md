# Next Steps

Документ фиксирует ближайшие инженерные шаги по развитию Cubica после перехода к модульному монолиту и появления `services/runtime-api/`.

## Truth Model для Antarctica

- `games/antarctica/game.manifest.json` — канонический source of truth для исполнимой логики игры.
- `games/antarctica/` — канонический content layer и рабочая заготовка игры.
- `games/antarctica/design/mockups/` — source of truth для UI mockups и экранного намерения.
- `games/antarctica/scenario.md` — narrative/source material, useful for authoring and AI pipelines, но не source of truth для runtime-логики.
- `draft/Antarctica/README.md` — reference по устройству legacy HTML-прототипа и извлечению механик, но не целевая архитектура.
- `draft/antarctica-nextjs-player/` — UI prototype/reference for visual ideas only, не source of truth для кода, структуры, архитектуры или логики.

Это закреплено в `ADR-018`.

## Приоритет 1. Complete the Antarctica Truth Model

1. Довести `packages/contracts/session` и `packages/contracts/runtime` до полного набора DTO для session/action/result.
2. Заполнить `packages/contracts/manifest` типами manifest bundle, action definitions, content metadata и design references.
3. Явно описать в `games/antarctica/game.manifest.json` основные сущности игры `Antarctica`, извлекая их из `draft/Antarctica/README.md`, `draft/Antarctica/scenario.md` и текущей заготовки в `games/antarctica/`.
4. Ввести schema validation для `game.manifest.json`.
5. Считать `scenario.md` authoring-артефактом, а не source of truth для логики.

## Приоритет 2. Harden Runtime API

1. Добавить schema validation для `POST /sessions` и `POST /actions`.
2. Расширять deterministic handler layer от текущего registry.
3. Привязать runtime handlers к manifest-defined actions и capability model.
4. Разделить `health` и `readiness`.

## Приоритет 3. Introduce Full Contracts Layer

1. Заполнить `packages/contracts/session` DTO для session lifecycle и player API.
2. Заполнить `packages/contracts/runtime` DTO для action result, state delta, effects и capability execution.
3. Заполнить `packages/contracts/manifest` типами manifest bundle, action definitions, stage/timeline model и metadata.
4. Заполнить `packages/contracts/ai` контрактами для AI task/result и eval hooks.
5. Перевести `runtime-api` и SDK на импорты из contracts layer.

## Приоритет 4. Build Player-Web from Canonical Sources

1. Создать `apps/player-web`.
2. Проектировать его от `runtime-api`, `packages/contracts/*`, `games/antarctica/game.manifest.json` и `games/antarctica/design/mockups/`.
3. Использовать `draft/antarctica-nextjs-player/` только как визуальный набросок, если это полезно, но не переносить из него структуру, data flow и runtime assumptions.
4. Выделить viewer/runtime слой в отдельный reusable package.

## Приоритет 5. Manifest and Capability Evolution

1. Ввести capability-first схему вместо игры-специфичных ad hoc расширений.
2. Подготовить `schemas/core`, `schemas/capabilities`, `schemas/api`.
3. Добавить validator/compiler tooling.
4. Зафиксировать policy для custom extensions.

## Приоритет 6. Repository Hygiene

1. Расширить `repo-manifest.json` до полного индекса крупных артефактов.
2. Явно размечать `actual / target / draft / archive / placeholder`.
3. Явно фиксировать roles для `games/antarctica/`, `games/antarctica/design/mockups/`, `games/antarctica/scenario.md`, `draft/Antarctica/README.md`, `draft/antarctica-nextjs-player/`.
4. Обновить `PROJECT_STRUCTURE.md` после появления `packages/` и `apps/`.
5. Согласовать `package-lock.json` с актуальной workspace-структурой.
