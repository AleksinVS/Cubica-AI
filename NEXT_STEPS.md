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

Следующий gameplay boundary закреплён в `ADR-021`: step `19` board `25..30` и step `20` i12 уже закрыты bounded threshold-based progression, а следующий открытый boundary теперь на `stepIndex = 21`, где останутся pending conditional metric gates / line switching. Threshold evaluation использует explicit board card ids / resolved-card count и не превращается в generic workflow engine.

## Текущая фаза

Следующий крупный этап уже собран в рабочий vertical slice:

- `games/antarctica/game.manifest.json` как source of truth для исполнимой логики;
- capability-based deterministic runtime в `services/runtime-api/`;
- канонический web-player scaffold в `apps/player-web/`;
- root-level verify scripts для `runtime-api` и `player-web`.

Оставшаяся работа теперь относится к фазе расширения, а не к базовому переходу.

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
4. Продолжать manifest-driven migration небольшими bounded slices: следующий кандидат - cross-board progression после первого opening board или следующий gameplay fragment из `GameFull.html`, а не возврат к уже покрытым card `1/2/3/4/5/6`.
5. Переход `first board -> i7 -> second board 7..12 -> i8 -> board 13..18 -> i9 -> step 15 -> i10 -> board 19..24 -> i11 -> board 25..30 -> i12` уже покрыт на manifest boundary level. Следующая естественная точка входа - boundary after `stepIndex = 20`, which leads to the unreached step `21` and is governed by the remaining conditional metric gates / line switching slice.
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
2. Для Antarctica maintain the bounded manifest-driven slices from `ADR-020` and `ADR-021`; the post-confirm path through `stepIndex = 20` is implemented, and the next boundary is the unreached step `21` with conditional metric gates / line switching still pending. Public shape for the team-selection slice remains `state.public.flags.team[memberId].selected`, `state.public.teamSelection.pickCount`, `state.public.teamSelection.selectedMemberIds`.
3. Подготовить `schemas/core`, `schemas/capabilities`, `schemas/api`.
4. Добавить validator/compiler tooling.
5. Зафиксировать policy для custom extensions.

## Приоритет 6. Repository Hygiene

1. Поддерживать `repo-manifest.json` и `PROJECT_STRUCTURE.md` синхронно с фактическими workspace-артефактами.
2. Явно размечать `actual / target / draft / archive / placeholder` только там, где это помогает агентам не путать канонические и draft-слои.
3. Держать root-level `verify:*` scripts в актуальном состоянии, чтобы следующий агент мог быстро проверить текущий canonical slice.
