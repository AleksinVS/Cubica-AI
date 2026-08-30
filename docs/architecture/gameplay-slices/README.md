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
- `GSR-034` - Estate Race: два локальных участника проходят серверный бросок, первую покупку и первый перевод ренты; аукцион, колоды, застройка, сеть и ИИ остаются последующими срезами.
- `GSR-035` - «Карты, деньги, поезда»: полностью проходимая сокращенная mock-партия от настройки до двух победителей, доказывающая весь цифровой цикл до получения авторского содержимого.
- `GSR-036` - «Карты, деньги, поезда»: первый срез Cubica Mechanics IR целиком переносит `mock.debrief.next-turn` — guard, увеличение хода, сброс фазовых данных, открытие всех созревших объектов, восстановление ресурса всем фактически активным локомотивам и запись журнала выполняются одной транзакцией без старых effects и перечисления ID.
- `GSR-037` - Estate Race: фундамент S1 с полным оригинальным полем из 40 клеток и конфигурацией 2–6 участников; тогда ещё открытые порядок, дубли и landing-сценарии закрыты последующими GSR-038–040.
- `GSR-038` - Estate Race: серверная цепочка дублей, дополнительный бросок после разрешения клетки и третий дубль с заключением; зафиксированный тогда record-map блокер порядка исторически закрыт GSR-040.
- `GSR-039` - Estate Race: типизированный серверный dispatcher выбирает текущую клетку по авторитетной позиции, разрешает старт, налоги и тюремные углы, а все ещё не активированные типы переводит в явную заблокированную фазу без ложного действия.
- `GSR-040` - Estate Race: явное одноразовое setup-действие случайно упорядочивает точные 2–6 фактических участников, атомарно публикует ход и завершает S1 с доказательством повторов и отказов до случайности.
- `GSR-041` - Estate Race: все покупаемые объекты получают покупку, отказ, game-owned последовательный аукцион и серверную ренту без застройки; S2 завершён.
- `GSR-042` - Estate Race: две скрытые колоды, удерживаемая actor-private карта выхода, полный game-owned цикл тюрьмы и server-owned browser flow; S3 завершён, а оригинальный кандидатный набор позднее принят в S7 без объявления каталожной публикации.
- `GSR-043` - Estate Race: уровни домов и отеля, физический запас банка, равномерная застройка и продажа, залог/выкуп и последовательный аукцион дефицитных строений; S4 завершён.
- `GSR-044` - Estate Race: сделки с деньгами, собственностью и двумя actor-private удерживаемыми картами, явные обязательства, ликвидность и банкротство банку или участнику; S5 завершён без предметных веток в общей платформе.
- `GSR-045` - Estate Race: последний активный участник становится server-owned победителем, terminal outcome закрывает действия, а agent-seat readiness остаётся за отдельной общей реализацией ADR-060; локальный S6 завершён.
- `GSR-046` - Estate Race: самостоятельная оригинальная публичная поверхность, единая визуальная система и необязательный read-only обучающий режим; S7 завершён без нового движка правил.
- `GSR-047` - Estate Race: session-owned локальные participants отделяют место от игрового actor, используют существующие проекцию и availability и готовят S9 без WebSocket, join lifecycle или игровых веток в платформе.
- `GSR-049` - Estate Race: локальное агентское место использует actor-scoped Game Intent, bounded fallback до 73 кандидатов, receipt-derived control и fail-closed Player Web; S9 завершён локально.
- `GSR-048` - «Карты, деньги, поезда»: общий переносимый JSON-журнал строится из подтверждённых публичных событий, скачивается через credential-holding BFF и доказывается настоящей погрузкой груза без ИИ-интерпретации.
- `GSR-050` - Estate Race: закрытое приглашение одноразово занимает сетевое место, durable credential передаётся через `HttpOnly` cookie, authenticated SSE и полный HTTP GET восстанавливают персональную проекцию, а узкий recovery уже joined human guest seat завершает закрыто-альфовую trust boundary; принято для закрытой альфы, но не для каталога/production.
- `GSR-051` - «Карты, деньги, поезда»: ведущий после финала получает один сохраняемый ИИ-черновик, в котором факты привязаны к событиям переносимого журнала, интерпретации отделены от них, а вопросы помогают провести итоговую рефлексию без изменения игры.
