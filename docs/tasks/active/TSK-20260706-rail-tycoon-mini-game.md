# TSK-20260706-rail-tycoon-mini-game: Игра «Магнат железных дорог» (аналог Railroad Tycoon)

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Dependencies](#dependencies)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

blocked

Status note: задача заблокирована зависимостями, перечисленными в разделе Dependencies.
- Владелец: оркестратор (промт — `docs/tasks/artifacts/TSK-20260706-rail-tycoon-mini-game/orchestrator-prompt.md`)
- Создана: 2026-07-06

## Understanding

Реализовать целиком агентом однопользовательскую экономическую игру
`rail-tycoon-mini` («Магнат железных дорог») — аналог Sid Meier's Railroad
Tycoon в минимальном объёме: фиксированная карта (5 городов, 7 линий,
5 маршрутов), 5 игровых лет, годовой цикл «планирование → перевозки →
итоги», случайный спрос грузов, доход и обслуживание по формулам манифеста.
Клиентская Phaser-сцена — чистая визуализация карты и поездов; все деньги
считает runtime. Игра НЕ вносит изменений в платформенные слои и схемы:
только `games/rail-tycoon-mini/` (манифесты + плагин) и тесты.

## Architecture Source

- `docs/architecture/rail-tycoon-mini-design.md` — **единственная нормативная
  спецификация игры**: §4 механика/баланс, §5–6 полные JSON манифеста,
  §7 UI-манифест, §8 плагин/сцена, §9 тесты и приёмочные числа, §10 закрытые
  решения, §11 правила исполнителя. При любом расхождении прозы и JSON —
  приоритет у JSON дизайна.
- `docs/architecture/flow-simulation-platform-design.md` §4.0/§4.3/§4.4 —
  контракт Phaser-канала (владелец — трек flow-simulation).
- `docs/architecture/board-game-platform-design.md` §4.0–4.1, §4.5–4.6 —
  контракты `random.roll`, `metric.set`, `when` (владелец — трек ADR-058).
- ADR-058 (Accepted-контур трека `TSK-20260705-*`), ADR-062 (Accepted);
  ADR-061 сознательно НЕ используется (дизайн §10 п.1).
- Образцы: `games/simple-choice/` (манифесты, привязка карточек),
  `games/antarctica/plugins/antarctica-player/` (структура плагина),
  `games/conveyor-mini/` (первый потребитель Phaser-канала, когда реализован).

## Why

Первая экономическая игра платформы и второй потребитель Phaser-канала
ADR-062. Проверяет комбинацию: серверная случайность (`random.roll`) +
формулы манифеста (`metric.set`/`when`) + пассивная симуляционная
поверхность — без параметров действий и без клиентской случайности. Даёт
жанровый шаблон «тайкун/менеджмент» для будущих игр.

## Target State

Игра `rail-tycoon-mini` проходится в `player-web` end-to-end; интеграционный,
smoke- и e2e-сценарии §9 дизайна зелёные; grep-инварианты чистоты зелёные;
платформенные каталоги не изменены; документация и `PROJECT_STRUCTURE.yaml`
синхронны.

## Scope

- `games/rail-tycoon-mini/game.manifest.json` (+ authoring-слой, если он
  обязателен для новых игр на момент реализации).
- `games/rail-tycoon-mini/ui/web/ui.manifest.json`.
- `games/rail-tycoon-mini/assets/` — реестр `assets.json` и четыре SVG по
  §8.0 дизайна (канал ADR-063).
- `games/rail-tycoon-mini/plugins/rail-tycoon-mini-player/` (плагин, сцена,
  чистая геометрия, юнит-тесты).
- Тесты: runtime-интеграция (формула, сценарий, smoke), Vitest плагина,
  Playwright e2e, grep-инварианты в CI.
- Регистрация игры тем же механизмом, каким зарегистрированы существующие
  игры (только данные/конфигурация — не код платформы).

## Non-Goals

- Любые изменения `services/runtime-api/src`, `apps/player-web/src`,
  `docs/architecture/schemas/`, `packages/contracts/` — принадлежат
  платформенным трекам.
- Механики из строки «Вне рамок» дизайна §2 (биржа, конкуренты, произвольное
  строительство и т.д.).
- Изменение чисел баланса и формул (§4 дизайна — контракт приёмки).
- Мультиплеер, агенты-оппоненты, editor-превью сверх стандартного player
  preview.

## Dependencies

Игра стартует (Stage 1+) только когда ВСЁ перечисленное в `main`:

| # | Блок | Откуда | Как проверить |
|---|---|---|---|
| D1 | PRNG сессии + эффект `random.roll` | ADR-058 Phase 1, трек `TSK-20260705-board-game-platform-capabilities` | `random.roll` есть в `game-manifest.schema.json`; Handoff Log трека |
| D2 | `metric.set` (число \| jsonLogic) + поле `when` у эффектов | ADR-058 Phase 4, тот же трек | `metric.set`/`when` в схеме манифеста; Handoff Log |
| D3 | Phaser-хост: `simulationSurface`, `phaserSceneFactory`, plugin-api сцены | Phase 3 трека `TSK-20260706-flow-simulation-platform-capabilities` | `simulationSurface` в `ui-manifest.schema.json`; `phaserSceneFactory` в `plugin.schema.json`; Handoff Log |

| D4 | Канал игровых ассетов: схема `game-assets.schema.json` + валидатор, раздача `/game-assets/*`, резолвер `context.assets` | ADR-063, Phases 1–3 трека `TSK-20260706-game-asset-channel` | схема в `docs/architecture/schemas/`; `validate-game-assets.js` в `verify:canonical`; поле `assets` в `PhaserSceneContext`; Handoff Log |

Не зависит от: ADR-061 (params), `random.seed`, `createSeededRandom`,
реализации игры `conveyor-mini` (общий только платформенный хост),
миграции картинок «Антарктиды» (LEGACY-0023).
Stage 3 (геометрия и каркас плагина с юнит-тестами) может выполняться до
D3/D4 в части чистых функций, но интеграция сцены — только после D3 и D4.

## Execution Plan

### Stage 0. Подготовка

- [ ] Прочитать `CLAUDE.md`, дизайн игры целиком, §4.0/§4.3/§4.4 дизайна
      flow-simulation, образцы (`simple-choice`, `antarctica-player`).
- [ ] Проверить D1–D4 по таблице Dependencies (grep схем + Handoff Log
      треков + `git log`). Не готово → зафиксировать в Handoff Log и ждать
      (разрешён только опережающий кусок Stage 3 — чистая геометрия).
- [ ] Создать каталог `games/rail-tycoon-mini/` с `.desc.json`;
      `node scripts/dev/generate-structure.js`.

### Stage 1. Game-манифест

- [ ] `game.manifest.json`: `meta`/`config`/`engine` по §5 дизайна (образец
      `simple-choice`); `content` — скопировать §5.1; `state` — §5.2;
      `actions` — все 15 из §6 (копировать, не сочинять).
- [ ] Прогнать строгую Ajv-валидацию манифеста и `verify:canonical`;
      если authoring-слой ADR-030 обязателен — оформить его по актуальному
      контуру и прогнать `npm run verify:manifest-authoring` (сверить с тем,
      как это решил `conveyor-mini` Stage 1).
- [ ] Runtime-тесты: контрольный пример формулы (§9.1: 1290 / +1140),
      интеграционный сценарий (§9.2, все негативные проверки), smoke «без
      покупок» (§9.3: итог 1200).

### Stage 2. UI-манифест

- [ ] `ui/web/ui.manifest.json` по §7: 5 экранов, `screen_routing` по
      `screenId`, метрики, 13 карточек `planning` с нормативными текстами,
      компонент `simulationSurface` (`sceneId: "main"`, 960×540) на экранах
      `planning` и `running`. Формат — строго по образцу `simple-choice`.
- [ ] Ручная проверка в `player-web`: интро открывается, карточки
      отправляют действия, отклонённые действия показывают стандартную
      ошибку (сцена на этом этапе может показывать диагностический блок,
      если Stage 3 ещё не слит, — это ожидаемо и допустимо).

### Stage 3. Плагин, ассеты и сцена

- [ ] Ассеты: каталог `games/rail-tycoon-mini/assets/` с `.desc.json`,
      `assets.json` и четырьмя SVG — скопировать из §8.0 дизайна (три
      поезда отличаются ТОЛЬКО значением `fill` двух первых `rect`);
      прогнать `validate-game-assets.js` (в `verify:canonical`).
- [ ] Каркас плагина по раскладке §8 (plugin.json с
      `phaserSceneFactory: true`, package.json без dependencies, tsconfig по
      образцу; `.desc.json` + генерация структуры).
- [ ] `src/geometry.ts` — `buildRoutePath`/`trainPositionAt` строго по
      сигнатурам и алгоритму §8.1; `tests/geometry.test.ts` — эталонные
      точки §8.1 + путь из трёх точек + чистота.
- [ ] `src/scene.ts`/`src/index.ts` — поведение сцены по §8.2 (только
      отображение; предзагрузка четырёх ассетов через `context.assets.url`
      по §8.0; запреты §8.2 и §11 дизайна обязательны).
- [ ] Ручная проверка: карта и подписи видны на `planning`; после
      `year.run` поезда движутся; после `year.commit` сцена корректно
      размонтируется.

### Stage 4. E2E и CI

- [ ] Playwright-сценарий §9.4 (детерминированные числа 950/0; ≤ 120 с),
      по образцу существующих e2e (контур `conveyor-mini`, если уже есть).
- [ ] Grep-инварианты §9.6 в CI тем же механизмом, что инварианты трека
      flow-simulation (добавить строки для `rail-tycoon`, НЕ дублировать
      скрипт).
- [ ] Полный прогон Validation.

### Stage 5. Closeout

- [ ] `git diff --stat` по `services/runtime-api`, `apps/player-web`,
      `docs/architecture/schemas`, `packages/contracts` — пусто.
- [ ] Обновить `NEXT_STEPS.md` (статус), `PROJECT_OVERVIEW.md` (если там
      перечисляются игры), Handoff Log; `generate-structure.js`; убедиться,
      что незакрытых субагентов нет; `.tmp/` очищен.

## Acceptance

- [ ] Полное прохождение в `player-web` вручную: intro → 5 годовых циклов →
      results; сцена отображает карту со спрайтами городов, построенные
      линии и движущиеся спрайты поездов (ассеты §8.0).
- [ ] `validate-game-assets.js` зелёный для `games/rail-tycoon-mini/assets/`.
- [ ] Контрольный пример формулы: `revenueYear 1290`, прирост кассы `+1140`
      (§9.1).
- [ ] Интеграционный сценарий §9.2 зелёный, включая ВСЕ негативные проверки
      с неизменностью метрик.
- [ ] Smoke §9.3: итог ровно `money 1200`, `year 5`, `status "finished"`.
- [ ] E2E §9.4 зелёный: числа 950/0, укладывается в 120 с.
- [ ] Юнит-тесты геометрии §9.5 зелёные (эталонные точки §8.1).
- [ ] Grep-инварианты §9.6 зелёные; `verify:canonical` зелёный.
- [ ] Платформенные каталоги без диффа (см. Stage 5).
- [ ] Ни одного нового платформенного эффекта/схемной конструкции/ADR.

## Validation

```bash
# из корня репозитория
npm run verify:canonical
node scripts/dev/generate-structure.js && git diff --exit-code PROJECT_STRUCTURE.yaml
cd services/runtime-api && npm run typecheck && npm test
cd apps/player-web && npm run typecheck && npm test
# e2e — команда актуального контура Playwright (сверить с conveyor-mini / существующими e2e)
rg -n "rail-tycoon" services/runtime-api/src apps/player-web/src   # пусто
rg -n "from \"phaser\"|require\(\"phaser\"\)|import\(\"phaser\"\)" games/rail-tycoon-mini   # пусто
rg -n "Math\.random|Date\.now" games/rail-tycoon-mini/plugins      # пусто
rg -n "/game-assets/" games/rail-tycoon-mini/plugins               # пусто (URL — только через context.assets)
```

(Если authoring-слой обязателен: `npm run verify:manifest-authoring`.)

## Risks

| Риск | Митигация |
|---|---|
| Зависимости D1–D4 не готовы или их контракт разошёлся с дизайном | Stage 0 проверяет схемы и Handoff Log; расхождение — стоп и вопрос владельцу через Handoff Log, НЕ самостоятельная реализация платформенных блоков |
| SVG-ассеты не проходят санитизацию валидатора канала | Разметка §8.0 нормативна и заведомо чистая (без script/on*/href); при красном валидаторе сверить файл с §8.0 посимвольно, не ослаблять правила |
| Слабый исполнитель «дорисовывает» механики или меняет числа | Полные JSON в дизайне §5–6; правило «не изобретать» §11; ревью диффа против дизайна |
| Формат guard `jsonLogic`/эффектов в реализованной схеме отличается в деталях | Сверять с актуальной схемой манифеста и фикстурами трека ADR-058; при конфликте — Handoff Log, приоритет у реализованной схемы, дизайн обновить синхронно |
| Многоаргументные `+`/`*` в JsonLogic не поддержаны реализацией `metric.set` | Контрольный пример §9.1 ловит это сразу; при отказе — переписать выражения в бинарную вложенную форму (эквивалентно, разрешено как исключение с записью в Handoff Log) |
| UI-карточки всегда кликабельны — игрок видит ошибки отклонения | Принятое упрощение (§7 дизайна); не чинить платформенными правками |
| e2e-таймауты из-за анимации | Анимация декоративна, «Завершить год» доступна сразу (§8.2 п.7) |

## Handoff Log

- 2026-07-06 — задача создана вместе с нормативным дизайном
  `docs/architecture/rail-tycoon-mini-design.md`; статус planned; блокеры
  D1–D3 (см. Dependencies). Кода нет.
- 2026-07-06 — решение владельца: графика через платформенный канал игровых
  ассетов (ADR-063). Дизайн дополнен §8.0 (реестр + четыре авторских SVG),
  сцена переведена с примитивов на спрайты; добавлена зависимость D4
  (`TSK-20260706-game-asset-channel`, Phases 1–3) и связанные проверки.
- 2026-07-06 — в §8.0 дизайна добавлена нормативная таблица источников
  ассетов (авторские SVG — норматив MVP; ИИ-генерация, CC0-паки
  Kenney/OpenGameArt, CC-BY с атрибуцией, заказ художнику — разрешённые
  пути улучшения; запрещённые источники перечислены). Замена графики =
  замена файла при том же id, манифесты и сцена не меняются.
