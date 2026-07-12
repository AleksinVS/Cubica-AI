# TSK-20260705-board-game-platform-capabilities: Пакет платформенных возможностей пошаговых настольных игр

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

in_progress

Status note: архитектура ADR-058 принята 2026-07-06. Выбранный 2026-07-11
игровой срез GSR-034 активировал только минимальные части фаз 1–4: участников,
воспроизводимый бросок, ход, циклическое движение и платежи. Остальные фазы не
реализуются заранее. Активированный фундамент и принятый ADR-076 реализованы;
браузерная приёмка использующей их игры ещё не завершена.

## Understanding

Работа понята как минимальный общий фундамент для первого среза оригинальной
экономической игры на циклическом поле. GSR-034 активирует только
воспроизводимую случайность, состояние участников, ход, движение и платежи.
Колоды, полный жизненный цикл и завершение не реализуются до собственного
игрового потребителя. Game-specific код в платформенных слоях запрещён; новые
примитивы доказываются нейтральными контрактными фикстурами.

## Architecture Source

- `docs/architecture/adrs/058-turn-based-board-game-platform-capabilities.md` (Accepted)
- `docs/architecture/board-game-platform-design.md` — детальный дизайн и инвентаризация правил.
  **Для исполнителя обязательны**: §4.0 (нормативный справочник конструкций —
  имена полей и семантика берутся ТОЛЬКО оттуда; при расхождении с прозой
  приоритет у §4.0) и §9 (правила работы, запреты, чек-лист среза)
- ADR-011 (структура players/мультиплеер), ADR-024 (bounded mechanics), ADR-025/ADR-056
  (Schema SSOT + генерация контрактов), ADR-040 (политика расширения runtime-api),
  ADR-041 (объектная модель), ADR-038 (testing policy), ADR-076 (единый контракт
  `metric.transfer` между банком, участником и общим состоянием)

## Why

Текущий реестр детерминированных возможностей (7 эффектов, guards без понятия
игрока/хода/случайности) не покрывает ни одну пошаговую настольную игру на
несколько участников. Без общего пакета любая такая игра потребует запрещённых
game-specific веток в `runtime-api`.

## Current Findings

1. ADR-076 принял окончательную форму `metric.transfer`. Обнаруженный позже
   `cards-money-trains-mock` мигрирован 2026-07-12; временная совместимость
   удалена, `LEGACY-0050` закрыт.
2. В текущем блоке уже добавлены `playersTemplate`, `turnModel`, runtime-развёртывание
   `state.players.p1…pN`, закрытое состояние PRNG и начальный `public.turn`.
3. `objectModels[*].scope` — только `session`.
4. Guard `turn`, `random.roll`, player-scoped `metric.add`/`metric.set`,
   `turn.next`/`turn.phase.set` и JsonLogic-условия эффектов реализованы
   нейтральными runtime-тестами; полный набор ADR-058 не активирован.
5. CI-подмножество JsonLogic (`scripts/ci/validate-metric-jsonlogic-subset.js`,
   LEGACY-0022: `var,+,-,*,/,min,max`) ограничивает ТОЛЬКО computed-метрики,
   которые пересчитывает player-web; серверные guard/effect-выражения runtime
   исполняет полной `json-logic-js`, где `%` уже доступен. Значит, для
   `metric.set` в эффектах расширение подмножества не требуется; оно
   понадобится, только если вычисляемые `metricViews` начнут использовать `%`
   (тогда синхронно: валидатор + `metric-projection.ts`).
6. Контур генерации контрактов из схемы уже работает (ADR-056,
   `generate-contracts-types.cjs` + `validate-contracts-schema-parity.js`) —
   новые схемные конструкции обязаны идти через него.
7. Для GSR-034 реализована окончательная форма `metric.transfer`, воспроизводимый
   `random.roll`, контроль и переход хода, player-scoped метрики и проекция,
   которая не отдаёт игроку служебное состояние генератора случайности.
   Реализация доказана нейтральными тестами и игровым пакетом `estate-race`;
   целевая браузерная проверка покупки и ренты прошла. Ранняя форма удалена из
   общей схемы и Runtime после миграции mock-пакета.

## Target State

1. Схема манифеста и сгенерированные контракты описывают: `state.playersTemplate`,
   `config.turnModel`, `endConditions`, scope `player`, 13 новых эффектов
   (`random.roll`, `deck.shuffle`, `deck.draw`, `deck.extract`, `deck.return`,
   `metric.set`, `metric.transfer`, `turn.next`, `turn.repeat`, `turn.phase.set`,
   `turn.setActive`, `player.status.set`, `branch`), поле `when` у эффектов,
   guard-форму `turn`, тип `playerRef` (4 формы, включая `{"fromPath": …}`) и
   расширения существующих конструкций (`metric.add` scope, `owner` у
   object-эффектов/guard) — всё строго по нормативному §4.0 дизайн-документа.
2. `runtime-api` исполняет все новые эффекты и guards детерминированно;
   PRNG-состояние в `state.secret.random`, replay воспроизводим.
3. Проекция Presenter отдаёт игроку свою ветку целиком, чужие — по правилам
   видимости; порядок колод скрыт.
4. Фикстурная игра `games/dice-track/` играется в `player-web` в режиме хотсит
   end-to-end и входит в game-agnostic CI invariant.
5. Ни одного упоминания конкретной игры в платформенных слоях.

## Scope

- JSON Schema + перегенерация контрактов + контрактные тесты новых конструкций.
- Обработчики эффектов/guards и модель состояния в `services/runtime-api`.
- Правила проекции player-facing content для per-player состояния и колод.
- Фиксация границы вычислителей JsonLogic (runtime — полная библиотека;
  player-web-подмножество расширяется только при использовании `%` в
  `metricViews`, см. Current Findings п.5).
- Фикстурная игра `games/dice-track/` (game manifest + web ui manifest, без плагина).
- Replay-тест: seed + последовательность действий → идентичное состояние.

## Non-Goals

- Сама «Монополия» (отдельная задача `TSK-20260705-monopoly-classic-game`).
- Реализация ADR-011 (сетевой мультиплеер) — отдельная задача модели 2.
- ИИ-оппоненты (модель 3, поверх ADR-046).
- Торги/аукционы как платформенные примитивы (это контент манифеста).
- Универсальная машина фаз, вложенные branch, долговые политики transfer.

## Execution Plan

### Phase 0. Принятие ADR-058

1. Ревью и принятие ADR-058 владельцем проекта (Proposed → Accepted) —
   выполнено 2026-07-06.
   Все проектные вопросы уже закрыты в §8 дизайн-документа — отдельных
   технических решений на этой фазе не требуется.

### Phase 1. Seeded RNG + random.roll

1. Схема: эффект `random.roll` (нотация `NdM`, `storePath`); состояние
   `state.secret.random` (инициализирует runtime, в манифесте не описывается).
2. Runtime: PRNG-модуль строго по нормативу §4.1 дизайн-документа
   (`xoshiro128ss-v1`, 128-битное hex-зерно, rejection sampling, правило
   `isDouble`), обработчик эффекта, платформенная запись журнала.
3. Тесты: фиксированный seed → фиксированная последовательность (включая
   эталонный вектор значений для защиты от случайной смены алгоритма);
   перегенерация контрактов; негативные фикстуры схемы.

### Phase 2. Состояние «на игрока»

1. Схема: `state.playersTemplate` (+ `visibility`), scope `player` в
   `objectModels`, тип `playerRef` (4 формы §4.0, включая `{"fromPath": …}`),
   расширения `metric.add` (scope/playerId) и object-эффектов/guard (`owner`).
2. Runtime: развёртывание шаблона при создании сессии (id `p1`…`pN` в порядке
   занятия мест; число игроков из запроса в пределах `config.players`),
   резолвинг всех форм `playerRef`, материализация `actor`/`activePlayer` в
   контексте JsonLogic, явные ошибки вне player-scoped контекста.
3. Проекция: своя ветка целиком, чужие — по `visibility`.

### Phase 3. Turn flow

1. Схема: `config.turnModel.phases`, guard-форма `turn`, эффекты `turn.next`,
   `turn.repeat`, `turn.phase.set`, `turn.setActive`; структура
   `state.public.turn`.
2. Runtime: инициализация порядка (= порядок занятия мест), продвижение с
   пропуском выбывших, guard; нормативная семантика порядка эффектов и времени
   вычисления `when` — по §4.0.

### Phase 4. Экономика и условные эффекты

1. Схема: `metric.set` (число | JsonLogic), `metric.transfer`
   (`bank`/`player`, `onInsufficient: "fail"`), `when` у эффектов, `branch`
   (один уровень, без вложенности — запрещено схемой).
2. Зафиксировать границу вычислителей: значения эффектов исполняет runtime
   полной `json-logic-js` (включая `%`); player-web-подмножество computed-метрик
   расширять оператором `%` только если он понадобится в `metricViews`
   (синхронно валидатор + `metric-projection.ts`).
3. Runtime: обработчики; отклонение действия целиком при недостатке средств.

### Phase 5. Колоды

1. Схема: `deck.shuffle`, `deck.draw` (+ `onEmpty`), `deck.extract`,
   `deck.return`; состояние `state.secret.decks`.
2. Runtime: перемешивание Фишером–Йетсом через RNG Phase 1 (нормативно §4.2);
   идемпотентный `deck.extract`, защита от дублей в `deck.return`; проекция
   скрывает порядок.

### Phase 6. Жизненный цикл и завершение

1. Схема: `player.status.set`, `endConditions`.
2. Runtime: пропуск выбывших, платформенное отклонение их действий, проверка
   endConditions после каждого действия, терминальное состояние сессии.

### Phase 7. Фикстурная игра и сквозные проверки

1. `games/dice-track/`: 2 игрока, бросок 2d6, циклический трек ~12 клеток,
   перевод очков при обгоне, выбывание при нуле, победа последнего.
2. Replay-тест на фикстуре; e2e Playwright хотсит-партия в `player-web`.
3. Включение в `verify:canonical` и game-agnostic CI invariant.

### Phase 8. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md` (ADR-список + текущий срез),
   `NEXT_STEPS.md`, Handoff Log; разблокировать `TSK-20260705-monopoly-classic-game`.

## Acceptance

- Все новые схемные конструкции покрыты позитивными/негативными фикстурами;
  `verify:contracts-schema-parity` зелёный.
- Replay: фиксированный seed + транскрипт действий → бит-в-бит идентичное
  конечное состояние (автотест).
- `games/dice-track/` играется в `player-web` end-to-end (хотсит) без правок
  generic-слоёв.
- Grep-инвариант: ни `dice-track`, ни `monopoly` не встречаются в
  `services/runtime-api/src` и `apps/player-web/src` (кроме generic-фикстур тестов).
- `verify:canonical` зелёный.

## Validation

```text
npm run generate:contracts && npm run verify:contracts-schema-parity
cd services/runtime-api && npm run typecheck && npm test
npm run verify:manifest-authoring
npm run verify:canonical
npx playwright test  # хотсит e2e dice-track
```

## Risks

- Рост реестра эффектов (7 → 20): дисциплина «одна фаза — один срез со своими
  тестами», иначе ревью станет неуправляемым.
- Подстановки `{{actor}}` — неявный контекст: обязательны явные ошибки
  валидации вне player-scoped контекста (см. ADR-058 §4 риски).
- `branch` может провоцировать рост выразительности: граница «один уровень»
  зафиксирована схемой, любые расширения — только через новый ADR.
- Строгий Ajv уже включён (LEGACY-0016 закрыт): новые конструкции обязаны
  проходить strict-режим сразу.

## Handoff Log

- 2026-07-05: задача создана вместе с ADR-058 (Proposed) и
  `docs/architecture/board-game-platform-design.md`; ожидает принятия ADR
  владельцем проекта. Реализация не начата.
- 2026-07-06: по решению владельца все проектные вопросы закрыты заранее
  (чтобы исполнитель не принимал решений сам): PRNG `xoshiro128ss-v1` +
  rejection sampling + Фишер–Йетс, тип `playerRef` с формой `{"fromPath": …}`,
  `deck.extract`/`deck.return`, `turn.setActive`, расширения `metric.add`/
  object-адресации, материализованные `actor`/`activePlayer` в JsonLogic,
  нормативная семантика порядка эффектов, конвенция id `p1…pN`. Нормативный
  источник — §4.0/§4.1/§5.1/§8 дизайн-документа; фазы 1–3, 5 синхронизированы.
  Реализация не начата.
- 2026-07-06 (позже): создан промт агента-оркестратора трека (задачи A/B/C,
  маршрутизация Opus/Sonnet, Phase 0 = принятие ADR):
  `docs/tasks/artifacts/TSK-20260705-board-game-platform-capabilities/orchestrator-prompt.md`.
- 2026-07-06: ADR-058 принят владельцем проекта (Accepted 2026-07-06) —
  Phase 0 выполнена, трек готов к старту Phase 1. Реализация не начата.
- 2026-07-11: GSR-034 активировал минимальный фундамент первой игры. Аудит
  обнаружил, что ранний `metric.transfer` для `bank ↔ state` расходится с
  player-формой ADR-058. PM принял ADR-076: полная замена на единый контракт
  `scope: bank | player | state`.
- 2026-07-12: внешний mock-пакет мигрирован на окончательную форму; временная
  совместимость удалена, `LEGACY-0050` закрыт.
- 2026-07-11: минимальные части фаз 1–4, нужные GSR-034, реализованы и покрыты
  целевыми схемными и runtime-проверками. Полный пакет ADR-058, включая колоды,
  жизненный цикл и завершение партии, не реализован и не активируется без
  конкретного игрового среза. Браузерная приёмка GSR-034 прошла; срез завершён.
