# TSK-20260705-agent-controlled-players: ИИ-оппоненты — агент как игрок

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

done

Status note: ADR-060 принят 2026-07-06; S8-контракт принят 2026-08-13. S9
реализован и принят локально по GSR-049. Полный terminal match, реальный
provider и network join не входят в доказанную границу и остаются следующими
этапами.

## Understanding

Работа понята так: дать платформе ИИ-оппонентов для детерминированных
пошаговых игр по ADR-060 — агент занимает место участника, получает ту же
персональную проекцию, что человек, плюс платформенный список доступных
действий, и возвращает выбранный ход через валидируемый Agent Turn; исполнение
идёт обычным детерминированным путём. Стратегия агента — контент, не платформа.

## Architecture Source

- `docs/architecture/adrs/060-agent-controlled-players.md` (Accepted)
- ADR-046 (system-initiated Agent Turn, failure policy), ADR-047 (safety gates),
  ADR-058 (turn flow), ADR-059 (participants, персональная проекция)
- `games/ai-driven-choice/` + mock Agent Runtime — образец opt-in адаптера
- `packages/contracts/ai` — место контрактов выбора действия
- `docs/architecture/board-game-platform-design.md` §4.0 (нормативный
  справочник конструкций) и §9 — обязательные правила работы исполнителя

## Why

Третья модель доставки настольных игр. Существующий контур ADR-046 покрывает
агента-«ведущего» (ai-driven игры), но не агента-«игрока»; без этой задачи
ИИ-оппонент потребовал бы дублировать правила игры в промте и доверять агенту
эффекты состояния.

## Current Findings

1. Перечисления «легальные действия для игрока» в runtime нет — guards
   проверяются только при исполнении конкретного действия.
2. Agent Turn контракты (`packages/contracts/ai`) возвращают narration/effects/
   surface/actions, но не «выбор действия из реестра».
3. Mock Agent Runtime (opt-in) существует для `ai-driven-choice` — расширяемый
   образец для агент-игрока.
4. S8 фиксирует session-owned participants с публичной формой
   `seatId:string`, `playerId:string`, `kind:"human"|"agent"`,
   `joinState:"local"`; S8 создаёт только human/local. Agent seat создаётся
   только в S9 после принятия S8.

## Target State

1. Переиспользуется принятая в S8 actor-scoped проекция и canonical availability.
2. Схема манифеста объявляет `agentSeats`; локальная сессия передаёт только
   `agentSeatCount`, а последние N серверных мест становятся агентскими.
3. Планировщик: ход очереди у агентского места → системный Agent Turn с
   персональной проекцией + списком действий; ответ — `actionId`+аргументы;
   исполнение через обычный детерминированный путь/очередь.
4. Политика отказов: ограниченные повторы и упорядоченный fallback до 73;
   недоступность Agent Runtime → `paused`/`facilitatorTakeover` с четырьмя
   кодами причин.
5. Ходы агента в event log и replay-транскриптах; семь фиксированных eval
   fixtures легальности и ограниченной разумности.

## Scope

- Контракт «выбор действия» в `packages/contracts/ai` (+JSON Schema, тесты).
- `availableActions` проекция в runtime-api (+кэш, +тесты, включая отсутствие
  утечки секретов в раскрываемых параметрах).
- Расширение манифест-схемы: `config.players.agentSeats`, fallback-действие
  (через контур ADR-056).
- Планировщик агентских ходов + политика отказов + readiness gate.
- Локальный mock/provider seam и нейтральное доказательство 73 кандидатов.
- Доказательство: bounded human+agent transcript Estate Race; replay и eval
  fixtures.

## Non-Goals

- Реальные LLM-провайдеры и качество стратегии (post-MVP; сначала mock, как в
  `ai-driven-choice`).
- Реакционные ходы вне очереди (торги/аукционы) — явное расширение после
  первого среза (ADR-060 §4).
- Изменение `ai-driven` контура для игр-«ведущих» — не трогаем.
- UI-подсказки легальных ходов человеку — отдельная возможность player-web
  поверх той же проекции (follow-up).

## Execution Plan

### Phase 0. Принятие ADR-060

1. Ревью/принятие; согласование порядка с задачей мультиплеера (кому
   реализовывать participants первым).

### Phase 1. availableActions проекция

1. Runtime-обработчик перечисления по реестру действий и guards; кэш по
   `state_version`; тесты (в т.ч. секреты).

### Phase 2. Контракты и схема

1. Контракт выбора действия в `packages/contracts/ai`; `agentSeats` +
   fallback-действие в манифест-схеме; перегенерация контрактов, негативные
   фикстуры.

### Phase 3. Агентское место и планировщик

1. Создание места `kind: "agent"` после принятия S8-контракта; session-owned
   participants не дублируются в этой задаче.
2. Системный Agent Turn на ходе агента; исполнение выбора обычным путём;
   event log записи.

### Phase 4. Отказы и readiness

1. Повторы, детерминированный fallback, недоступность Agent Runtime по failure
   policy; readiness gate «есть fallback-действие»; диагностика в журнале.

### Phase 5. Доказательство и eval

1. Локальный mock/provider seam, bounded transcript и нейтральная проверка
   73→commit / 74→schema rejection.
2. Replay-транскрипт и семь evaluation fixtures: purchase, auction, jail,
   building, trade, liquidity, bankruptcy.

### Phase 6. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md`, `NEXT_STEPS.md`, Handoff Log.

## Acceptance

- Estate Race сохраняет deterministic режим; bounded human+agent transcript
  подтверждает projection, secret isolation, intents, receipt retry и fallback.
- Принудительно невалидный выбор агента (тестовый adversarial mock) не меняет
  состояние и приводит к fallback после лимита повторов.
- Агент не получает `state.secret`, чужих приватных полей и порядка колод
  (тест на вход Agent Turn).
- Exact command receipt повторяется без повторного сканирования; terminal full
  match не заявляется.
- `verify:canonical`, contracts parity, game-agnostic инвариант — зелёные.

## Validation

```text
npm run generate:contracts && npm run verify:contracts-schema-parity
cd services/runtime-api && npm run typecheck && npm test
npm run verify:canonical
# полный E2E и реальный provider не входят в S9 acceptance
```

## Risks

- Перечисление guards на каждый ход может быть дорогим при больших реестрах —
  кэш по `state_version` обязателен с Phase 1, бюджет фиксируется тестом.
- S9 не дублирует participants: он принимает S8-контракт и добавляет только
  агентскую семантику поверх общей модели.
- Соблазн «подкрутить» честность (дать агенту больше информации ради силы
  игры) — запрещено ADR-060 §2.5; любые исключения только новым ADR.

## Handoff Log

- 2026-07-05: задача создана вместе с ADR-060 (Proposed). Реализация не начата.
- 2026-07-06: ADR-060 принят владельцем проекта (Accepted 2026-07-06).
  Реализация не начата.
- 2026-08-13: S8-контракт принят; S9 реализован локально и зафиксирован
  GSR-049. PM-approved fallback расширен с 8 до 73 кандидатов. Реальный
  provider, полный terminal match и network join/reconnect не входят в
  принятие; S10 остаётся сетевой границей.
