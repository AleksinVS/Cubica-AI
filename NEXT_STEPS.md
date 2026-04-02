# Next Steps

Документ фиксирует ближайшие инженерные шаги по развитию Cubica после перехода к AI/Code-first ядру, появления `services/runtime-api/` и канонического `apps/player-web/`.

## Truth Model для Antarctica

- `games/antarctica/game.manifest.json` — канонический source of truth для исполнимой логики игры.
- `games/antarctica/` — канонический content layer и рабочая заготовка игры.
- `games/antarctica/design/mockups/` — source of truth для UI mockups и экранного намерения.
- `draft/Antarctica/GameFull.html` — текущий фактический источник для извлечения сценария и игровой механики `Antarctica` в ходе миграции. Это текущее состояние миграции, а не архитектурное решение, до завершения переноса логики в manifest.
- `draft/Antarctica/README.md` — reference по устройству legacy HTML-прототипа и guide по его структуре; использовать вместе со script-based анализом `GameFull.html`, а не как целевую архитектуру.
- `draft/antarctica-nextjs-player/` — UI prototype/reference for visual ideas only, не source of truth для кода, структуры, архитектуры или логики.

Архитектурное правило по-прежнему закреплено в `ADR-018`: исполнимая логика должна заканчиваться в JSON manifest. `GameFull.html` используется только как текущий migration/source artifact для извлечения этой логики.

Следующий канонический boundary step по delivery закреплён в `ADR-019`: `services/runtime-api` должен владеть загрузкой игрового контента и отдавать player-facing content DTO/API, а `apps/player-web` должен перестать читать repo files напрямую.

Архитектурное правило для bounded manifest-driven gameplay mechanics теперь закреплено в `ADR-024`, а delivery-specific Antarctica slices `020..029` вынесены в `docs/architecture/gameplay-slices/`. Canonical runtime уже покрывает весь opening flow до terminal `i21`, включая step `21` loss-line switch, step `23` locked go-card `39` с bounded alt swap `3902`, step `26` public communication board `43..48` с explicit `i15` follow-up, step `28` trusted messengers board `49..54` с explicit `i16` follow-up, step `30` acceleration board `55..60` с explicit `i17` follow-up, step `32` scout dispatch board `61..66` с locked go-card `66` и explicit `i18` follow-up, а также финальный step `34` aftermath slice `67..70` с `i19/i19_1` routing и terminal `i21`.

## Текущая фаза

Следующий крупный этап уже собран в рабочий vertical slice:

- `games/antarctica/game.manifest.json` как source of truth для исполнимой логики;
- capability-based deterministic runtime в `services/runtime-api/`;
- канонический web-player scaffold в `apps/player-web/`;
- root-level verify scripts для `runtime-api` и `player-web`.

Оставшаяся работа теперь относится к фазе расширения, а не к базовому переходу.

### Обновление по bounded player-facing content slice

- `games/antarctica/game.manifest.json` теперь содержит канонический `content.antarctica` block для bounded player-facing delivery slice: info scenes `i0`, `i7`, `i8`, `i9`, `i10`, `i11`, `i12`, `i13`, `i14`, `i14_2`, `i15` и `i16`, boards `opening.board.1_6`, `opening.board.7_12`, `opening.board.13_18`, `opening.board.19_24`, `opening.board.25_30`, `opening.board.31_36`, `opening.board.37_42`, `opening.board.43_48` и `opening.board.49_54`, team-selection step `15`, а также card catalog `1..54` plus alt-card `3902` с явными `selectActionId` и `advanceActionId` для go-card `3`, `9`, `18`, `22`, `23`, `31`, `32`, `33`, `35`, `36`, `39`, `3902`, `43`, `45`, `47`, `48`, `49`, `50`, `51`, `52`, `53` и `54`.
- `packages/contracts/manifest` и `services/runtime-api/src/modules/content/manifestValidation.ts` расширены typed/validated shape для этого Antarctica-specific player content, не вводя новый platform-wide endpoint или DSL.
- `GET /games/antarctica/player-content` теперь отдаёт не только общий catalog `actions/mockups`, но и structured `antarctica` DTO из manifest.
- `apps/player-web` начал использовать existing session snapshot (`timeline`, `activeInfoId`, `selectedCardId`, card flags, team flags, teamSelection state) для current-step rendering: стартовый info `i0`, boards `1..6`, `7..12`, `13..18`, `19..24`, `25..30`, `31..36`, `37..42`, `43..48` и `49..54`, team-selection step `15`, а также info `i7`, `i8`, `i9`, `i10`, `i11`, `i12`, `i13`, `i14`, `i14_2`, `i15` и `i16` больше не требуют global action catalog как основной UX.
- Для немоделированных шагов player по-прежнему безопасно откатывается к fallback catalog, поэтому slice остаётся bounded и не требует синхронной миграции всего opening flow.

### Обновление по первому gameplay slice (opening card 3)

- В `games/antarctica/game.manifest.json` добавлен первый реальный deterministic data slice для `opening.card.3` (legacy card `3`, «Поговорить с Аленой»): provenance, guard, metric deltas, log metadata и state-update metadata теперь лежат в manifest.
- В `games/antarctica/game.manifest.json` добавлен минимальный explicit reachability path до первого board-экрана: отдельные deterministic intro actions `opening.info.i0.advance` ... `opening.info.i6.advance`, которые последовательно ведут `stepIndex` `0..8 -> 9`.
- Для этих intro actions deterministic metadata хранится только в manifest (legacy provenance по `i0/i02/i03/i1/i2/i3/i4/i5/i6`, guard по `line/step/canAdvance`, `metricDeltas: []`, log metadata, `stateUpdate` c `timelineStepIndex/timelineStageId/timelineScreenId` и `timelineCanAdvance: false`).
- В initial state добавлены минимальные scaffolding-поля под этот slice: `state.public.timeline.canAdvance`, `state.public.flags.cards["3"]`, `state.secret.opening.selectedCardId` (через `state.secret.opening`).
- В `services/runtime-api/src/modules/content/manifestValidation.ts` добавлена ранняя валидация deterministic metadata и новых state-полей.
- В `services/runtime-api` manifest-driven runtime wiring уже подключён: explicit intro actions и `opening.card.3` исполняются через `POST /actions`, timeline aliases (`stepIndex/step_index`, `stageId/stage_id`, `screenId/screen_id`) синхронизируются, а guard failures теперь возвращаются как `400`, а не `500`.
- Integration tests покрывают полный bounded path: старт на intro step `0`, последовательный переход к board step `9`, успешное применение `opening.card.3`, отказ на replay и отказ на ранний вызов card action до достижения board.
- Первый opening board больше не ограничен одной живой картой: deterministic manifest-actions добавлены для `opening.card.1`, `opening.card.2`, `opening.card.4`, `opening.card.5`, `opening.card.6`, а runtime уже умеет исполнять их без отдельного нового DSL.
- Integration tests теперь покрывают и multi-card path: non-go card на первом board сохраняет `canAdvance=false`, обновляет метрики, блокирует replay только для себя и не мешает затем выбрать `opening.card.3` как go-card.
- Timeline progression после first board тоже стал исполнимым: explicit actions `opening.card.3.advance` и `opening.info.i7.advance` теперь доводят сессию от first board к info-block `i7` и дальше ко второму board `7..12`.
- Второй board `7..12` тоже теперь покрыт manifest-driven actions; non-go cards работают без перехода вперёд, а `opening.card.9` стал следующей go-card на шаге `11`.
- После `opening.card.9` теперь есть explicit progression path: `opening.card.9.advance` переводит в info-block `i8` (`stepIndex=12`, `screenId=S1`), а `opening.info.i8.advance` переводит на третий board `13..18` (`stepIndex=13`, `screenId=S2`).
- Третий board `13..18` теперь покрыт manifest-driven actions; non-go cards `13/14/15/16/17` сохраняют `selectedCardId = "9"` и `canAdvance = false`, а `opening.card.18` является текущей go-card для этого board и фиксирует `selectedCardId = "18"` вместе с `timeline.canAdvance = true`.
- Добавлен следующий boundary slice после `opening.card.18`: `opening.card.18.advance` ведёт к info block `i9`, а `opening.info.i9.advance` доводит сессию до step `15`, still `stage_intro`, с bounded team-selection mechanic уже в manifest.
- Следующий slice после этого boundary теперь закрывает post-confirm path `stepIndex = 16 -> 17 -> 18`: `opening.info.i10.advance` открывает board `19..24`, cards `22/23` are go-cards, and matching advance actions land on `i11` at `stepIndex = 18`.
- `GSR-022` теперь тоже закрыт: `opening.info.i12.advance` доводит до step `21`, explicit actions `opening.card.31` ... `opening.card.36` покрывают весь board, card-local conditional bonuses для `31/32/33/35/36` исполняются после base metric deltas, а card `34` может bounded-переключить timeline на canonical line id `loss` по pre-action gate `stat < 25`, сохраняя свои base deltas.
- Mainline после step `21` теперь тоже явный по `GSR-023`: `opening.card.31/32/33/35/36.advance` ведут к `i13`, `opening.info.i13.advance` открывает board `37..42`, bounded step-23 mechanics now cover locked/unlocked `39` plus entry-time alt `3902`, а explicit `opening.card.39.advance` / `opening.card.3902.advance` вместе с `opening.info.i14.advance` и `opening.info.i14_2.advance` доводят mainline до следующего boundary на `stepIndex = 26`. Losing line продолжен отдельными explicit actions `opening.info.i34.advance` и `opening.info.i34_2.advance` до `i21`.
- `GSR-025` теперь тоже закрыт: explicit actions `opening.card.43` ... `opening.card.48` покрывают board `43..48`, bounded card-local hooks используют только уже существующие metric bonuses, а go-card follow-up остаётся explicit через `opening.card.43/45/47/48.advance` к `i15` и `opening.info.i15.advance` к следующему boundary на `stepIndex = 28`.
- `GSR-026` теперь тоже закрыт: explicit actions `opening.card.49` ... `opening.card.54` покрывают trusted messengers board `49..54`, bounded card-local hooks для `49` и `51` используют только уже существующие conditional metric bonuses, а go-card follow-up остаётся explicit через `opening.card.49/50/51/52/53/54.advance` к `i16` и `opening.info.i16.advance` к следующему boundary на `stepIndex = 30`.
- `GSR-027` теперь тоже закрыт: explicit actions `opening.card.55` ... `opening.card.60` покрывают acceleration board `55..60`, bounded card-local hooks используют только уже существующие conditional metric bonuses, а go-card follow-up остаётся explicit через `opening.card.55/57/58/60.advance` к `i17` и `opening.info.i17.advance` к следующему boundary на `stepIndex = 32`.
- `GSR-028` теперь тоже закрыт: explicit actions `opening.card.61` ... `opening.card.66` покрывают scout-dispatch board `61..66`, bounded `conditionalCardBonuses` моделируют локальные time bonuses от статуса карточек `57` и `62`, `opening.card.66` стартует заблокированной и открывается через уже существующий bounded unlock hook на `opening.card.62/63`, а go-card follow-up остаётся explicit через `opening.card.61/66.advance` к `i18` и `opening.info.i18.advance` к следующему boundary на `stepIndex = 34`.
- `GSR-029` теперь тоже закрыт: explicit actions `opening.card.67` ... `opening.card.70` покрывают финальный aftermath/second-relocation tail, `opening.card.68.advance` использует bounded `activeInfoId` + conditional info variant для `i19/i19_1` и explicit loss jump к `i34_2`, а mainline ending остаётся explicit через `opening.info.i19.advance`, `opening.card.69.advance` и `opening.info.i20.advance` к terminal `i21`.

### Contract Freeze: Opening-Tail Player-Content (Boards 55-70, Infos i17-i21)

Контракт opening-tail player-content **заморожен и подтверждён конформным** (2026-04-02):

- **Boards:** `opening.board.55_60` (stepIndex 30), `opening.board.61_66` (stepIndex 32), `opening.board.67_70` (stepIndex 34)
- **Infos:** `i17`, `i18`, `i19`, `i19_1`, `i20`, `i21` (terminal)
- **Cards:** 55-70 с корректными `selectActionId` и go-card `advanceActionId`
- **Status конформности:** ✅ 40/40 runtime-api тестов проходят
- **Runtime projection:** `GET /games/antarctica/player-content` отдаёт полный DTO через `structuredClone(antarctica)`

Runtime проецирует `content.antarctica` напрямую в player-facing DTO без раскрытия internal-полей (`deterministic.provenance`, `deterministic.guard`, `deterministic.metricDeltas`, `deterministic.stateUpdate`).

## Приоритет 1. Complete the Antarctica Truth Model

1. Довести `packages/contracts/session` и `packages/contracts/runtime` до полного набора DTO для session/action/result.
2. Заполнить `packages/contracts/manifest` типами manifest bundle, action definitions, content metadata и design references.
3. Явно описать в `games/antarctica/game.manifest.json` основные сущности игры `Antarctica`, извлекая их из `draft/Antarctica/GameFull.html`, `draft/Antarctica/README.md` и текущей заготовки в `games/antarctica/`.
4. Ввести schema validation для `game.manifest.json`.
5. Для анализа `draft/Antarctica/GameFull.html` использовать scripts и targeted extraction, а не чтение всего legacy HTML-файла как prose-источника.
6. Для opening-flow extraction использовать `npm run antarctica:extract-opening` и проверку `npm run verify:antarctica-extraction`; не выполнять ручной разбор всего `draft/Antarctica/GameFull.html`.
7. Для анализа конкретного timeline step использовать targeted CLI: `npm run antarctica:extract-step -- --line <lineIndex> --step <stepIndex>`. Команда возвращает selected block, referenced entries и compact context (`previousStep` / `nextStep`).

## Приоритет 2. Harden Runtime API

1. Сделать `runtime-api` единственным владельцем загрузки `games/*` для runtime и player-facing delivery, как зафиксировано в `ADR-019`.
2. Добавить player-facing content DTO (объект передачи данных) и API для `Antarctica`, чтобы `player-web` получал manifest/design projection через backend boundary.
3. Расширять deterministic handler layer от текущего capability routing к предметным handlers для реальной механики `Antarctica`, извлечённой из `draft/Antarctica/GameFull.html`.
4. Первый bounded player-facing delivery slice уже закрыт для `i0 -> board 1..6 -> i7`, а последующие bounded extensions добавили `board 7..12 -> i8`, `board 13..18 -> i9`, `step 15 team-selection`, `i10`, `board 19..24`, `i11`, `board 25..30`, `i12`, `board 31..36`, `i13`, `board 37..42`, `i14`, `i14_2`, `board 43..48`, `i15`, `board 49..54` и `i16`; следующий этап должен расширить current-step rendering дальше по opening flow, сохраняя manifest-driven content projection и fallback для ещё не перенесённых step-ов.
5. Переход `first board -> i7 -> second board 7..12 -> i8 -> board 13..18 -> i9 -> step 15 -> i10 -> board 19..24 -> i11 -> board 25..30 -> i12 -> board 31..36 -> i13 -> board 37..42 -> i14 -> i14_2 -> board 43..48 -> i15 -> board 49..54 -> i16 -> board 55..60 -> i17 -> board 61..66 -> i18 -> board 67..68 -> i19/i19_1 -> board 69..70 -> i20 -> i21` уже покрыт на manifest boundary level, включая bounded line switch на loss line `i34 -> i34_2 -> i21`, locked/unlocked go-card `39`, entry-time alt `3902`, explicit public-communication board progression, trusted-messengers board progression, acceleration board progression, scout-dispatch progression и terminal aftermath ending.
6. Довести manifest validation до более строгих семантических правил, когда это станет нужно для новых игр.
7. Добавить `readiness` и runtime health signals, если появится отдельный deploy/runtime boundary.
8. Подготовить persistence, когда in-memory session store перестанет быть достаточным.

## Приоритет 3. Introduce Full Contracts Layer

1. Заполнить `packages/contracts/session` и `packages/contracts/runtime` DTO только по мере появления новых потребителей.
2. Продолжить расширять `packages/contracts/manifest` под новые game types и capabilities.
3. Добавлять `packages/contracts/ai` только когда появится реальный AI execution path, а не абстрактный placeholder.
4. Переводить SDK и вспомогательные tools на contracts layer по мере фактической интеграции.

## Приоритет 4. Build Player-Web from Canonical Sources

1. Развивать `apps/player-web` как канонический web delivery layer для `Antarctica`.
2. Перевести `apps/player-web` на player-facing content API/DTO из `runtime-api` и считать прямое чтение `games/*` временным состоянием до миграции.
3. Подключать новые UI-паттерны только через canonical content/model layer, а не через draft-player структуру.
4. Если появятся новые платформы или каналы, сначала выделять shared viewer/runtime contracts, а потом уже отдельные apps.

## Приоритет 5. Manifest and Capability Evolution

1. Ввести capability-first схему вместо игры-специфичных ad hoc расширений.
2. Для Antarctica maintain the bounded manifest-driven slices from `GSR-020`, `GSR-021`, `GSR-022`, `GSR-023`, `GSR-025`, `GSR-026`, `GSR-027`, `GSR-028` и `GSR-029` под архитектурными ограничениями `ADR-024`; opening progression now reaches terminal `i21`, step `21` is implemented with explicit `i12.advance`, explicit cards `31..36`, post-base conditional metric gates, bounded card-34 line switch with explicit loss-line continuation `i34 -> i34_2 -> i21`, step `23` is implemented with explicit cards `37..42`, locked go-card `39`, bounded unlock39-style threshold, entry-time alt swap `39 -> 3902`, and explicit `i14 -> i14_2`, step `26` is implemented with explicit cards `43..48`, bounded metric hooks, explicit go-card follow-up to `i15`, and explicit `i15.advance`, step `28` is implemented with explicit cards `49..54`, bounded metric hooks for `49` and `51`, explicit go-card follow-up to `i16`, and explicit `i16.advance`, step `30` is implemented with explicit cards `55..60`, bounded metric hooks, explicit go-card follow-up to `i17`, and explicit `i17.advance`, step `32` is implemented with explicit cards `61..66`, bounded `conditionalCardBonuses`, locked go-card `66`, explicit unlock through `62/63`, and explicit `i18.advance`, while step `34` is implemented with explicit cards `67..70`, `timeline.activeInfoId`, bounded `i19/i19_1` entry resolution, direct high-time loss jump to `i34_2`, and explicit `i20 -> i21` ending. Public shape for the team-selection slice remains `state.public.flags.team[memberId].selected`, `state.public.teamSelection.pickCount`, `state.public.teamSelection.selectedMemberIds`.
3. Подготовить `schemas/core`, `schemas/capabilities`, `schemas/api`.
4. Добавить validator/compiler tooling.
5. Зафиксировать policy для custom extensions.

## Приоритет 6. Repository Hygiene

1. Поддерживать `repo-manifest.json` и `PROJECT_STRUCTURE.md` синхронно с фактическими workspace-артефактами.
2. Явно размечать `actual / target / draft / archive / placeholder` только там, где это помогает агентам не путать канонические и draft-слои.
3. Держать root-level `verify:*` scripts в актуальном состоянии, чтобы следующий агент мог быстро проверить текущий canonical slice.
