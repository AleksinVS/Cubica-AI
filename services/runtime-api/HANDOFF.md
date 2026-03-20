# Runtime API Handoff

## Текущее состояние

`services/runtime-api/` работает как модульный монолитный backend runtime для `Antarctica`.

Сейчас в нём уже есть:

- `packages/contracts/session` и `packages/contracts/runtime` как canonical DTO/contracts layer
- `packages/contracts/manifest` как typed manifest model (включая `PlayerFacingContent` DTO)
- `src/modules/session/inMemorySessionStore.ts`
- `src/modules/content/manifestLoader.ts`
- `src/modules/content/manifestValidation.ts`
- `src/modules/content/contentService.ts` (загружает и проецирует player-facing content)
- `src/modules/runtime/*` для capability-based deterministic dispatch
- `src/modules/player-api/httpServer.ts`
- `src/bootstrap.ts`

Архитектурное направление для следующего шага зафиксировано в `ADR-019`: `runtime-api` должен стать единственным владельцем загрузки `games/*` не только для session bootstrap, но и для player-facing content delivery.

## Что уже работает

Минимальный HTTP-контур:

- `GET /health`
- `POST /sessions`
- `GET /sessions/:id`
- `POST /actions`
- `GET /games/:gameId/player-content`

Поведение:

- `POST /sessions` загружает `games/antarctica/game.manifest.json`;
- initial state берётся из `manifest.state`;
- request bodies и manifest shape проходят bounded validation;
- `POST /actions` роутится по manifest capability family;
- runtime metadata и `public.log` фиксируют фактический dispatch;
- сессии пока хранятся in-memory.

## Как запускать локально

```bash
npm run dev --workspace services/runtime-api
```

Текущий runtime использует Node `v22+` и `--experimental-strip-types`.

## Что проверить

Для текущего canonical slice используй root-level команды:

```bash
npm run verify:runtime-api
npm run verify:player-web
npm run verify:canonical
```

Если нужен более узкий цикл:

```bash
npm run smoke --workspace services/runtime-api
```

## Что ещё НЕ сделано

- нет persistence, locks, recovery;
- нет readiness endpoint;
- capability handlers пока покрывают только текущие `Antarctica` actions;
- нет полноценного shared viewer/runtime package между apps.
- для `Antarctica` ещё не перенесён в manifest основной gameplay flow из `draft/Antarctica/Game.html`; `README.md` рядом с ним описывает структуру legacy-прототипа, а сам `Game.html` нужно анализировать scripts-based способом, а не читать целиком как prose-артефакт.

## Следующие шаги по приоритету

1. Player-facing content DTO и endpoint (`GET /games/:gameId/player-content`) реализованы — `runtime-api` теперь sole owner загрузки `games/*`.
2. Transport/content split поддерживается: `player-api` отдаёт HTTP boundary, `content`-модуль загружает и проецирует manifest/design data.
3. Расширять capability-based runtime только когда появятся новые concrete game mechanics.
4. Двигать `apps/player-web` как canonical delivery layer и не возвращаться к draft-player структуре.
5. Добавлять persistence только после появления реального operational need.
6. Если появятся новые игры, расширять `packages/contracts/manifest` и manifest model, а не вводить ad hoc JSON shape.
7. Для ближайшего Antarctica gameplay slice извлекать механику из `draft/Antarctica/Game.html` через scripts и переносить её в `games/antarctica/game.manifest.json` как в конечный исполнимый source of truth.

## Важные замечания

- `services/router`, `services/game-engine`, `services/game-repository` остаются legacy/service-boundary references.
- Канонический content source of truth для игры - `games/antarctica/`.
- `apps/player-web/` уже входит в current canonical slice и должен оставаться чистым от generated artifacts.
