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

blocked

Status note: ADR-060 принят 2026-07-06; задача ожидает завершения turn-flow фаз.
`TSK-20260705-board-game-platform-capabilities` (ADR-058). НЕ требует сетевого
мультиплеера: агентское место работает уже в хотсит-сессии; от
`TSK-20260705-multiplayer-runtime-realization` берётся только модель
participants (Phase 2), которую можно реализовать и первой из двух задач.

## Understanding

Работа понята так: дать платформе ИИ-оппонентов для детерминированных
пошаговых игр по ADR-060 — агент занимает место участника, получает ту же
персональную проекцию, что человек, плюс платформенный список доступных
действий, и возвращает выбранный ход через валидируемый Agent Turn; исполнение
идёт обычным детерминированным путём. Стратегия агента — контент, не платформа.

## Architecture Source

- `docs/architecture/adrs/060-agent-controlled-players.md` (Proposed)
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
4. Модель participants с `kind: "agent"` заложена в ADR-059, но не реализована.

## Target State

1. Платформенная проекция `availableActions(sessionId, playerId)` с кэшем по
   `state_version`; используется агентом и доступна UI/eval-контуру.
2. Сессия может создать место `kind: "agent"` (в пределах
   `config.players.agentSeats` манифеста); readiness gate требует объявленного
   fallback-действия.
3. Планировщик: ход очереди у агентского места → системный Agent Turn с
   персональной проекцией + списком действий; ответ — `actionId`+аргументы;
   исполнение через обычный детерминированный путь/очередь.
4. Политика отказов: повторы с диагностикой → детерминированный fallback;
   недоступность Agent Runtime → failure policy ADR-046.
5. Ходы агента в event log и replay-транскриптах; evaluation fixtures
   легальности/разумности.

## Scope

- Контракт «выбор действия» в `packages/contracts/ai` (+JSON Schema, тесты).
- `availableActions` проекция в runtime-api (+кэш, +тесты, включая отсутствие
  утечки секретов в раскрываемых параметрах).
- Расширение манифест-схемы: `config.players.agentSeats`, fallback-действие
  (через контур ADR-056).
- Планировщик агентских ходов + политика отказов + readiness gate.
- Mock-агент «случайное легальное действие» для тестов/фикстур.
- Доказательство: хотсит-партия `dice-track` человек против mock-агента; replay
  и eval fixtures.

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

1. Создание места `kind: "agent"` (participants из ADR-059 §2.3 — реализовать
   здесь, если задача мультиплеера ещё не дала её).
2. Системный Agent Turn на ходе агента; исполнение выбора обычным путём;
   event log записи.

### Phase 4. Отказы и readiness

1. Повторы, детерминированный fallback, недоступность Agent Runtime по failure
   policy; readiness gate «есть fallback-действие»; диагностика в журнале.

### Phase 5. Доказательство и eval

1. Mock-агент «случайное легальное действие»; хотсит-партия `dice-track`
   человек vs агент до победителя (e2e).
2. Replay-транскрипт партии с агентом; evaluation fixtures легальности.

### Phase 6. Closeout

1. Обновить `PROJECT_ARCHITECTURE.md`, `NEXT_STEPS.md`, Handoff Log.

## Acceptance

- Хотсит-партия `dice-track` человек против mock-агента доигрывается до
  победителя без вмешательства.
- Принудительно невалидный выбор агента (тестовый adversarial mock) не меняет
  состояние и приводит к fallback после лимита повторов.
- Агент не получает `state.secret`, чужих приватных полей и порядка колод
  (тест на вход Agent Turn).
- Replay партии с агентом воспроизводится бит-в-бит.
- `verify:canonical`, contracts parity, game-agnostic инвариант — зелёные.

## Validation

```text
npm run generate:contracts && npm run verify:contracts-schema-parity
cd services/runtime-api && npm run typecheck && npm test
npm run verify:canonical
npx playwright test  # e2e человек vs mock-агент
```

## Risks

- Перечисление guards на каждый ход может быть дорогим при больших реестрах —
  кэш по `state_version` обязателен с Phase 1, бюджет фиксируется тестом.
- Двойная реализация participants (эта задача vs мультиплеер) — исключить
  явной координацией в Phase 0/3.
- Соблазн «подкрутить» честность (дать агенту больше информации ради силы
  игры) — запрещено ADR-060 §2.5; любые исключения только новым ADR.

## Handoff Log

- 2026-07-05: задача создана вместе с ADR-060 (Proposed). Реализация не начата.
- 2026-07-06: ADR-060 принят владельцем проекта (Accepted 2026-07-06).
  Реализация не начата.
