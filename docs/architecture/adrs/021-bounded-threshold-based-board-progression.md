# ADR-021: Ограниченная threshold-based board progression для Antarctica step 19

- **Дата**: 2026-03-21
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

## Контекст

После ADR-020 Antarctica уже умеет проходить bounded team-selection path до `stepIndex = 18`.
Следующий bounded gameplay slice начинается на `stepIndex = 19` и соответствует board progression для legacy board `25..30`.

Для этого шага нужен отдельный, но по-прежнему локальный механизм:

- card actions остаются явными manifest actions;
- отдельный board advance action разрешается только после достижения threshold по resolved cards на текущем board;
- threshold должен считаться по explicit board card ids / resolved-card count;
- generic selector engine, универсальный workflow layer и payload-driven abstraction для этого slice не вводятся.

## Решение

1. В manifest вводятся явные card actions для текущего board slice.
   - Каждая card action остаётся hand-authored и адресуется по explicit card id.
   - В рамках этого ADR card actions не превращаются в selector-driven family и не сводятся к generic workflow step.
   - Runtime должен принимать только те card actions, которые явно объявлены для текущего board slice.
2. Добавляется отдельный board advance action.
   - Advance action отделяется от card actions и не привязывается к одной "go-card".
   - Advance action становится доступным только когда на текущем board достигнут threshold по resolved cards.
   - Threshold gating использует explicit board card ids и resolved-card count, а не selector engine или implicit pattern matching.
3. Threshold evaluation остаётся локальной и прозрачной.
   - Для текущего slice достаточно board-scoped bookkeeping, например списка resolved card ids и derived resolved count.
   - Board progress может опираться на `state.public` projection для UI, но не требует универсального workflow interpreter.
   - Проверка доступа к advance action должна быть deterministic и bounded.
4. Scope этого ADR ограничен step 19.
   - Этот ADR покрывает только threshold-based board progression для next Antarctica board slice.
   - Conditional metric gates, line switching и branching mechanics из later step 21 в этот ADR не входят.

## Альтернативы

- Ввести generic workflow engine. Rejected: это слишком широкая абстракция для одного bounded board slice.
- Делать progression implicit через hidden runtime state. Rejected: threshold и resolved cards должны быть явными для auditability и UI.
- Смешать step 19 board progression с later conditional branching. Rejected: это размывает границу slice и затрудняет изоляцию следующего изменения.

## Последствия

Положительные:

- board progression остаётся bounded, explicit и проверяемой;
- card actions и advance action остаются отдельными и аудируемыми;
- threshold logic можно расширять без внедрения generic workflow layer.

Trade-offs:

- manifest становится немного более verbose из-за явного учёта resolved board cards;
- без generic selector engine придётся описывать board-specific actions явно, но это соответствует current canonical slice.

## Near-Term Implementation Direction

1. Добавить explicit board card actions и separate advance action в `games/antarctica/game.manifest.json` для step `19`.
2. Расширить manifest/runtime validation под board-scoped resolved-card tracking и deterministic threshold guard.
3. Протянуть player-facing projection для board progress через `runtime-api`, чтобы `player-web` мог показывать доступность advance action.
4. Не вводить conditional branching, metric gates или line switching до следующего, отдельно оформленного slice.

## Связанные артефакты

- `docs/architecture/adrs/020-bounded-manifest-driven-team-selection.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
