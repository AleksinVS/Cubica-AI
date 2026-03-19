# Runtime API Handoff

## Текущее состояние

`services/runtime-api/` создан как каркас модульного монолита по ADR-017.

Сейчас в нём уже есть:

- `src/modules/session/contracts.ts`
- `src/modules/session/inMemorySessionStore.ts`
- `src/modules/content/manifestLoader.ts`
- `src/modules/player-api/httpServer.ts`
- `src/bootstrap.ts`

## Что уже работает

Минимальный HTTP-контур:

- `GET /health`
- `POST /sessions`
- `GET /sessions/:id`
- `POST /actions`

Поведение:

- `POST /sessions` загружает `games/antarctica/game.manifest.json`;
- initial state берётся из `manifest.state`;
- сессии хранятся in-memory;
- `POST /actions` пока делает placeholder transition и записывает:
  - `runtime.lastActionId`
  - `runtime.lastPayload`
  - `runtime.lastUpdatedAt`

## Как запускать локально

```bash
npm run dev --workspace services/runtime-api
```

Текущий runtime использует:

- Node `v22+`
- `--experimental-strip-types`

## Что проверено

Проверялись:

- импорт `services/runtime-api/src/index.ts`
- загрузка `games/antarctica` через `manifestLoader`
- создание HTTP server через `createRuntimeApiServer`

Полноценные HTTP/integration tests ещё не добавлены.

## Что ещё НЕ сделано

- нет реального runtime execution layer;
- нет dispatch в manifest `actions`;
- нет отделения command/query DTO в отдельный contracts package;
- нет health/readiness различия;
- нет persistence, locks, recovery;
- нет schema validation на входе API;
- нет test runner и автотестов для `runtime-api`.

## Следующие шаги по приоритету

1. Вынести player-facing request/response DTO в отдельные контракты.
2. Подключить manifest `actions` из `games/antarctica/game.manifest.json`.
3. Добавить deterministic handler layer вместо placeholder runtime update.
4. Перенести полезные router/session наработки в модули `session` и `player-api`.
5. Добавить integration tests через HTTP.
6. Подготовить выделение `packages/contracts/*` и `apps/player-web`.

## Важные замечания

- `package-lock.json` уже изменён в рабочем дереве и требует аккуратности при дальнейших npm-операциях.
- В репозитории всё ещё есть старые сервисные каталоги `services/router`, `services/game-engine`, `services/game-repository`; на ближайшей фазе их нужно трактовать как legacy/service-boundary references, а не как основной runtime path.
- Канонический content source of truth для игры — `games/antarctica/`.
