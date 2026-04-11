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

Архитектурное правило для bounded manifest-driven gameplay mechanics теперь закреплено в `ADR-024`, а delivery-specific Antarctica slices `020..030` вынесены в `docs/architecture/gameplay-slices/`. Canonical runtime уже покрывает весь opening flow до terminal `i21`, включая step `19` board `25..30` с explicit `i12` follow-up, step `21` board `31..36` с explicit `i13` follow-up, step `23` loss-line switch, step `23` locked go-card `39` с bounded alt swap `3902`, step `26` public communication board `43..48` с explicit `i15` follow-up, step `28` trusted messengers board `49..54` с explicit `i16` follow-up, step `30` acceleration board `55..60` с explicit `i17` follow-up, step `32` scout dispatch board `61..66` с locked go-card `66` и explicit `i18` follow-up, а также final-tail boards `67..68` и `69..70` с `i19/i19_1` routing и terminal `i21`.

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
- The team-selection slice from `GSR-020` is implemented now: explicit member-selection actions, separate confirm action, visible public flags, and per-stage pick count tracking. Do not introduce a generic selector engine or payload-driven DSL for this slice. The field-level hooks should be `guard` and `stateUpdate` on each action definition.
- `GSR-022` is implemented now: `opening.info.i12.advance` reaches step `21`, explicit actions `opening.card.31` ... `opening.card.36` cover the full board, `opening.card.31/32/33/35/36` use bounded post-base conditional metric bonuses, and `opening.card.34` can switch to canonical line id `loss` when pre-action `stat < 25` while still applying its own base metric deltas.
- Mainline continuation after step `21` is explicit too under `GSR-023`: `opening.card.31/32/33/35/36.advance` lead to `i13`, `opening.info.i13.advance` opens board `37..42`, step `23` now implements the bounded locked/unlocked `39` and entry-time alt `3902` behavior, and explicit `opening.card.39.advance` / `opening.card.3902.advance` plus `opening.info.i14.advance` / `opening.info.i14_2.advance` reach the next mainline boundary at `stepIndex = 26`. The loss line continues through explicit `opening.info.i34.advance` and `opening.info.i34_2.advance` until `i21`.
- `GSR-025` is implemented now: explicit actions `opening.card.43` ... `opening.card.48` cover the public-communication board at `stepIndex = 26`, card-local bounded metric hooks reuse the existing conditional bonus mechanism, and go-card continuation remains explicit via `opening.card.43/45/47/48.advance` to `i15` plus `opening.info.i15.advance` to the next mainline boundary at `stepIndex = 28`.
- `GSR-026` is implemented now: explicit actions `opening.card.49` ... `opening.card.54` cover the trusted-messengers board at `stepIndex = 28`, bounded card-local metric hooks for `49` and `51` reuse the existing conditional bonus mechanism, and go-card continuation remains explicit via `opening.card.49/50/51/52/53/54.advance` to `i16` plus `opening.info.i16.advance` to the next mainline boundary at `stepIndex = 30`.
- `GSR-027` is implemented now: explicit actions `opening.card.55` ... `opening.card.60` cover the acceleration board at `stepIndex = 30`, bounded card-local metric hooks reuse the existing conditional bonus mechanism, and go-card continuation remains explicit via `opening.card.55/57/58/60.advance` to `i17` plus `opening.info.i17.advance` to the next mainline boundary at `stepIndex = 32`.
- `GSR-028` is implemented now: explicit actions `opening.card.61` ... `opening.card.66` cover the scout-dispatch board at `stepIndex = 32`, bounded `conditionalCardBonuses` model time bonuses from the status of cards `57` and `62`, and locked go-card `66` is opened through the existing board-local unlock hook on `62/63`; go-card continuation remains explicit via `opening.card.61/66.advance` to `i18` plus `opening.info.i18.advance` to the next mainline boundary at `stepIndex = 34`.
- `GSR-029` is implemented now: explicit actions `opening.card.67` ... `opening.card.70` cover the final aftermath/second-relocation tail, `timeline.activeInfoId` exposes the active info block, `opening.card.68.advance` resolves bounded `i19/i19_1` entry variants and a direct high-time loss jump to `i34_2`, and the main-line ending remains explicit via `opening.info.i19.advance`, `opening.card.69.advance`, and `opening.info.i20.advance` to terminal `i21`.

### Contract Freeze: Opening-Tail Player-Content (Boards 55-70, Infos i17-i21)

The opening-tail player-content contract is now **frozen and proven conformant** (2026-04-02):

- **Boards:** `opening.board.55_60` (stepIndex 30), `opening.board.61_66` (stepIndex 32), `opening.board.67_68` (stepIndex 34), `opening.board.69_70` (stepIndex 36)
- **Infos:** `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21` (terminal)
- **Cards:** 55-70 with correct `selectActionId` and go-card `advanceActionId`
- **Conformance Status:** ✅ 40/40 runtime-api tests pass
- **Runtime Projection:** `GET /games/antarctica/player-content` serves the complete DTO via `structuredClone(antarctica)`

The runtime projects `content.antarctica` directly to the player-facing DTO without exposing runtime-internal fields (`deterministic.provenance`, `deterministic.guard`, `deterministic.metricDeltas`, `deterministic.stateUpdate`).
- Integration coverage now proves the normal mainline path to `i13`, one post-base conditional bonus (`opening.card.31` from `cont = 10` to `cont = 11`), the low-stat card-34 loss branch to `loss` step `0` with explicit continuation to `i21`, the low-pro step-23 path where `39` starts locked and unlocks on the third resolved board card, the high-pro step-23 path where `3902` is exposed immediately and preserves `selectedCardId = "3902"`, the step-26 public communication board with both a non-go path (`opening.card.44`) and a conditional go path (`opening.card.48 -> i15 -> step 28`), the step-28 trusted-messengers board with a conditional go path (`opening.card.49 -> i16 -> step 30`), the step-30 acceleration board with both a non-go path (`opening.card.56`) and a conditional go path (`opening.card.60 -> i17 -> step 32`), the step-32 scout-dispatch board with both an unlock path (`opening.card.62 -> unlock 66`) and a bounded go path (`opening.card.66 -> i18 -> step 34`), and the final step-34 aftermath slice with fast-variant `i19_1`, default `i19`, and high-time loss jump to `i34_2`.
- Bounded player-facing delivery is no longer only a generic action catalog: `game.manifest.json` now includes `content.antarctica` for intro info `i0`, boards `1..6`, `7..12`, `13..18`, `19..24`, `25..30`, `31..36`, `37..42`, `43..48` and `49..54`, team-selection step `15`, plus infos `i7`, `i8`, `i9`, `i10`, `i11`, `i12`, `i13`, `i14`, `i14_2`, `i15` and `i16`, the content endpoint projects it directly, and `player-web` resolves those scenes from the current session snapshot with a safe fallback for unmigrated steps.

### Обновление по Multi-Screen UI Manifest Delivery (2026-04-09)

**Статус: ✅ Delivered**

Multi-screen UI boundary для Antarctica теперь реализован:

- **Multi-Screen UI Contract:** `packages/contracts/manifest` поддерживает `AntarcticaPlayerUiContent` с `screens` map. Additive относительно S1-only контракта, S1 consumers сохраняют обратную совместимость через `AntarcticaPlayerS1UiContent.screen` accessor.
- **Runtime Projection:** `GET /games/antarctica/player-content` возвращает полный `antarcticaUi` DTO с S1 entry screen и bounded opening-tail screens:
  - S2 boards: "55..60" (stepIndex 30), "61..66" (stepIndex 32), runtime content boards "67..68" (stepIndex 34) and "69..70" (stepIndex 36)
  - S1 info variants: i17, i18, i19, i19_1, i20, i21 (terminal)
- **Player-Web Rendering:** `apps/player-web` использует manifest-driven screen selection:
  - S2 boards: `stepIndex → boardKey` mapping в `resolveBoardScreenKey()`
  - S1 info variants: `activeInfoId` для disambiguation (i19 vs i19_1)
  - Fallback к action catalog для screens вне scope
- **Verification:** `npm run verify:canonical` проходит (61 runtime-api + 81 player-web тестов).

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
- нет distributed locking, multi-instance coordination;
- нет recovery worker;
- нет полноценного shared viewer/runtime package между apps.
- для `Antarctica` ещё не перенесён в manifest основной gameplay flow из `draft/Antarctica/GameFull.html`; `README.md` рядом с ним описывает структуру legacy-прототипа, а сам `GameFull.html` нужно анализировать scripts-based способом, а не читать целиком как prose-артефакт.
- для bounded extraction opening-flow использовать root scripts `npm run antarctica:extract-opening` и `npm run verify:antarctica-extraction` вместо ручного whole-file reading.
- extraction tooling теперь поддерживает targeted mode: `npm run antarctica:extract-step -- --line <lineIndex> --step <stepIndex>`, чтобы смотреть конкретный timeline block вместе с `previousStep` / `nextStep`.

## Следующие шаги по приоритету

1. Player-facing content DTO и endpoint (`GET /games/:gameId/player-content`) реализованы — `runtime-api` теперь sole owner загрузки `games/*`.
2. Transport/content split поддерживается: `player-api` отдаёт HTTP boundary, `content`-модуль загружает и проецирует manifest/design data.
3. Multi-screen UI boundary реализован: `antarcticaUi` поддерживает S1 entry screen и bounded opening-tail screens. Runtime player-facing content теперь разделяет final-tail boards на 67..68 (`stepIndex=34`) и 69..70 (`stepIndex=36`); web-specific screen key alignment for the split remains a follow-up.
4. UI boundary уже покрывает i17–i21; следующий этап может расширить его дальше по opening flow, не ломая fallback path для ещё не смоделированных step-ов.
5. Двигать `apps/player-web` как canonical delivery layer и не возвращаться к draft-player структуре.
6. Добавлять persistence только после появления реального operational need.
7. Если появятся новые игры, расширять `packages/contracts/manifest` и manifest model, а не вводить ad hoc JSON shape.
8. Для ближайших Antarctica gameplay slices извлекать механику из `draft/Antarctica/GameFull.html` через scripts и переносить её в `games/antarctica/game.manifest.json` как в конечный исполнимый source of truth.

## Важные замечания

- `services/router`, `services/game-engine`, `services/game-repository` остаются legacy/service-boundary references.
- Канонический content source of truth для игры - `games/antarctica/`.
- `apps/player-web/` уже входит в current canonical slice и должен оставаться чистым от generated artifacts.
