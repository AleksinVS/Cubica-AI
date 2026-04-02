# ROADMAP

Назначение документа: стратегический план работ по Cubica.

Этот файл отвечает на три вопроса:

- куда движется проект;
- в какой последовательности мы идём;
- какие блоки нужно делать следующими.

Подробные задачи, чек-листы и рабочая декомпозиция должны жить в отдельных файлах под `docs/tasks/`, а не в этом документе.

## North Star

Cubica должна стать платформой, в которой:

- игру можно описать как данные в `games/<id>/game.manifest.json`;
- runtime стабильно исполняет эту игру через `services/runtime-api/`;
- игрок получает понятный интерфейс через `apps/player-web/` и будущие каналы доставки;
- команда может постепенно добавлять новые игры, не ломая уже работающий сценарий;
- позже поверх этого ядра можно безопасно добавить редактор, каталог, аналитику и LLM-помощников.

## Current State

Текущая каноническая архитектура (каноническая = та, которую считаем источником истины и на которую должны опираться новые изменения) уже определена:

- `games/antarctica/game.manifest.json` — источник истины для исполнимой логики `Antarctica`;
- `games/antarctica/design/mockups/` — источник истины для UI-намерения;
- `services/runtime-api/` — канонический backend runtime;
- `apps/player-web/` — канонический web delivery слой;
- `packages/contracts/*` — общий слой контрактов между частями системы;
- `draft/Antarctica/GameFull.html` — только factual extraction source (файл, из которого мы извлекаем legacy-механику во время миграции), но не runtime source of truth.

Что уже достигнуто:

- opening flow `Antarctica` доведён в manifest-driven runtime до terminal `i21`;
- player-facing content boundary для opening-tail (`boards 55..70`, `infos i17..i21`) уже заморожен и подтверждён;
- `runtime-api` уже владеет player-facing content projection для текущего канонического среза.

Главный смысл текущей фазы: мы уже не строим базовую архитектуру с нуля. Мы расширяем работающий канонический срез до полноценного продукта.

## Strategic Phases

### Phase 1. Finish Canonical Antarctica Delivery

Результат:

- весь важный пользовательский путь `Antarctica` работает через канонический manifest + runtime + player-web;
- `apps/player-web` больше не зависит от чтения repo files как от runtime-источника;
- команда может уверенно развивать игру без возврата к legacy-логике.

Успех выглядит так:

- player-web рендерит весь ближайший целевой путь из runtime-owned DTO;
- новые bounded gameplay slices (ограниченные игровые блоки миграции) добавляются без ломки уже работающих шагов;
- fallback path остаётся безопасным для ещё не перенесённых частей.

Главные зависимости и риски:

- качество извлечения механик из legacy `GameFull.html`;
- риск случайно смешать public DTO и runtime-internal поля;
- риск вернуть прямое чтение `games/*` в delivery-слой.

### Phase 2. Harden Runtime And Contracts

Результат:

- runtime становится надёжной платформенной опорой, а не только рабочим prototype backend;
- contracts layer описывает реальные потребности runtime, player и следующих каналов доставки;
- проверки становятся более строгими и лучше защищают от архитектурного дрейфа.

Успех выглядит так:

- есть понятные DTO и runtime boundaries;
- есть readiness/health/persistence roadmap с минимальными architectural surprises;
- новые изменения проходят через проверяемые contracts и validation rules.

Главные зависимости и риски:

- нельзя переусложнить слой контрактов раньше времени;
- нельзя вводить generic engine/DSL без подтверждённого повторного use case;
- operational hardening не должно тормозить ближайший product delivery.

### Phase 3. Build A Stable Multi-Game Delivery Foundation

Результат:

- архитектура готова не только для `Antarctica`, но и для следующих игр;
- delivery contracts и runtime capabilities можно переиспользовать;
- новые каналы доставки можно подключать без архитектурного развала.

Успех выглядит так:

- новые игры могут идти через тот же truth model;
- viewer/runtime contracts не завязаны только на один сценарий;
- повторное использование пакетов и DTO реально работает.

Главные зависимости и риски:

- преждевременное обобщение;
- смешение game-specific и platform-wide решений;
- потеря прозрачности source-of-truth правил.

### Phase 4. Launch Authoring And Editorial Workflows

Результат:

- появляется реальный путь от создания игры к публикации;
- редактор, методические материалы и authoring-помощники строятся уже на стабильном ядре;
- команда перестаёт зависеть только от ручного редактирования manifest-файлов.

Успех выглядит так:

- есть MVP game editor;
- структура authoring flow опирается на канонические contracts;
- редактирование не ломает runtime truth model.

Главные зависимости и риски:

- editor нельзя строить поверх draft-архитектуры;
- authoring UX не должен диктовать runtime-модель в обход архитектурных правил.

### Phase 5. Prepare Platform Operations And Business Scale

Результат:

- каталог, лицензирование, аналитика, наблюдаемость и мультиканальность переходят из target-идей в реальные workstreams;
- платформа готовится к нескольким играм, нескольким клиентским каналам и рабочей операционной модели.

Успех выглядит так:

- roadmap к catalog / analytics / multiplayer hardening привязан к уже работающему ядру;
- платформа масштабируется без переписывания canonical slice.

Главные зависимости и риски:

- нельзя идти в platform-scale до стабилизации canonical runtime path;
- аналитика и operations не должны появляться как несвязанные подсистемы.

## Milestones

- **M1. Canonical Antarctica Opening Complete** — manifest + runtime + player content закрывают opening path до `i21`.
- **M2. Antarctica Player-Web Complete** — ближайший пользовательский путь полностью рендерится из runtime-owned content DTO.
- **M3. Runtime Hardening Baseline** — contracts, validation, health/readiness и session evolution имеют устойчивую базу.
- **M4. Multi-Game Foundation** — архитектура готова к следующей игре без переписывания Antarctica-specific основы.
- **M5. Authoring MVP** — редактор и authoring workflows опираются на канонический truth model.
- **M6. Platform Expansion** — каталог, аналитика и масштабирование строятся поверх уже проверенного ядра.

## Near-Term Execution

Ниже — ближайшие блоки (block = ограниченный рабочий блок, который можно выполнить и проверить отдельно).

Примечание: если имя блока помечено как `proposed`, это значит, что это roadmap-level формулировка, синтезированная из текущих приоритетов в `NEXT_STEPS.md`, а не буквальное имя уже зафиксированного workflow-блока.

### 1. `antarctica-opening-tail-player-slice`

Recommended `development_method`: `Vertical slices`

Цель:

- довести `apps/player-web` до полного current-step rendering opening tail через `runtime-api` и session snapshot.

Почему подходит этот метод:

- ценность блока видна пользователю end-to-end, а не только внутри одного слоя;
- contract freeze для opening-tail уже сделан, теперь надо довести наблюдаемый delivery path;
- удобно проверять результат по реальному player flow, а не только по внутренним артефактам.

### 2. `antarctica-post-opening-manifest-extraction`

Recommended `development_method`: `Review-driven loop`

Цель:

- выбрать первый bounded post-opening slice после `i21` и перенести его из legacy source в `games/antarctica/game.manifest.json`.

Почему подходит этот метод:

- legacy extraction даёт неоднозначности, поэтому нужен цикл `extract → review → correct`;
- главный риск здесь — fidelity migration, а не UI delivery;
- полезно быстро возвращать slice на точечную доработку без полной перепланировки.

### 3. `runtime-session-hardening-baseline` (`proposed`)

Recommended `development_method`: `Spec -> scaffold -> harden`

Цель:

- подготовить следующий устойчивый шаг для runtime: health/readiness, session evolution priorities и минимальный operational hardening plan.

Почему подходит этот метод:

- сначала нужно зафиксировать scope и boundaries hardening-работ;
- после этого удобно отдельно сделать scaffold и затем harden без смешения с gameplay delivery;
- это снижает риск расползания инфраструктурных задач в продуктовые блоки.

### 4. `player-web-contract-safe-polish` (`proposed`)

Recommended `development_method`: `TDD`

Цель:

- закрыть ближайшие contract-safe UI gaps в `apps/player-web`, не ломая уже зафиксированный runtime-owned boundary.

Почему подходит этот метод:

- для локальных UI/DTO edge cases полезно сначала зафиксировать regression tests;
- это помогает держать delivery безопасным, пока растёт coverage;
- метод хорошо подходит для bounded correctness work после vertical slice.

## Governance And Workflow

Рабочий цикл проекта на высоком уровне:

1. Architect определяет следующий блок и методику.
2. PM делает `plan_review`.
3. Architect принимает решение по замечаниям и утверждает старт.
4. Orchestrator материализует task packets и маршрутизирует исполнителей.
5. Executor делает bounded implementation и task-level acceptance.
6. PM делает block acceptance.
7. Architect закрывает блок или запускает следующую итерацию.

Смысл этого процесса: архитектура не должна плыть во время выполнения, а каждое изменение должно проходить через короткий и проверяемый цикл.

Техническая заметка по startup docs: в текущем репозитории есть naming mismatch (несовпадение имён документов) между ожидаемым `PROJECT_STRUCTURE.json` и реально используемым `PROJECT_STRUCTURE.md`. Это пока не исправляется в этом roadmap-pass, но будущим сессиям нужно учитывать это расхождение при стартовом чтении проекта.

## Non-Goals And Constraints

- Мы **не** строим сейчас generic engine, DSL или универсальный selector framework.
- Мы **не** переводим draft-артефакты в source of truth.
- Мы **не** строим editor, catalog и platform-scale возможности раньше стабилизации canonical runtime slice.
- Мы **не** позволяем `apps/player-web` снова читать `games/*` как runtime truth.
- Мы **не** превращаем `ROADMAP.md` в список мелких ежедневных задач.

## Existing Workstreams

Для continuity и навигации сохраняем связь с уже существующими task-файлами:

- Milestone: `docs/tasks/milestones/M_010_game_player_alpha.md`
- Architecture / manifest foundation: `docs/tasks/epics/E_00001_architecture_review_consolidation.md`
- Backend direction: `docs/tasks/epics/E_0030_backend_architecture_design.md`
- Editor direction: `docs/tasks/epics/E_00021_game_editor_development.md`
- Antarctica delivery line: `docs/tasks/epics/E_0020_antarctica_nextjs_game_player.md`
- Quality / observability: `docs/tasks/epics/E_0050_observability_and_quality.md`

Эти файлы остаются местом для детальной декомпозиции. Этот `ROADMAP.md` фиксирует только стратегический курс.
