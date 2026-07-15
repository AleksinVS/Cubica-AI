# Gameplay Slice Records

Gameplay Slice Records (GSR) capture bounded, delivery-specific gameplay mechanics for one concrete migration slice.

They complement ADRs instead of replacing them.

## Use GSR when

- a document needs step-, board-, line-, or card-level scope for one bounded slice;
- the document lists explicit actions, state fields, thresholds, branches, or legacy provenance needed for that slice;
- the document records the delivery boundary and out-of-scope follow-up for that slice.

## Do not use GSR when

- the document is making a project-level architecture decision;
- the document is deciding whether Cubica should add or reject a reusable engine, DSL, or platform-wide abstraction;
- the document is acting as an execution queue, a generic next-steps list, or a runtime handoff.

## Relationship to ADR

- ADRs contain only stable architecture decisions, constraints, alternatives, and consequences.
- GSRs carry the bounded gameplay delivery details that used to be mixed into ADR-020 through ADR-023.
- The architecture rule for bounded manifest-driven gameplay mechanics lives in `docs/architecture/adrs/024-bounded-manifest-driven-gameplay-mechanics.md`.

## Current Records

- `GSR-020` - Antarctica step `15` team selection.
- `GSR-021` - Antarctica step `19` threshold-based board progression.
- `GSR-022` - Antarctica step `21` metric-gated board outcomes and line switch.
- `GSR-023` - Antarctica step `23` locked go-card unlock and entry-time alt-card swap.
- `GSR-025` - Antarctica step `26` public communication board and explicit `i15` follow-up.
- `GSR-026` - Antarctica step `28` trusted messengers board and explicit `i16` follow-up.
- `GSR-027` - Antarctica step `30` acceleration board and explicit `i17` follow-up.
- `GSR-028` - Antarctica step `32` scout dispatch board, locked card `66`, and explicit `i18` follow-up.
- `GSR-029` - Antarctica step `34` relocation aftermath, `i19/i19_1` variant routing, and terminal `i21`.
- `GSR-030` - «Карты, деньги, поезда»: отменённый демонстрационный ход; сохранён как история происхождения mock-сценария и не входит в нормативную цифровую игру.
- `GSR-031` - «Карты, деньги, поезда»: первый обычный ход со случайной новостью, рынком, выбором груза, движением и расчетами.
- `GSR-032` - «Карты, деньги, поезда»: динамическое создание полустанка и дороги, несколько операций до отдельного завершения фазы и открытие построенных объектов через ход, в начале `N+2`.
- `GSR-033` - «Карты, деньги, поезда»: полная одноконтинентальная фасилитируемая сессия с методикой, постоянным хранением и ручным завершением.
- `GSR-034` - Estate Race: два локальных участника проходят воспроизводимый бросок, первую покупку и первый перевод ренты; аукцион, колоды, застройка, сеть и ИИ остаются последующими срезами.
- `GSR-035` - «Карты, деньги, поезда»: полностью проходимая сокращенная mock-партия от настройки до двух победителей, доказывающая весь цифровой цикл до получения авторского содержимого.
- `GSR-036` - «Карты, деньги, поезда»: первый срез Cubica Mechanics IR целиком переносит `mock.debrief.next-turn` — guard, увеличение хода, сброс фазовых данных, открытие всех созревших объектов, восстановление ресурса всем фактически активным локомотивам и запись журнала выполняются одной транзакцией без старых effects и перечисления ID.
