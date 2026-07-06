# TSK-20260706-conveyor-mini-game: Фикстурная игра «Мини-конвейер» (класс «симулятор потока»)

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

planned (2026-07-06) — заблокирована до завершения фаз платформенной программы
(см. Dependencies). Игру целиком реализует агент.

## Understanding

Работа понята так: создать первую игру класса «симулятор потока» —
«Мини-конвейер» (`games/conveyor-mini/`): однопользовательский тренажёр
сортировки деталей на конвейере, два раунда с возрастающим темпом. Игра — это
architecture fixture (по образцу `simple-choice`/`dice-track`): она доказывает
generic-путь Phaser-канала (ADR-062) и параметров действий (ADR-061) без
правок платформенных слоёв. Вся спецификация игры нормативно зафиксирована в
`flow-simulation-platform-design.md` §6 — исполнитель не принимает
геймдизайнерских решений.

## Architecture Source

- `docs/architecture/flow-simulation-platform-design.md` — **§6 нормативен
  целиком** (контент, состояние, полные JSON действий, экраны, раскладка
  плагина, поведение сцены пп.1–10). §4.0 — контракты plugin API. §9 —
  обязательные правила и запреты. При расхождении любых источников приоритет:
  §4.0/§6 дизайна → TSK → всё остальное.
- ADR-061, ADR-062 (принятые решения), ADR-024 (явные действия), ADR-037
  (плагин без зависимостей), ADR-054 (границы game/UI манифестов), ADR-055
  (декларативные привязки).
- Образцы в репозитории (прочитать перед работой):
  `games/simple-choice/game.manifest.json` (форма манифеста),
  `games/simple-choice/ui/web/ui.manifest.json` (форма UI-манифеста и привязка
  кнопок), `games/antarctica/plugins/antarctica-player/` (раскладка плагина).

## Why

Платформенный пакет ADR-061/062 без фикстурной игры не имеет доказательства
generic-пути: нужна игра, которая проходит весь цикл (манифест → runtime →
player-web → Phaser-сцена → params → метрики) и входит в CI, не добавляя ни
строчки в платформенные слои.

## Target State

1. `games/conveyor-mini/` содержит game-манифест, web UI-манифест и плагин
   `plugins/conveyor-mini-player/` со сценой конвейера — строго по §6 дизайна.
2. Игра проходится в `player-web` end-to-end: intro → раунд 1 (Phaser) →
   between → раунд 2 → results; очки считает манифест, сцена только шлёт итоги.
3. План раунда детерминирован зерном; юнит- и e2e-тесты зелёные; игра включена
   в `verify:canonical` и game-agnostic CI invariant.

## Scope

- Контент-пакет `games/conveyor-mini/` (манифесты + `.desc.json`).
- Плагин `conveyor-mini-player` (вклад `phaserSceneFactory`, без
  `gameConfigFactory` — игра использует default config builder).
- Юнит-тесты плана появления; e2e Playwright; включение в CI.
- Регенерация `PROJECT_STRUCTURE.yaml` после создания каталогов.

## Non-Goals

- Изменения платформенных слоёв (`services/runtime-api`, `apps/player-web`,
  схемы) — если чего-то не хватает, это блокер платформенной программы, а не
  повод для локального хака.
- Внешние ассеты (картинки, звук), мобильная адаптация, Telegram-канал.
- Балансировка сложности сверх нормативных чисел §6.
- Мультиплеер, ИИ-оппоненты, соревновательные таблицы.

## Dependencies

Стартовые условия (проверить Handoff Log
`TSK-20260706-flow-simulation-platform-capabilities` и прогнать Validation
оттуда):

1. Платформенные Phases 1–4 завершены: `paramsSchema` + `params`,
   `random.seed`, Phaser-хост + `simulationSurface` + `phaserSceneFactory`,
   `createSeededRandom`.
2. Из параллельного трека настольных игр: `metric.set` со значением JsonLogic
   и поле `when` у эффектов (ADR-058 Phase 4,
   `TSK-20260705-board-game-platform-capabilities`).

Если хотя бы одно условие не выполнено — работа не начинается; зафиксировать
блокер в Handoff Log.

## Execution Plan

### Stage 0. Подготовка

1. Прочитать: `flow-simulation-platform-design.md` §4.0, §6, §9; три файла
   образцов из Architecture Source; актуальную
   `docs/architecture/schemas/game-manifest.schema.json` (имена служебных полей
   действий могли уточниться при реализации платформенных фаз).
2. Проверить Dependencies (см. выше). Прогнать `npm run verify:canonical` —
   стартовать только от зелёного состояния.

### Stage 1. Game-манифест

1. Создать `games/conveyor-mini/game.manifest.json`: `meta` (id
   `conveyor-mini`, название «Мини-конвейер», `training` по §6.1), `config`
   (`players {min:1, max:1}`, `mode: "singleplayer"`, `locale: "ru-RU"`),
   `content` — точно §6.2, `state` — точно §6.3, `actions` — точно §6.4
   (четыре действия, JSON скопировать из дизайна, не перепечатывать по памяти).
   Служебные поля секций, не описанные в §6 (`engine.systemPrompt` и т.п.), —
   по образцу `simple-choice`.
2. Прогнать валидацию манифеста (Ajv строгий) и `verify:manifest-authoring`;
   если authoring-слой ADR-030 обязателен для новых игр на момент реализации —
   оформить authoring-манифест по актуальному контуру (сверить с процессом,
   которым `dice-track` прошёл в параллельном треке).
3. Юнит-проверка действий против runtime: создать сессию, прогнать
   последовательность `round1.start → round1.commit(6,5,2) → round2.start →
   round2.commit(10,9,0)` интеграционным тестом или скриптом; проверить
   `score = max(0, 0 + 50-10) = 40 → 40 + 90-0 = 130`, `missedTotal = 2`,
   `processedTotal = 16`, экран `results`. Проверить отклонения: commit с
   `processed+missed != itemsTotal`, commit при `status != "running"`, params с
   лишним полем.

### Stage 2. UI-манифест

1. Создать `games/conveyor-mini/ui/web/ui.manifest.json`: четыре экрана по
   нормативной таблице §6.5; формат экранов, компонентов и привязки кнопок —
   по образцу `simple-choice` (актуальная схема `ui-manifest.schema.json` —
   источник истины); на экране `round` — компонент
   `{"type": "simulationSurface", "sceneId": "main"}`.
2. Тексты кнопок/подписей — в UI-манифесте; ничего игрового смыслового в UI
   (ADR-054).
3. Прогнать валидацию UI-манифеста; открыть игру в `player-web` — до плагина
   экран `round` должен показывать диагностический блок поверхности (это
   ожидаемое fail-closed поведение платформы, §4.0 п.5).

### Stage 3. Плагин и сцена

1. Создать `games/conveyor-mini/plugins/conveyor-mini-player/` с раскладкой из
   §6.6: `plugin.json` — нормативный образец §4.3 дизайна; `package.json` без
   `dependencies`; `.desc.json` для каталогов `plugins/` и плагина.
2. `src/spawn-plan.ts`: `buildSpawnPlan` — нормативная сигнатура и алгоритм
   §6.6 (один rng на план, вызовы строго по индексу, фиксированный интервал).
3. `src/scene.ts`: класс сцены по нормативному поведению §6.6 пп.1–10.
   Требования к коду: файл-заголовок и docstrings по правилам `CLAUDE.md`
   (новичок должен понять, что происходит); время — только `this.time`;
   случайность — только rng из `context.createSeededRandom(seed)`; счётчики —
   локальные поля сцены; ровно один dispatch за раунд с кнопкой «Повторить»
   при ошибке.
4. `src/index.ts`: `export const createSimulationScene: PhaserSceneFactory` —
   читает `round.status`/`round.index`/`round.seed` из
   `session.state.public`, конфиг раундов из `content` (через типы
   `src/contracts.ts`), создаёт сцену, реализует `updateSession`/`destroy`.
5. `tests/spawn-plan.test.ts`: детерминизм (два вызова с одним зерном →
   deep-equal), длина, `spawnAtMs`, валидность `itemTypeId`; golden-фикстура
   плана для зерна `"0123456789abcdef0123456789abcdef"` (записать фактический
   вывод при первом корректном прогоне, закоммитить, сравнивать в тесте).
6. Прогнать плагинную валидацию (schema/typecheck/build по контуру ADR-037) и
   ручную проверку в `player-web`: полный проход двух раундов мышью.

### Stage 4. E2E и CI

1. Playwright-тест «прохождение без взаимодействия» — детерминированный
   сценарий §7 дизайна: старт раунда 1 → дождаться экрана `between` (все 8
   пропущены: `roundMissed = 8`, `score = 0`) → старт раунда 2 → дождаться
   `results` (`missedTotal = 18`, `score = 0`). Таймаут теста 120 с; селекторы
   — по отображаемым метрикам экранов, не по внутренностям canvas.
2. Включить игру в `verify:canonical` и game-agnostic CI invariant (по
   образцу включения `simple-choice`/`dice-track`).
3. Проверить grep-инварианты: `conveyor` не появился в платформенных `src`;
   в плагине нет `import` phaser.

### Stage 5. Closeout

1. `.desc.json` во всех новых каталогах; `node scripts/dev/generate-structure.js`.
2. Обновить `NEXT_STEPS.md` (статус), Handoff Log; записать в Handoff Log
   платформенной программы факт прохождения фикстуры.
3. Убрать временные файлы из `.tmp/`; убедиться, что не осталось открытых
   субагентов (правило 2.7 `CLAUDE.md`).

## Acceptance

- Полное прохождение в `player-web` вручную: intro → раунд 1 (перетаскивание
  работает, HUD считает) → between (метрики раунда видны) → раунд 2 (темп
  выше) → results (score/totals по формуле §6.4).
- Интеграционная последовательность Stage 1 п.3 даёт точные значения
  (`score 130`, `missedTotal 2`, `processedTotal 16`) — числа детерминированы.
- Невалидные фиксации отклоняются без изменения состояния (три негативных
  случая Stage 1 п.3).
- `buildSpawnPlan` детерминирован; golden-фикстура закоммичена.
- E2E-сценарий без взаимодействия зелёный и укладывается в 120 с.
- `verify:canonical` зелёный; платформенные слои не изменены
  (`git diff --stat` по `services/`, `apps/`, `packages/`, `docs/architecture/schemas/` пуст).

## Validation

```text
npm run verify:manifest-authoring
npm run verify:canonical
cd games/conveyor-mini/plugins/conveyor-mini-player && npm run typecheck && npm test
npx playwright test  # e2e conveyor-mini
```

## Risks

- Дрейф между §6 дизайна и фактической схемой манифеста после платформенных
  фаз: правило — формы конструкций сверять с актуальной схемой, значения и
  логику — с §6; расхождение фиксировать в Handoff Log, не «чинить» молча.
- Соблазн положить подсчёт очков в сцену «для отзывчивости» — запрещено (§9):
  HUD показывает локальные счётчики, формулы — только манифест.
- Плавающая производительность CI-машин на e2e: сценарий не зависит от FPS
  (итог раунда определяется планом, не кадрами), но таймауты выставлять с
  запасом (120 с).
- Phaser API: документацию брать через Context7 по зафиксированной платформой
  версии, не по памяти.

## Handoff Log

- 2026-07-06: задача создана вместе с ADR-061/ADR-062 и дизайн-документом
  `flow-simulation-platform-design.md` (§6 — полная нормативная спецификация
  игры). Заблокирована зависимостями: платформенные Phases 1–4
  (`TSK-20260706-flow-simulation-platform-capabilities`) и `metric.set`/`when`
  из ADR-058 Phase 4 (`TSK-20260705-board-game-platform-capabilities`).
  Реализация не начата.
- 2026-07-06 (позже): владелец принял ADR-061/ADR-062 — архитектурный блокер
  снят; остаются технические зависимости из раздела Dependencies (платформенные
  Phases 1–4 и `metric.set`/`when` из ADR-058 Phase 4). Реализация не начата.
