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

### Обновление по S1 UI Manifest & Mockup Alignment (2026-04-08)

**Статус: ✅ Completed**

Цель по приведению UI Antarctica к UI-манифесту и мокапу `left-sidebar-6-cards` полностью достигнута:

- **Manifest-Driven Renderer:** `apps/player-web` теперь использует `AntarcticaS1Renderer`, который динамически строит UI из `antarcticaUi` (получаемого через `runtime-api`). Поддерживаются вложенные области (`main-content-area`, `cards-container`, `bottom-controls-container`), 6 карточек (grid 3x2), и sidebar метрики.
- **Mockup Alignment:** CSS в `globals.css` полностью соответствует композиции мокапа:
  - Левый сайдбар (260px) с метриками и иконками.
  - Основная область (900px) с сеткой карточек 3x2 (gap 24).
  - Нижняя панель управления с кнопками «Подсказка» и «Журнал ходов».
  - Правая декоративная зона (370px) с арктическим фоном и плейсхолдером.
- **Asset Policy:** Каноническая политика ассетов реализована через `apps/player-web/public/images/**`. Все иконки метрик, фоны и кнопки доступны по root-relative путям, прописанным в манифесте.
- **Testing & Verification:** 
  - Добавлены DOM/Snapshot тесты в `src/components/antarctica-s1-renderer.test.tsx`.
  - Обновлены и исправлены интеграционные тесты в `src/components/antarctica-player-dom.test.tsx`.
  - `npm run verify:canonical` проходит успешно.

**Результат:** Opening экран `S1` теперь является полностью управляемым данными (data-driven) и визуально соответствует целевому дизайну. Следующие шаги могут быть направлены на расширение поддержки других типов компонентов или экранов по мере необходимости.

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
7. `readiness` endpoint добавлен в scaffold phase (проверяет in-process content subsystem и session store mode). Расширять на внешние зависимости не требуется до появления реального distributed deployment.
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
