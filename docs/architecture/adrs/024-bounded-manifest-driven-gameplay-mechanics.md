# ADR-024: Bounded Manifest-Driven Gameplay Mechanics In Cubica

- **Date**: 2026-03-21
- **Status**: Accepted
- **Supersedes**: `ADR-020`, `ADR-021`, `ADR-022`, `ADR-023`
- **Авторы**: Codex
- **Компоненты**: `games/*`, `services/runtime-api`, `packages/contracts/manifest`, `apps/player-web`

## Контекст

При миграции игр в канонический manifest-driven runtime нужно добавлять реальные gameplay-механики небольшими bounded slices.
В прежнем состоянии ADR (на примере ADR-020..023) смешивали две разные вещи:

- стабильные архитектурные правила для моделирования bounded gameplay-механик в Cubica;
- delivery-specific спецификацию отдельных шагов, board-ов, card-id и migration boundaries для конкретных игр.

Из-за этого ADR использовались как slice tracker и next-step spec, хотя ADR должны оставаться стабильными архитектурными решениями.

## Решение

1. Bounded gameplay mechanics в Cubica остаются manifest-driven и explicit.
   - Игровые действия описываются hand-authored manifest actions с явными id и deterministic metadata.
   - Переходы, confirm/advance actions и follow-up path должны быть явными, а не скрытыми runtime side effects.
2. Runtime может поддерживать bounded mechanics без преждевременной генерализации.
   - Специфические механики (Threshold-based progression, metric-gated outcomes, bounded line switching, locked-card unlock) допустимы как локальные manifest semantics для конкретных игр.
   - Generic workflow engine, selector DSL, rule interpreter или branch router не вводятся, пока не появится повторяющийся межсрезовый или межигровой use case.
   - 2026-05-30 уточнение: ADR-040 вводит небольшой декларативный псевдоязык механик как развитие уже существующих templates, guards, JsonLogic, metric deltas и state patches. Это не отменяет запрет на большой workflow engine и не разрешает game-specific ветки в `runtime-api`.
3. Player-visible gating и progress должны быть auditable.
   - Всё, что нужно UI и player-facing delivery для показа доступности, прогресса или выбранного состояния, должно проецироваться в явный deterministic state, как правило в `state.public`.
   - Hidden runtime bookkeeping допустим только для того, что не является player-visible behavior boundary.
4. Canonical progression model использует явные маршруты и canonical ids.
   - Branch targets и line identity в runtime должны опираться на canonical string ids, а не на legacy numeric line indexes.
   - Специфичные счетчики и цепочки состояний должны оставаться bounded и readable в manifest/runtime model.
5. Delivery-specific bounded gameplay specs документируются отдельно от ADR.
   - Step-, board-, card- и migration-specific детали должны жить в Gameplay Slice Records под `docs/architecture/gameplay-slices/` или в документации конкретной игры `games/<id>/docs/`.
   - ADR фиксирует только устойчивое архитектурное правило и границы допустимых решений.

## Альтернативы

- Ввести generic workflow/rule/selector engine на ранних этапах. Rejected: это расширяет platform surface раньше подтверждённого повторного use case.
- Скрывать branching и semantics во внутреннем runtime state или ad hoc коде. Rejected: это ухудшает auditability и player-facing projection.
- Использовать ADR как delivery tracker для bounded slices конкретных игр. Rejected: это смешивает архитектурное решение с execution planning и быстро устаревает.

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
- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
