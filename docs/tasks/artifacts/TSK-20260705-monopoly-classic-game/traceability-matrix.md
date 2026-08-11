# Матрица трассировки Estate Race (S0–S4)

Матрица является исполнительным срезом полного плана S0–S10 и не создаёт
отдельную очередь. Источником порядка и критериев служит [полный
исполнительный план](full-implementation-execution-plan.md), наблюдаемым
описанием первого среза — [продуктовая спецификация](product-specification.md),
а происхождение данных и права — [правила и происхождение](rules-and-rights-provenance.md).

Статусы означают: `реализовано` — поведение есть в текущем коде и имеет
свежую проверку; `запланировано` — правило назначено срезу и имеет критерий,
но ещё не принято; `заблокировано` — дальнейшая работа зависит от явно
указанного решения или внешнего результата. До решения P-01 используются
только оригинальные данные Estate Race; это не разрешает публикацию
содержимого.

## Реализовано в текущем срезе

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
| Две скрытые колоды дают оригинальный эффект, discard и повторное перемешивание | S3 (GSR-042) | deck/discard state; `deck.draw`; bounded `effectKind` dispatcher | публичный результат карты | replay каждого эффекта, движения через старт, exhaustion, reshuffle, exact retry и поздний rollback | реализовано; окончательное содержание блокирует P-01 |
| Удерживаемая карта выхода извлекается и возвращается в колоду | S3 (GSR-042) | actor-private held leaf; `deck.extract/return`; accepted deck operations | панель удерживаемой карты только владельцу | три реальных цикла draw/extract/return в одной сессии; peer/anonymous не получают held и secret deck | реализовано; окончательное содержание блокирует P-01 |
| Тюрьма имеет оплату, дубль и предел попыток выхода | S3 (GSR-042) | jail phase/attempts; `jail.pay`, `jail.card.use.event`, `jail.roll`, `turn.finish` | состояние тюрьмы и только server-declared способы выхода | оплата, карта, дубль, две неудачи, третья попытка и отказ до RNG при нехватке денег | реализовано; insolvency остаётся S5 |
| Строительство/продажа равномерны и ограничены запасом банка 32/12 | S4 (GSR-043) | `improvementTier`, `bankBuildings`; `property.build/sell`; bounded inventory plans | подтверждённые tier, банк и DOM-параметры | replay `0↔5`, равномерности, атомарного отказа и 32/12; production DOM sale | реализовано |
| Отель заменяет четыре дома, обратный разбор и продажа используют согласованную долю | S4 (GSR-043) | tier `4↔5`, возврат домов/отеля и точная `sellValue` | ступень ренты и подтверждение продажи | все уровни туда/обратно, точные суммы и inventory conservation | реализовано |
| Залог запрещён улучшенной группе; заложенный объект исключается из ренты | S4 (GSR-043) | `mortgaged`; `property.mortgage/redeem/rent`; invariant plans | панель залога/выкупа и `cellId` DOM-form | positive/negative replay, рента и production mortgage→redeem | реализовано |
| Дефицит строений разрешается однотипным окном и последовательными аукционами | S4 (GSR-043) | `buildingWindow/buildingAuction`, exact request slots; `property.build.*` | окно, остаток, ставка/pass без клиентского победителя | спрос `<`, `=`, `>` остатка, 2/6, несколько лотов/all-pass/exact retry и production DOM flow | реализовано; S4 завершён |
| Сделка проходит propose/accept/decline/cancel с повторной проверкой владения | S5 | offer state, actor/resume actor; `trade.*`; sequential reaction plan | панель сделки и подтверждение | устаревшая собственность/деньги, cancel и atomicity | запланировано |
| Непогашенное обязательство допускает только продажу строений и залог | S5 | obligation/liability state; `obligation.resolve`, liquidity intents; phase plan | панель обязательства и срок | недостаток денег, отсутствие частичного успеха, replay | запланировано |
| Банкротство передаёт активы кредитору или банку и исключает участника | S5 | `state.players` status, ownership/held cards; `bankruptcy.resolve`; transfer plan | экран ликвидации и получателя | оба получателя, заложенный актив, очистка offer/auction | запланировано |
| Последний активный участник становится победителем ровно один раз | S6 | `state.players` bounded record-map, terminal outcome; `game.finish`; active-count plan | итоговый экран, закрытие изменяющих действий | переход 3→2 не завершает, 2→1 завершает; replay и restart | запланировано |
| Локальная партия 2–6 игроков проходит от создания до terminal outcome | S6 | общий game manifest и сохранённая PostgreSQL-сессия; те же intents/plans | полный responsive UI и DOM fallback | начало/середина/поздняя/terminal fixtures + один bounded transcript | запланировано |
| Тексты, карточки, mockups и методический слой подключаются к тем же состояниям | S7 | content provenance + UI bindings; read-only projections и risk confirmations | адаптивное поле, карточки, keyboard/focus, reflection | visual comparison, accessibility и content-rights review | запланировано |
| Сетевая сессия сохраняет actor boundary, персональную проекцию и reconnect | S8 | authenticated participants, WebSocket projection, PostgreSQL version; те же intents | два браузерных контекста и reconnect state | spoofing/privacy, stale version, reconnect/resync | запланировано |
| ИИ получает только проекцию и доступные действия, а не состояние движка | S9 | agent seat/fallback declarations; agent action choice → обычный dispatcher | состояние ИИ и fallback | adversarial mock, invalid choice, bounded retry/fallback, replay | запланировано |
| Каталог публикуется только после принятия содержания, ресурсов и режимов | S10 | immutable game bundle + provenance; release/catalog plan | утверждённое название, описание и preview | production build/E2E, rights and product acceptance | запланировано |

## Заблокировано решениями и внешними воротами

| Правило/ворота | Срез | Состояние / Game Intent / план | UI | Проверка | Статус |
|---|---|---|---|---|---|
| P-01: окончательные публичные названия, тексты, цены и таблицы ренты | S10 | source-of-truth content package ещё не утверждён; техническую готовность S1 это не меняет | публикационный текст и брендинг не утверждаются | PM выбирает оригинальный пакет либо отдельно подтверждённые права | заблокировано: P-01 pending |
| Финальное содержание и публикация в каталоге | S10 | технически завершённый S1 использует оригинальные внутренние данные; финальный content package ещё не принят | production/catalog branding не объявляется готовым | content/provenance gate после P-01 | заблокировано: P-01 pending |
| Сетевая партия | S8 | зависит от ADR-059 participants/join, персональной доставки и reconnect, не меняет game manifest | network UI не активируется | platform task + PostgreSQL/concurrency/browser checks | заблокировано: внешняя платформа |
| ИИ-места | S9 | зависит от participants и actor-scoped availability из ADR-060; отдельную ветку runtime создавать нельзя | AI seat UI не активируется | adversarial projection/fallback checks после S8 prerequisites | заблокировано: внешняя платформа |
| Каталог и полное закрытие | S10 | зависит от P-01, S6/S7, `LEGACY-0072` и `LEGACY-0068`; source of truth не расширяется | каталог не публикуется | milestone H/N/A и product/rights acceptance | заблокировано: зависимости |

Таким образом, ни одно существенное правило S1–S10 не остаётся без среза,
состояния/намерения, UI, проверки и статуса; `запланировано` не означает
фактическую реализацию.
