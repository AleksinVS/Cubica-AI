# Next Steps

Документ фиксирует ближайшие инженерные шаги по развитию Cubica после перехода к AI/Code-first ядру, появления `services/runtime-api/` и канонического `apps/player-web/`.

## Truth Model для Antarctica

- `games/antarctica/game.manifest.json` — канонический source of truth для исполнимой логики игры.
- `games/antarctica/` — канонический content layer и рабочая заготовка игры.
- `games/antarctica/design/mockups/` — source of truth для UI mockups и экранного намерения.
- `draft/Antarctica/Game.html` — текущий фактический источник для извлечения сценария и игровой механики `Antarctica` в ходе миграции. Это не архитектурное решение, а констатация текущего состояния до завершения переноса логики в manifest.
- `draft/Antarctica/README.md` — reference по устройству legacy HTML-прототипа и guide по его структуре; использовать вместе со script-based анализом `Game.html`, а не как целевую архитектуру.
- `draft/antarctica-nextjs-player/` — UI prototype/reference for visual ideas only, не source of truth для кода, структуры, архитектуры или логики.

Архитектурное правило по-прежнему закреплено в `ADR-018`: исполнимая логика должна заканчиваться в JSON manifest. `Game.html` используется только как текущий migration/source artifact для извлечения этой логики.

Следующий канонический boundary step закреплён в `ADR-019`: `services/runtime-api` должен владеть загрузкой игрового контента и отдавать player-facing content DTO/API, а `apps/player-web` должен перестать читать repo files напрямую.

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
- Следующий slice должен расширять предметную механику `Antarctica` дальше по manifest, а не возвращаться к capability-only plumbing.

## Приоритет 1. Complete the Antarctica Truth Model

1. Довести `packages/contracts/session` и `packages/contracts/runtime` до полного набора DTO для session/action/result.
2. Заполнить `packages/contracts/manifest` типами manifest bundle, action definitions, content metadata и design references.
3. Явно описать в `games/antarctica/game.manifest.json` основные сущности игры `Antarctica`, извлекая их из `draft/Antarctica/Game.html`, `draft/Antarctica/README.md` и текущей заготовки в `games/antarctica/`.
4. Ввести schema validation для `game.manifest.json`.
5. Для анализа `draft/Antarctica/Game.html` использовать scripts и targeted extraction, а не чтение всего legacy HTML-файла как prose-источника.
6. Для opening-flow extraction использовать `npm run antarctica:extract-opening` и проверку `npm run verify:antarctica-extraction`; не выполнять ручной разбор всего `draft/Antarctica/Game.html`.
7. Для анализа конкретного timeline step использовать targeted CLI: `npm run antarctica:extract-step -- --line <lineIndex> --step <stepIndex>`. Команда возвращает selected block, referenced entries и compact context (`previousStep` / `nextStep`).

## Приоритет 2. Harden Runtime API

1. Сделать `runtime-api` единственным владельцем загрузки `games/*` для runtime и player-facing delivery, как зафиксировано в `ADR-019`.
2. Добавить player-facing content DTO (объект передачи данных) и API для `Antarctica`, чтобы `player-web` получал manifest/design projection через backend boundary.
3. Расширять deterministic handler layer от текущего capability routing к предметным handlers для реальной механики `Antarctica`, извлечённой из `draft/Antarctica/Game.html`.
4. Продолжать manifest-driven migration небольшими bounded slices: следующий кандидат - cross-board progression после первого opening board или следующий gameplay fragment из `Game.html`, а не возврат к уже покрытым card `1/2/3/4/5/6`.
5. Новый targeted extractor уже показывает, что после first board (`line 0 step 9`) следующим шагом идёт `line 0 step 10` с info-block `i7` («Отнеситесь к этому серьезно!»); это естественная точка входа для следующего runtime/data slice.
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
2. Подготовить `schemas/core`, `schemas/capabilities`, `schemas/api`.
3. Добавить validator/compiler tooling.
4. Зафиксировать policy для custom extensions.

## Приоритет 6. Repository Hygiene

1. Поддерживать `repo-manifest.json` и `PROJECT_STRUCTURE.md` синхронно с фактическими workspace-артефактами.
2. Явно размечать `actual / target / draft / archive / placeholder` только там, где это помогает агентам не путать канонические и draft-слои.
3. Держать root-level `verify:*` scripts в актуальном состоянии, чтобы следующий агент мог быстро проверить текущий canonical slice.
