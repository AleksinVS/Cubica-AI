# ADR-022: Ограниченное conditional metric-gated line switching для Antarctica step 21

- **Дата**: 2026-03-21
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

## Контекст

После ADR-021 Antarctica уже умеет доходить по main line до `stepIndex = 20`, где открыт legacy info block `i12`.
Targeted extraction для следующего bounded slice показывает такую структуру:

- line `0`, step `20` -> `i12`;
- line `0`, step `21` -> cards `31..36`;
- line `0`, step `22` -> `i13`;
- line `1`, steps `0/1/2` -> `i34 -> i34_2 -> i21`.

В legacy source это выражено через numeric `lineIndex`, но в canonical runtime этот ADR должен опираться на string line ids. Соответственно, legacy `lineIndex = 1` для losing branch должен быть перенесён как отдельный canonical line id, например `loss`, а не как runtime numeric line identifier.

Следующий gameplay slice остаётся локальным, но добавляет два новых вида поведения:

- bounded metric-gated deltas внутри explicit cards `31..36`;
- bounded line switch для card `34`, который уводит на losing line.

Этот slice не должен превращаться в generic rule engine, универсальный workflow layer или payload-driven branching DSL.

## Решение

1. Вводится явный переход `i12 -> cards 31..36`.
   - Переход из legacy info block `i12` оформляется отдельным hand-authored action, например `opening.info.i12.advance`.
   - Runtime принимает этот переход только как explicit manifest action для main line на `stepIndex = 20`.
   - Implicit auto-advance и generic info-to-board workflow для этого slice не вводятся.
2. Cards `31..36` остаются явными manifest actions.
   - Для step `21` в manifest должны быть явно объявлены `opening.card.31` ... `opening.card.36`.
   - Каждая card action остаётся hand-authored и адресуется по explicit legacy card id.
   - Runtime должен принимать только этот bounded набор card actions для текущего board slice.
3. Metric-gated effects описываются локально и по карточкам.
   - Metric gates остаются частью deterministic metadata конкретной card action, а не выносятся в общий rule interpreter.
   - Для current slice gates должны быть зафиксированы явно:
   - cards `31`, `33`, `35`, `36` используют gate по `cont`;
   - card `32` использует gate по `pro`;
   - card `34` использует gate по `stat`.
   - Эти gates управляют только bounded card-local outcome для step `21`: conditional deltas и special branch trigger для `34`.
4. Line switch для card `34` остаётся bounded и explicit.
   - На main line, step `21`, card `34` может переключить timeline на losing line только по явному metric gate `stat < 25`.
   - Branch target задаётся явно как canonical line id, например `loss`, на его `stepIndex = 0`, то есть `i34`; legacy provenance при этом может ссылаться на `lineIndex = 1`, но current runtime не должен подразумевать numeric line ids. Generic branching router или reusable line-switch framework не вводятся.
   - Если gate не срабатывает, card `34` остаётся в normal main-line flow и применяет свой bounded deterministic outcome без line switch.
5. Normal follow-up и losing-line continuation оформляются отдельными explicit actions.
   - После normal resolution на main line runtime открывает отдельный явный follow-up action к `i13` на `stepIndex = 22`.
   - Losing branch не прыгает напрямую в terminal state: continuation должна быть описана как отдельная explicit chain `i34 -> i34_2 -> i21`.
   - Для этой цепочки нужны отдельные hand-authored info advance actions, а не generic "play current line until end" behavior.
6. Scope ADR остаётся ограниченным step `21`.
   - ADR покрывает только `i12`, cards `31..36`, normal follow-up к `i13` и losing line `i34 -> i34_2 -> i21`.
   - Main-line step `23` с cards `37..42`, а также более поздние branching/time-based outcomes в этот ADR не входят.

## Альтернативы

- Ввести generic rule engine для metric gates и branching. Rejected: это слишком широкая абстракция для одного bounded step-21 slice.
- Спрятать card-34 branch в ad hoc runtime code без явного manifest path. Rejected: losing line должна оставаться auditable и явно прослеживаемой в content model.
- Объединить step `21` и следующий main-line board `37..42` в один ADR. Rejected: это размывает bounded delivery boundary и усложняет проверку line-switch semantics.

## Последствия

Положительные:

- step `21` остаётся manifest-driven, explicit и проверяемым;
- card-local metric gates можно реализовать без generic workflow layer;
- losing line становится явной частью timeline model, а не скрытым runtime side effect.

Trade-offs:

- manifest и validation станут немного более verbose из-за explicit cards, follow-up actions и line-specific continuation;
- bounded conditional hooks для step `21` придётся описывать вручную по карточкам, но это соответствует текущему migration scope.

## Near-Term Implementation Direction

1. Добавить в `games/antarctica/game.manifest.json` explicit actions для `opening.info.i12.advance`, `opening.card.31` ... `opening.card.36`, normal follow-up к `i13` и losing-line continuation `i34 -> i34_2 -> i21`.
2. Расширить `packages/contracts/manifest` и runtime validation под bounded conditional metric-gated outcomes и explicit line-switch state update для card `34`.
3. Протянуть player-facing projection через `runtime-api`, чтобы `player-web` видел доступный normal follow-up или losing-line continuation без скрытого runtime branching.
4. Не вводить generic rule engine, reusable workflow abstraction или общий branching DSL до появления второго concrete use case.

## Связанные артефакты

- `docs/architecture/adrs/020-bounded-manifest-driven-team-selection.md`
- `docs/architecture/adrs/021-bounded-threshold-based-board-progression.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
