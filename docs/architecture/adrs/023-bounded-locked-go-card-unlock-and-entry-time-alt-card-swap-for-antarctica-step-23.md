# ADR-023: Ограниченные locked go-card unlock и entry-time alt-card swap для Antarctica step 23

- **Дата**: 2026-03-21
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

## Контекст

После ADR-022 Antarctica уже умеет доходить по main line до `stepIndex = 23`, где после `opening.info.i13.advance` открывается legacy board `37..42`.
Targeted extraction для следующего bounded slice показывает такую структуру:

- line `0`, step `23` -> cards `37..42`;
- line `0`, step `24` -> `i14`;
- line `0`, step `25` -> `i14_2`;
- line `0`, step `26` -> cards `43..48`.

Для этого slice важны две локальные механики:

- card `39` стартует locked и является go-card текущего board;
- `unlock39(3)` разблокирует card `39` после не менее чем трёх resolved cards на текущем board;
- при входе в доступную card `39` legacy logic может bounded-заменить её на alt card `3902`, если `pro > 40`.

Этот slice не должен превращаться в generic workflow engine, универсальный rule engine, reusable selector DSL или payload-driven card-selection abstraction.

## Решение

1. Board `37..42` описывается явно и целиком.
   - Для step `23` в manifest должны быть явно объявлены `opening.card.37`, `opening.card.38`, `opening.card.39`, `opening.card.40`, `opening.card.41`, `opening.card.42`.
   - Runtime принимает только этот bounded набор actions для текущего board slice.
   - Cards `37`, `38`, `40`, `41`, `42` остаются обычными explicit card actions, а `39` остаётся отдельной explicit locked go-card, а не выводится через generic selector family.
2. Unlock для card `39` остаётся board-local threshold mechanic.
   - Unlock считается только по explicit resolved cards текущего board `37..42`.
   - Threshold фиксирован и bounded: `39` становится доступной после не менее чем трёх resolved cards на этом board.
   - Для current slice достаточно явного board-scoped bookkeeping с resolved card ids и derived resolved count; generic workflow layer для таких threshold'ов не вводится.
3. Alt swap `39 -> 3902` выполняется только как entry-time bounded branch.
   - После того как card `39` стала доступной, runtime при её выборе проверяет только один явный gate: `pro > 40`.
   - Если gate срабатывает, вместо базовой `39` применяется explicit alt outcome `3902`.
   - Если gate не срабатывает, используется normal outcome базовой `39`.
   - Эта механика остаётся локальной для card `39` на step `23` и не должна оформляться как reusable rule engine, общий branch router или generic alt-card DSL.
4. Follow-up после go-card оформляется отдельными explicit actions.
   - Разрешение базовой `39` или alt `3902` не должно подразумевать скрытый auto-play по timeline.
   - Переход к `i14` на `stepIndex = 24` оформляется отдельным explicit advance action.
   - Переход из `i14` к `i14_2` на `stepIndex = 25` тоже оформляется отдельным explicit info advance action.
   - Следующий board `43..48` на `stepIndex = 26` в scope этого ADR не входит; этот ADR заканчивается на boundary `stepIndex = 26`, то есть после explicit path `step 23 -> i14 -> i14_2` и без реализации cards `43..48`.
5. Scope ADR остаётся ограниченным step `23` и его immediate follow-up.
   - ADR покрывает только board `37..42`, locked go-card `39`, bounded unlock after three resolved cards, entry-time alt swap `39 -> 3902`, а также explicit advances к `i14` и `i14_2` до boundary `stepIndex = 26`.
   - Cards `43..48`, info block `i15` и позднейшие mechanics должны оформляться следующим отдельным bounded slice.

## Альтернативы

- Ввести generic workflow/rule engine для locked-card unlock, alt swap и follow-up transitions. Rejected: это слишком широкая абстракция для одного bounded step-23 slice.
- Описать `39` и `3902` как selector-driven variants одной card family. Rejected: текущая механика опирается на один explicit legacy card id и один explicit alt id, без второго concrete use case для generic selector DSL.
- Слить step `23` и следующий board `43..48` в один ADR. Rejected: это размывает delivery boundary и мешает изолированно проверить unlock/swap semantics.

## Последствия

Положительные:

- step `23` остаётся manifest-driven, explicit и проверяемым;
- unlock и alt swap для `39` становятся auditable без скрытого runtime behavior;
- follow-up path к `i14` и `i14_2` остаётся явным и не требует generic timeline interpreter.

Trade-offs:

- manifest и validation станут более verbose из-за explicit board bookkeeping, locked go-card и отдельного alt outcome `3902`;
- без generic selector DSL аналогичные будущие mechanics придётся описывать вручную, но это соответствует текущему bounded migration scope.

## Near-Term Implementation Direction

1. Добавить в `games/antarctica/game.manifest.json` explicit actions для `opening.card.37` ... `opening.card.42`, включая locked state для `39`, explicit alt outcome `3902` и separate advance actions к `i14` и `i14_2`.
2. Расширить `packages/contracts/manifest` и runtime validation под bounded board-scoped resolved-card tracking, deterministic unlock threshold и entry-time alt swap для explicit card id `39`.
3. Протянуть player-facing projection через `runtime-api`, чтобы `player-web` видел locked/unlocked state card `39`, resolved-card progress текущего board и доступный follow-up без скрытого workflow behavior.
4. Не вводить generic workflow engine, generic rule engine или reusable selector DSL до появления второго concrete use case.

## Связанные артефакты

- `docs/architecture/adrs/021-bounded-threshold-based-board-progression.md`
- `docs/architecture/adrs/022-bounded-conditional-metric-gated-line-switching-for-antarctica-step-21.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
