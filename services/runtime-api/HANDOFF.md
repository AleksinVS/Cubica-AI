# Runtime API Handoff

## Текущее состояние

`services/runtime-api/` создан как каркас модульного монолита по ADR-017.

Сейчас в нём уже есть:

- `packages/contracts/session` как canonical source of truth для session DTO/contracts
- `src/modules/session/contracts.ts`
- `src/modules/session/inMemorySessionStore.ts`
- `src/modules/content/manifestLoader.ts`
- `src/modules/runtime/*` для deterministic action registry и dispatch
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
- `POST /actions` проходит через deterministic action registry, валидирует `actionId` по manifest и применяет controlled state transition;
- runtime metadata пишется в `state.runtime`, а `public.log` получает append-only запись о действии.

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
- базовые HTTP/integration tests через `node:test`

Есть executable smoke script:

```bash
npm run smoke --workspace services/runtime-api
```

Есть integration test command:

```bash
npm test --workspace services/runtime-api
```

## Что ещё НЕ сделано

- нет health/readiness различия;
- нет persistence, locks, recovery;
- нет schema validation на входе API;
- нет persistence-aware test fixtures.

## Следующие шаги по приоритету

1. Довести `packages/contracts/session` и `packages/contracts/runtime` до полного набора DTO для session/action/result.
2. Добавить schema validation на вход API и для manifest action definitions.
3. Расширять deterministic handler layer от текущего registry.
4. Перенести полезные router/session наработки в модули `session` и `player-api`.
5. Расширить `packages/contracts/*` и `apps/player-web`.

## Важные замечания

- `package-lock.json` уже изменён в рабочем дереве и требует аккуратности при дальнейших npm-операциях.
- В репозитории всё ещё есть старые сервисные каталоги `services/router`, `services/game-engine`, `services/game-repository`; на ближайшей фазе их нужно трактовать как legacy/service-boundary references, а не как основной runtime path.
- Канонический content source of truth для игры — `games/antarctica/`.
