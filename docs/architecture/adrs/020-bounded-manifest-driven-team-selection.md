# ADR-020: Ограниченный manifest-driven team selection для Antarctica step 15

- **Дата**: 2026-03-21
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `games/antarctica`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

## Контекст

`opening.card.18.advance` и `opening.info.i9.advance` уже доводят Antarctica до `stepIndex = 15`.
Это первая точка, где нужна team-selection механика, но следующий slice должен оставаться bounded и не превращаться в универсальный workflow engine.

Для этого шага нужен минимальный и явный набор возможностей:

- выбор членов команды через explicit manifest actions;
- отдельное подтверждение после выбора ровно 5 членов;
- видимое состояние выбора в `state.public`;
- счётчик выбранных участников по stage.

## Решение

1. В manifest вводится ограниченный набор явных actions для team selection.
   - Action families должны быть объявлены явно, например `team.select.member.<memberId>` и `team.confirm`.
   - Confirm action должен быть отдельным action и допускаться только когда выбрано ровно 5 members.
   - Actions остаются hand-authored и stage-specific; payload-driven selector abstraction и generic selector engine на этом этапе не вводятся.
   - Для selection actions manifest должен содержать deterministic hooks:
     - `guard` проверяет, что текущий stage = `15`, member еще не selected, и `state.public.teamSelection.pickCount < 5`;
     - `stateUpdate` выставляет `state.public.flags.team[memberId].selected = true`;
     - `stateUpdate` инкрементирует `state.public.teamSelection.pickCount` и синхронизирует `state.public.teamSelection.selectedMemberIds`;
     - confirm action использует `guard`, который требует `state.public.teamSelection.pickCount === 5`.
2. В public state добавляются видимые team-selection flags.
   - `state.public.flags.team[memberId].selected` показывает выбор конкретного member.
   - `state.public.teamSelection.pickCount` хранит число выбранных members на текущем stage.
   - `state.public.teamSelection.selectedMemberIds` хранит список выбранных members для UI и confirm gating.
   - Player UI может рендерить selection state напрямую, не обращаясь к secret state.
3. Добавляется per-stage pick count tracking.
   - Selection progress учитывается по stage через `state.public.teamSelection.pickCount`.
   - Если понадобится более одного stage, счётчик должен жить в `state.public.teamSelection.byStage[stageId].pickCount`; для текущего slice достаточно `pickCount` на `stageIndex = 15`.
   - Confirm gating зависит от счётчика выбранных участников для текущего stage.
4. Runtime behavior остаётся bounded and explicit.
   - Runtime validates permitted selection actions и stage pick count.
   - Прематурный confirm и переполнение selection count отклоняются.
   - Broad DSL, универсальный workflow interpreter и payload-driven abstraction не вводятся.

## Альтернативы

- Ввести generic workflow engine с payload-driven selectors. Rejected: слишком широкая абстракция для одного bounded slice.
- Делать selection implicit через скрытое runtime state. Rejected: player-visible progress и confirm gating должны быть явными.
- Описывать выбор через общий payload schema. Rejected: abstraction would precede the second real use case.

## Последствия

Положительные:

- следующий Antarctica slice остаётся детерминированным и проверяемым;
- player-visible selection state становится явным в public state;
- confirm остаётся отдельным и аудируемым action.

Trade-offs:

- manifest придётся расширять explicit per-stage actions;
- выбор получается более verbose, чем generic selector, но scope остаётся bounded.

## Near-Term Implementation Direction

1. Добавить stage-15 team-selection actions в `games/antarctica/game.manifest.json`.
2. Расширить `packages/contracts/manifest` и runtime validation под `state.public.flags.team[memberId].selected`, `state.public.teamSelection.pickCount`, `state.public.teamSelection.selectedMemberIds`, и deterministic `guard`/`stateUpdate` hooks.
3. Протянуть новую public state projection через `runtime-api`, чтобы `player-web` мог показать selection and confirm affordances.
4. Не вводить general workflow engine, payload DSL или reusable selector abstraction до появления второго concrete use case.

## Связанные артефакты

- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
