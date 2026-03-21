# ADR-024: Bounded Manifest-Driven Gameplay Mechanics In Cubica

- **Date**: 2026-03-21
- **Status**: Accepted
- **Supersedes**: `ADR-020`, `ADR-021`, `ADR-022`, `ADR-023`
- **Авторы**: Codex
- **Компоненты**: `games/*`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

## Контекст

При миграции Antarctica в канонический manifest-driven runtime нужно добавлять реальные gameplay-механики небольшими bounded slices.
В прежнем состоянии ADR-020..023 смешивали две разные вещи:

- стабильные архитектурные правила для моделирования bounded gameplay-механик в Cubica;
- delivery-specific спецификацию отдельных шагов, board-ов, card-id и migration boundaries.

Из-за этого ADR использовались как slice tracker и next-step spec, хотя ADR должны оставаться стабильными архитектурными решениями.

## Решение

1. Bounded gameplay mechanics в Cubica остаются manifest-driven и explicit.
   - Игровые действия описываются hand-authored manifest actions с явными id и deterministic metadata.
   - Переходы, confirm/advance actions и follow-up path должны быть явными, а не скрытыми runtime side effects.
2. Runtime может поддерживать bounded mechanics без преждевременной генерализации.
   - Threshold-based progression, metric-gated outcomes, bounded line switching, locked-card unlock и entry-time alt-card swap допустимы как локальные manifest semantics для конкретных действий и board-ов.
   - Generic workflow engine, selector DSL, rule interpreter или branch router не вводятся, пока не появится повторяющийся межсрезовый или межигровой use case.
3. Player-visible gating и progress должны быть auditable.
   - Всё, что нужно UI и player-facing delivery для показа доступности, прогресса или выбранного состояния, должно проецироваться в явный deterministic state, как правило в `state.public`.
   - Hidden runtime bookkeeping допустим только для того, что не является player-visible behavior boundary.
4. Canonical progression model использует явные маршруты и canonical ids.
   - Branch targets и line identity в runtime должны опираться на canonical string ids, а не на legacy numeric line indexes.
   - Board-local counters, resolved-card tracking и explicit follow-up chains должны оставаться bounded и readable в manifest/runtime model.
5. Delivery-specific bounded gameplay specs документируются отдельно от ADR.
   - Step-, board-, card- и migration-specific детали должны жить в Gameplay Slice Records под `docs/architecture/gameplay-slices/`.
   - ADR фиксирует только устойчивое архитектурное правило и границы допустимых решений.

## Альтернативы

- Ввести generic workflow/rule/selector engine уже на первых Antarctica slices. Rejected: это расширяет platform surface раньше подтверждённого повторного use case.
- Скрывать threshold, branching и unlock semantics во внутреннем runtime state или ad hoc коде. Rejected: это ухудшает auditability и player-facing projection.
- Продолжать использовать ADR как delivery tracker для bounded slices. Rejected: это смешивает архитектурное решение с execution planning и быстро устаревает.

## Последствия

Положительные:

- ADR снова становятся стабильным слоем архитектурных решений;
- bounded gameplay migration остаётся auditable и совместимой с manifest source of truth;
- новые локальные механики можно добавлять постепенно без преждевременного platform-wide DSL.

Trade-offs:

- manifest и runtime metadata остаются более verbose, чем в generic engine;
- для каждого bounded slice нужен отдельный Gameplay Slice Record;
- схожие механики первое время будут моделироваться вручную, пока не появится достаточный повторяющийся паттерн.

## Связанные артефакты

- `docs/architecture/gameplay-slices/README.md`
- `docs/architecture/gameplay-slices/020-antarctica-step-15-team-selection.md`
- `docs/architecture/gameplay-slices/021-antarctica-step-19-threshold-based-board-progression.md`
- `docs/architecture/gameplay-slices/022-antarctica-step-21-metric-gates-and-line-switch.md`
- `docs/architecture/gameplay-slices/023-antarctica-step-23-locked-go-card-and-alt-swap.md`
- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
