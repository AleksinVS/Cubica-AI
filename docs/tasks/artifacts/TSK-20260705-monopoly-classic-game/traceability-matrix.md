# Матрица трассировки Estate Race (S0–S10)

Матрица является исполнительным срезом полного плана S0–S10 и не создаёт
отдельную очередь. Источником порядка и критериев служит [полный
исполнительный план](full-implementation-execution-plan.md), наблюдаемым
описанием первого среза — [продуктовая спецификация](product-specification.md),
а происхождение данных и права — [правила и происхождение](rules-and-rights-provenance.md).

Статусы означают: `реализовано` — поведение есть в текущем коде и имеет
свежую проверку; `в исполнении` — реализация начата, но принятие и свежая
проверка ещё не заявлены; `запланировано` — правило назначено срезу и имеет критерий,
но ещё не принято; `заблокировано` — дальнейшая работа зависит от явно
указанного решения или внешнего результата. P-01 принято PM 2026-08-12:
оригинальные наборы Estate Race — кандидаты публичного контента только после
provenance/hash и проверки баланса; публикация ими ещё не объявляется.

## Реализовано после S0 и запланировано далее

| Правило | Срез | Состояние / Game Intent / план | UI | Проверка | Статус |
|---|---|---|---|---|---|
| Сервер выбирает результат 2d6, сохраняет его и точно повторяет команду | S1 (GSR-034) | `public.board.lastRoll`, receipt/events; `turn.roll`; план случайности и retry из ADR-058/096 | кости и журнал результата | управляемая выборка, повтор `commandId` без нового броска | реализовано |
| Ход исполняется только активным участником | S1 (GSR-034) | `public.turn.activePlayerId`; guard + `turn.next`; actor-проверка | активный игрок и недоступность чужой кнопки | отрицательный чужой ход | реализовано |
| Фишка движется циклически, а круг начисляет выплату | S1 (GSR-034) | `players.*.metrics.position/cash`; `turn.roll` → `metric.set/add`; план движения | поле, фишки, баланс | переход через границу трека и порядок эффектов | реализовано |
| Свободный участок покупается атомарно | S1 (GSR-034) | `boardCells.*.ownerPlayerId`; `property.buy`; проверка ссылки/баланса | цена, кнопка, рамка владения | браузерный flow и недостаток денег без частичного изменения | реализовано |
| Участок другого игрока начисляет ренту атомарным переводом | S1 (GSR-034) | балансы участников; `property.pay-rent`; перевод player→player | объяснимый платёж и журнал | браузерный flow первой ренты | реализовано |
| Платформа не содержит ветки `estate-race` и предметных идентификаторов | S0 | общий Mechanics IR/dispatcher; план чистоты платформы | только game-owned bindings | проверка поставщика и запрет id в core | реализовано |
| DOM-путь остаётся доступным без Phaser | S1 (GSR-034) | публичная проекция и поставщик модуля; те же `actionId` | обычные DOM-кнопки | тест кнопок без созданного Phaser handle | реализовано |
| Поле содержит 40 оригинальных клеток с типом, индексом, группой и ценовыми шкалами; пакет принимает 2–6 участников | S1 (GSR-037, фундамент) | `boardCells`, `config.players`, board size/reward; authoring → manifest | полное поле, типы клеток и проекция до шести произвольных participant id | manifest authoring, 40 уникальных индексов/10 типов, границы 2/6, plugin projection | реализовано; зависимые критерии закрыты GSR-038–040 |
| Первый/второй дубль сохраняют дополнительный бросок, третий заключает, обычный бросок сбрасывает цепочку | S1 (GSR-038) | `consecutiveDoubles`, `extraRollPending`, `players.*.flags.inJail`; `turn.roll/finish`; typed conditional plans | серверные фаза и доступность действия; клиент не вычисляет дубль | replay покупки/ренты/нейтральной клетки, third-double без круга, exact retry и jailed-roll rejection | реализовано |
| Старт, налоги, нейтральные клетки, посещение/отправка в тюрьму проходят через dispatcher | S1 (GSR-039) | `turn.phase`, `players.*.metrics`; `turn.roll` → типизированный выбор `boardCells`; только активированные типы | серверные `tax.pay`/`turn.finish`, явная `blocked`-фаза и статус заключения | replay обоих налогов, недостатка денег, стартовой/нейтральной/тюремных клеток и всех 30 ещё не активированных клеток; plugin projection | реализовано |
| Однократный setup случайно упорядочивает точные 2–6 фактических участников | S1 (GSR-040) | bounded record-map `state.players`; `session.setup.finalize` → select/order → атомарный `public.turn` | DOM-кнопка setup и display-only фаза; запрос без `playerId` | replay 2/6, permutation, exact retry без RNG, новый command reject до RNG; browser setup → реальный roll | реализовано; S1 завершён |
| Отказ от покупки создаёт обязательный последовательный аукцион | S2 (GSR-041) | auction state, `activePlayerId` + `resumePlayerId`; `property.auction.*`; общий actor plan | панель ставки, pass и завершения | replay 2/6, круговая ротация, чужой ход, сумма/баланс, победитель не `p1`, exact retry и production browser flow | реализовано |
| Рента различается для групп, линий и коммунальных объектов | S2 (GSR-041) | owner/group/kind metrics; `property.rent`; typed formula plan | карточка собственности и объяснение суммы из серверной проекции | все группы, линии 1–4, коммунальные 1–2 и отрицательный баланс | реализовано; S2 завершён |

## Запланировано после S0

| Правило | Срез | Состояние / Game Intent / план | UI | Проверка | Статус |
|---|---|---|---|---|---|
| Две скрытые колоды дают оригинальный эффект, discard и повторное перемешивание | S3 (GSR-042) | deck/discard state; `deck.draw`; bounded `effectKind` dispatcher | публичный результат карты | replay каждого эффекта, движения через старт, exhaustion, reshuffle, exact retry и поздний rollback | реализовано; набор — кандидат публичного контента после provenance/hash и проверки баланса |
| Удерживаемые карты выхода обеих колод извлекаются и возвращаются в точную колоду | S3/S5 (GSR-042/044) | два actor-private held leaf; `deck.extract/return`; accepted deck operations | обе карты видны только владельцу | три реальных цикла, одновременное удержание `event-exit`/`fund-exit`, peer/anonymous не получают held и secret deck | реализовано; набор — кандидат публичного контента после provenance/hash и проверки баланса |
| Тюрьма имеет оплату, обе карты, дубль и предел попыток выхода | S3/S5 (GSR-042/044) | jail phase/attempts; `jail.pay`, `jail.card.use.*`, `jail.roll`, `jail.third.move`, `turn.finish` | состояние тюрьмы и только server-declared способы выхода | оплата, обе карты, дубль, две неудачи, третья попытка, обязательство без повторного RNG | реализовано |
| Строительство/продажа равномерны и ограничены запасом банка 32/12 | S4 (GSR-043) | `improvementTier`, `bankBuildings`; `property.build/sell`; bounded inventory plans | подтверждённые tier, банк и DOM-параметры | replay `0↔5`, равномерности, атомарного отказа и 32/12; production DOM sale | реализовано |
| Отель заменяет четыре дома, обратный разбор и продажа используют согласованную долю | S4 (GSR-043) | tier `4↔5`, возврат домов/отеля и точная `sellValue` | ступень ренты и подтверждение продажи | все уровни туда/обратно, точные суммы и inventory conservation | реализовано |
| Залог запрещён улучшенной группе; заложенный объект исключается из ренты | S4 (GSR-043) | `mortgaged`; `property.mortgage/redeem/rent`; invariant plans | панель залога/выкупа и `cellId` DOM-form | positive/negative replay, рента и production mortgage→redeem | реализовано |
| Дефицит строений разрешается однотипным окном и последовательными аукционами | S4 (GSR-043) | `buildingWindow/buildingAuction`, exact request slots; `property.build.*` | окно, остаток, ставка/pass без клиентского победителя | спрос `<`, `=`, `>` остатка, 2/6, несколько лотов/all-pass/exact retry и production DOM flow | реализовано; S4 завершён |
| Сделка проходит propose/accept/decline/cancel с повторной проверкой владения | S5 (GSR-044) | offer state, actor/resume actor; `trade.*`; sequential reaction plan | панель и DOM-формы только опубликованных действий | деньги/объекты/обе карты, stale funds/ownership, decline/cancel, rollback и exact retry | реализовано |
| Непогашенное обязательство допускает только продажу строений и залог | S5 (GSR-044) | obligation/liability state; `obligation.resolve`, liquidity intents; phase plan | подтверждённая сумма, получатель и server-declared действия | налог, рента, тюрьма, карточные цепочки, погашение через mortgage, без частичного успеха | реализовано |
| Банкротство передаёт активы кредитору или банку и исключает участника | S5 (GSR-044) | `state.players.status`, ownership/held cards, liquidation state; `bankruptcy.declare`; transfer/auction plans | получатель, pending asset и DOM-действия залога/аукциона | оба получателя, две карты, заложенный актив, multi-lot/all-pass, 2/6, пропуск eliminated и browser flow | реализовано; S5 завершён |
| Последний активный участник становится победителем ровно один раз | S6 (GSR-045) | `state.players` bounded record-map, server-owned terminal outcome; `estate.finish-last-active-player` | итоговый экран, закрытие изменяющих действий | `3→2`, обе ветви `2→1`, multi-lot, exact retry и terminal rejection | реализовано; S6 завершён |
| Локальная партия 2–6 игроков использует один manifest до terminal outcome | S6 (GSR-045) | один game manifest; поздняя допустимая фикстура задаётся до session creation, затем только Game Intents | responsive UI, DOM fallback и подтверждённый winner | начало/середина/поздняя/terminal fixtures, bounded transcript и production browser flow | реализовано для локального режима; долговечное PostgreSQL-восстановление остаётся внешней границей private invite network |
| Тексты, карточки, mockups и методический слой подключаются к тем же состояниям | S7 (GSR-046) | content provenance + UI bindings; read-only projections и risk confirmations; game/UI authoring `0.7.0` | map-first адаптивное поле, карточки, keyboard/focus, reflection, game-owned design reference, responsive camera | package `49/49`, plugin `37/37` + typecheck, balance `3/3` (`PASS-for-closed-alpha`), production browser S0–S7 `8/8`, style-parity `PASS`; локальная accessibility matrix `PASS` на 1400x1000/768x1024/320x800 | реализовано; публикация и финальный баланс не объявлены |
| Общая модель участников сохраняет actor boundary, персональную проекцию и доступные действия | S8 (GSR-047) | session-owned item `seatId:string`, `playerId:string`, `kind:human\|agent`, `joinState:local`; S8 создаёт только human/local; опциональный `participantCount` выбирает число мест в manifest bounds, но не идентичности; actor-scoped projection и те же intents | общий экран выбора 2–6 для первой локальной сессии, локальная проекция и доступность действий; для нейтральной неходовой фикстуры не создаются искусственные `state.players`/`public.turn` | create-contract shape + semantic bounds, privacy, stale version и actor checks; canonical contracts/OpenAPI, runtime `371` + `2` skip, Player `280/280` + production build, PostgreSQL unit/restart boundary, game-agnostic и player-core seam | реализовано; review-исправление participantCount проверено |
| ИИ получает только проекцию и доступные действия, а не состояние движка | S9 (GSR-049) | schema-first `agentSeats`, local `agentSeatCount`; system-owned Agent Turn → ordinary projection/availability/Intent; fallback до 73 | agentControl receipt-derived, paused/facilitatorTakeover, participant labels; malformed/paused fail closed | 73 candidates (72 reject/no partial state, #73 commit, #74 schema reject), exact retry без rescan; 7 eval fixtures; bounded human+agent transcript; Estate Race 53/53, balance 3/3, compiler | реализовано локально; provider/full terminal match вне scope |
| Private invite network сохраняет actor boundary и reconnect | S10 (GSR-050) | authenticated invite-only participants, одноразовый claim с durable credential в `HttpOnly` cookie, узкий recovery уже joined human guest seat, authenticated SSE cursor + full authenticated HTTP GET projection, PostgreSQL version; те же intents | два браузерных контекста, reconnect и recovery state | spoofing/privacy, stale version, reconnect/resync; historical S10 two-browser E2E с desktop+narrow visual inspection; recovery evidence: contracts generator `--check`, schema parity, `verify:api-contracts`, contracts-session `16/16` + typecheck; до финальной защиты гонки SSE runtime focused `53/53` + typecheck и full runtime `411 pass / 3 skip / 0 fail`; после неё session event hub `8/8` и private invite/recovery `6/6`; Player focused `81/81` + typecheck, full Player `342/342` + typecheck, production build PASS, Playwright `1/1` PASS с loopback insecure-cookie flag, package `53/53`, plugin `37/37` + typecheck, disposable PostgreSQL 17 `2/2` | принято для закрытой альфы; каталог/content/economy/product publication и production readiness остаются отдельными воротами |
| Каталог публикуется только после принятия содержания, ресурсов и режимов | S10 | immutable game bundle + provenance; release/catalog plan | утверждённое название, описание и preview | production build/E2E, rights and product acceptance | запланировано |

## Заблокировано решениями и внешними воротами

| Правило/ворота | Срез | Состояние / Game Intent / план | UI | Проверка | Статус |
|---|---|---|---|---|---|
| P-01: оригинальный публичный кандидат | S7 | принято PM 2026-08-12; source-of-truth наборы имеют provenance/hash; balance `3/3` только `PASS-for-closed-alpha` | public local UI/content завершены для локальной приёмки; каталог не активируется | provenance/rights-record, balance review и будущая economy telemetry | принято; публикационные критерии остаются |
| Финальное содержание, публикация в каталоге и полная продуктовая приёмка | S10 | P-01 разблокировал кандидатный пакет; S7 UI/local surface уже приняты для локальной приёмки, но финальные content, catalog и product acceptance ещё не приняты | production/catalog branding не объявляется готовым | content/provenance, balance и product acceptance | запланировано |
| ИИ-места | S9 (GSR-049) | S8-контракт и ADR-060 приняты; отдельную ветку runtime создавать нельзя | явная agent-seat setup только при декларации; fail closed | adversarial projection/fallback checks и bounded transcript | реализовано локально; provider/full terminal match вне scope |
| Каталог и полное закрытие | S10 | зависит от P-01, S7, `LEGACY-0072` и `LEGACY-0068`; source of truth не расширяется | каталог не публикуется | milestone H/N/A и product/rights acceptance | заблокировано: зависимости |

Visual reference SHA-256: `f492f69142368e03def533fe5aead099f67c1f037582072eaa6dc059fd7c250c`;
balance report/input SHA-256: `0d06087345740f5e88b842c416366884451ea6e5d11d998ab94f2b1ea943c9e7` /
`9e1ac64d249f958e162308c012eb423dc8757d6627f976b8c264b32c0120134b`. Локальная
visual/accessibility matrix — evidence конкретных viewport-проверок, не
сертификация доступности. Для публичного релиза остаются economy telemetry и
решение о целевой длительности партии.

Таким образом, ни одно существенное правило S1–S10 не остаётся без среза,
состояния/намерения, UI, проверки и статуса; `запланировано` не означает
фактическую реализацию.
