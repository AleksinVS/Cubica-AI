# ADR-024: Manifest-Driven Gameplay Mechanics In Cubica

- **Date**: 2026-03-21
- **Status**: Accepted
- **Supersedes**: `ADR-020`, `ADR-021`, `ADR-022`, `ADR-023`
- **Generalization policy amended by**: `ADR-083`
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
2. Runtime развивает универсальный комбинируемый язык механик по ADR-083.
   - Предметный сценарий раскладывается на нейтральные операции выбора, проверки, вычисления, ветвления, планирования и изменения состояния.
   - Один реальный игровой срез достаточен для добавления общего примитива, если контракт нейтрален, проверяем схемой и доказан отдельной нейтральной фикстурой.
   - Селекторы, ограниченные циклы, интерпретация правил и сценарная композиция допустимы и желательны, когда они сокращают число предметных runtime-эффектов. Они исполняются только в проверяемых пределах, атомарно, воспроизводимо и без произвольного доступа к окружению.
   - Игровая специфика остаётся в manifest actions и компилируемых шаблонах, но общий runtime не должен кодировать её отдельными предметными глаголами.
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

- Сохранять только узкие предметные эффекты до появления повторного межигрового случая. Rejected: публичные узкие контракты закрепляются в играх и делают последующую миграцию дороже.
- Разрешить универсальному языку исполнять произвольный код или обращаться к окружению без декларативных прав и лимитов. Rejected: это нарушает безопасность, воспроизводимость и межплатформенную проверку.
- Скрывать branching и semantics во внутреннем runtime state или ad hoc коде. Rejected: это ухудшает auditability и player-facing projection.
- Использовать ADR как delivery tracker для bounded slices конкретных игр. Rejected: это смешивает архитектурное решение с execution planning и быстро устаревает.

## Последствия

Положительные:

- ADR снова становятся стабильным слоем архитектурных решений;
- bounded gameplay migration остаётся auditable и совместимой с manifest source of truth;
- новые игровые правила можно добавлять через общие примитивы без предметных веток в platform runtime;
- селекторы, вычисления и сценарная композиция становятся повторно используемой частью языка механик уже с первого доказанного игрового сценария.

Trade-offs:

- универсальный язык, его лимиты выполнения и редактор требуют более строгого проектирования и версионирования;
- для каждого bounded slice нужен отдельный Gameplay Slice Record;
- существующие узкие эффекты нужно поэтапно мигрировать на общие примитивы с сохранением совместимости опубликованных игр.

## Связанные артефакты

- `docs/architecture/gameplay-slices/README.md`
- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/adrs/019-runtime-api-owns-content-loading-and-player-facing-content-api.md`
- `docs/architecture/adrs/083-universal-composable-gameplay-mechanisms.md`
