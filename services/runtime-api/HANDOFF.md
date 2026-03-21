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

## Обновление по bounded first-half slice (`opening.card.3`)

- Manifest/data половина первого реального gameplay slice для Antarctica уже подготовлена: в `games/antarctica/game.manifest.json` добавлен `actions["opening.card.3"]` с deterministic metadata из legacy card `3` («Поговорить с Аленой»).
- Для устранения gap по достижимости board при старте с `stepIndex: 0` в manifest добавлен explicit intro reachability path: `opening.info.i0.advance` ... `opening.info.i6.advance` (детерминированные переходы по info-блокам `i0/i02/i03/i1/i2/i3/i4/i5/i6` до `stepIndex: 9`).
- Контракт manifest action расширен небольшим typed-блоком deterministic metadata (provenance, guard, metric deltas, log metadata, state-update metadata).
- Валидация manifest теперь допускает пустые `metricDeltas` для intro advance actions и валидирует новые timeline-поля state-update (`timelineStepIndex`, `timelineStageId`, `timelineScreenId`) вместе с существующими deterministic полями.
- Runtime wiring теперь подключён: `POST /actions` исполняет explicit intro path `opening.info.i0.advance` ... `opening.info.i6.advance` и `opening.card.3` через manifest deterministic metadata.
- Runtime synchronizes both canonical and legacy timeline fields (`stepIndex/step_index`, `stageId/stage_id`, `screenId/screen_id`) so the session state stays internally consistent during migration.
- Guard failures, missing deterministic metadata, and unsupported manifest-action runtime paths now map to `400` request-validation errors instead of surfacing as generic `500`.
- Integration tests cover the public path from intro step `0` to board step `9`, successful `opening.card.3`, replay rejection, and early-invocation rejection.
- Первый opening board теперь покрыт явными deterministic actions для всех legacy cards `1/2/3/4/5/6`.
- Non-go cards `1/2/4/5/6` применяют свои metric deltas, выставляют только per-card flags и оставляют `timeline.canAdvance = false`, так что player может продолжить выбирать другие card actions на том же board.
- `opening.card.3` остаётся текущей go-card для этого board: после non-go cards она всё ещё доступна, включает `timeline.canAdvance = true` и фиксирует `secret.opening.selectedCardId = "3"`.

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
- для bounded extraction opening-flow использовать root scripts `npm run antarctica:extract-opening` и `npm run verify:antarctica-extraction` вместо ручного whole-file reading.
- extraction tooling теперь поддерживает targeted mode: `npm run antarctica:extract-step -- --line <lineIndex> --step <stepIndex>`, чтобы смотреть конкретный timeline block вместе с `previousStep` / `nextStep`.

## Следующие шаги по приоритету

1. Player-facing content DTO и endpoint (`GET /games/:gameId/player-content`) реализованы — `runtime-api` теперь sole owner загрузки `games/*`.
2. Transport/content split поддерживается: `player-api` отдаёт HTTP boundary, `content`-модуль загружает и проецирует manifest/design data.
3. Следующий Antarctica gameplay slice брать как ещё один небольшой manifest-driven fragment из `draft/Antarctica/Game.html` через scripts: targeted extractor уже показывает, что после первого board (`line 0 step 9`) следующим идёт info-block `i7` на `line 0 step 10`.
4. Двигать `apps/player-web` как canonical delivery layer и не возвращаться к draft-player структуре.
5. Добавлять persistence только после появления реального operational need.
6. Если появятся новые игры, расширять `packages/contracts/manifest` и manifest model, а не вводить ad hoc JSON shape.
7. Для ближайших Antarctica gameplay slices извлекать механику из `draft/Antarctica/Game.html` через scripts и переносить её в `games/antarctica/game.manifest.json` как в конечный исполнимый source of truth.

## Важные замечания

- `services/router`, `services/game-engine`, `services/game-repository` остаются legacy/service-boundary references.
- Канонический content source of truth для игры - `games/antarctica/`.
- `apps/player-web/` уже входит в current canonical slice и должен оставаться чистым от generated artifacts.
