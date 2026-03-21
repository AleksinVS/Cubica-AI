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

`ADR-022` теперь реализован: bounded threshold-based board progression на board `25..30` и переход к `i12` из `ADR-021` расширены explicit step-21 slice с `i12.advance`, cards `31..36`, bounded conditional metric gates, bounded card-34 line switch и explicit losing line `loss -> i34 -> i34_2 -> i21`. Следующий открытый gameplay boundary теперь зафиксирован в `ADR-023`: `stepIndex = 23` с explicit board `37..42`, locked go-card `39`, bounded unlock after three resolved cards, entry-time alt swap `39 -> 3902` при `pro > 40` и explicit follow-up `i14 -> i14_2`. Generic workflow/rule engine и generic selector DSL для этого slice не вводятся. После реализации `ADR-023` следующим открытым mainline boundary станет `stepIndex = 26` с cards `43..48`.

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
- После `opening.card.3` теперь есть explicit progression path: `opening.card.3.advance` переводит в info-block `i7` (`stepIndex=10`, `screenId=S1`), а `opening.info.i7.advance` переводит на второй board `7..12` (`stepIndex=11`, `screenId=S2`).
- Второй board `7..12` теперь тоже покрыт явными deterministic actions. Non-go cards `7/8/10/11/12` сохраняют `selectedCardId = "3"` и `canAdvance = false`, а `opening.card.9` является текущей go-card для этого board и переводит `selectedCardId` в `"9"` вместе с `timeline.canAdvance = true`.
- После `opening.card.9` теперь есть explicit progression path: `opening.card.9.advance` переводит в info-block `i8` (`stepIndex=12`, `screenId=S1`), а `opening.info.i8.advance` переводит на третий board `13..18` (`stepIndex=13`, `screenId=S2`).
- Третий board `13..18` теперь покрыт manifest-driven actions. Non-go cards `13/14/15/16/17` сохраняют `selectedCardId = "9"` и `canAdvance = false`, а `opening.card.18` является текущей go-card для этого board и фиксирует `selectedCardId = "18"` вместе с `timeline.canAdvance = true`.
- Boundary after `opening.card.18` is now explicit too: `opening.card.18.advance` lands on legacy info block `i9` (`stepIndex=14`), and `opening.info.i9.advance` reaches the team-selection boundary at `stepIndex=15` while keeping `stage_intro` and `selectedCardId = "18"`.
- The team-selection slice from ADR-020 is implemented now: explicit member-selection actions, separate confirm action, visible public flags, and per-stage pick count tracking. Do not introduce a generic selector engine or payload-driven DSL for this slice. The field-level hooks should be `guard` and `stateUpdate` on each action definition.
- `ADR-022` is implemented now: `opening.info.i12.advance` reaches step `21`, explicit actions `opening.card.31` ... `opening.card.36` cover the full board, `opening.card.31/32/33/35/36` use bounded post-base conditional metric bonuses, and `opening.card.34` can switch to canonical line id `loss` when pre-action `stat < 25` while still applying its own base metric deltas.
- Mainline continuation after step `21` is explicit too: `opening.card.31/32/33/35/36.advance` lead to `i13`, `opening.info.i13.advance` reaches the next boundary now formalized by `ADR-023` at `stepIndex = 23`, and the loss line continues through explicit `opening.info.i34.advance` and `opening.info.i34_2.advance` until `i21`.
- Integration coverage now proves the normal mainline path to `i13` and the step-23 boundary, one post-base conditional bonus (`opening.card.31` from `cont = 10` to `cont = 11`), and the low-stat card-34 loss branch to `loss` step `0` with explicit continuation to `i21`.

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
- team-selection mechanics for step `15` are implemented, and the post-confirm path now reaches the next open gameplay boundary described by `ADR-023` at `stepIndex = 23`; cards `37..42` and later gameplay slices are still unreached in canonical runtime;
- нет полноценного shared viewer/runtime package между apps.
- для `Antarctica` ещё не перенесён в manifest основной gameplay flow из `draft/Antarctica/GameFull.html`; `README.md` рядом с ним описывает структуру legacy-прототипа, а сам `GameFull.html` нужно анализировать scripts-based способом, а не читать целиком как prose-артефакт.
- для bounded extraction opening-flow использовать root scripts `npm run antarctica:extract-opening` и `npm run verify:antarctica-extraction` вместо ручного whole-file reading.
- extraction tooling теперь поддерживает targeted mode: `npm run antarctica:extract-step -- --line <lineIndex> --step <stepIndex>`, чтобы смотреть конкретный timeline block вместе с `previousStep` / `nextStep`.

## Следующие шаги по приоритету

1. Player-facing content DTO и endpoint (`GET /games/:gameId/player-content`) реализованы — `runtime-api` теперь sole owner загрузки `games/*`.
2. Transport/content split поддерживается: `player-api` отдаёт HTTP boundary, `content`-модуль загружает и проецирует manifest/design data.
3. Следующий Antarctica gameplay slice - реализация `ADR-023` для mainline `stepIndex = 23` с cards `37..42`, locked go-card `39`, bounded unlock39-style threshold и entry-time alt swap `39 -> 3902` после уже внедрённых `ADR-020`, `ADR-021` и `ADR-022`. После этого slice следующим открытым mainline boundary станет `stepIndex = 26` с cards `43..48`.
4. Двигать `apps/player-web` как canonical delivery layer и не возвращаться к draft-player структуре.
5. Добавлять persistence только после появления реального operational need.
6. Если появятся новые игры, расширять `packages/contracts/manifest` и manifest model, а не вводить ad hoc JSON shape.
7. Для ближайших Antarctica gameplay slices извлекать механику из `draft/Antarctica/GameFull.html` через scripts и переносить её в `games/antarctica/game.manifest.json` как в конечный исполнимый source of truth.

## Важные замечания

- `services/router`, `services/game-engine`, `services/game-repository` остаются legacy/service-boundary references.
- Канонический content source of truth для игры - `games/antarctica/`.
- `apps/player-web/` уже входит в current canonical slice и должен оставаться чистым от generated artifacts.
