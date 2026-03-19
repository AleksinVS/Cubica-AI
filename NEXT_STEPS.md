# Next Steps

Документ фиксирует ближайшие инженерные шаги по развитию Cubica после перехода к модульному монолиту и появления `services/runtime-api/`.

## Приоритет 1. Stabilize Runtime API

1. Довести `packages/contracts/session` и `packages/contracts/runtime` до полного набора DTO для session/action/result.
2. Добавить schema validation для `POST /sessions` и `POST /actions`.
3. Расширять deterministic handler layer от текущего registry.
4. Разделить `health` и `readiness`.

## Приоритет 2. Introduce Contracts Layer

1. Заполнить `packages/contracts/session` DTO для session lifecycle и player API.
2. Заполнить `packages/contracts/runtime` DTO для action result, state delta, effects.
3. Заполнить `packages/contracts/manifest` типами manifest bundle и metadata.
4. Заполнить `packages/contracts/ai` контрактами для AI task/result и eval hooks.
5. Перевести `runtime-api` и SDK на импорты из contracts layer.

## Приоритет 3. Prepare Player Migration

1. Создать `apps/player-web`.
2. Перенести туда живой runtime path из `draft/antarctica-nextjs-player`.
3. Выделить viewer/runtime слой в отдельный reusable package.
4. Убрать зависимость от `draft/` как фактического reference runtime.

## Приоритет 4. Manifest and Capability Evolution

1. Ввести capability-first схему вместо игры-специфичных ad hoc расширений.
2. Подготовить `schemas/core`, `schemas/capabilities`, `schemas/api`.
3. Добавить validator/compiler tooling.
4. Зафиксировать policy для custom extensions.

## Приоритет 5. Repository Hygiene

1. Расширить `repo-manifest.json` до полного индекса крупных артефактов.
2. Явно размечать `actual / target / draft / archive / placeholder`.
3. Обновить `PROJECT_STRUCTURE.md` после появления `packages/` и `apps/`.
4. Согласовать `package-lock.json` с актуальной workspace-структурой.
