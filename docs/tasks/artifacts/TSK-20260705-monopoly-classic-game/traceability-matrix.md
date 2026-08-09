# Матрица трассировки Estate Race (S0)

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
| Поле содержит 40 оригинальных клеток с типом, индексом, группой и ценовыми шкалами; пакет принимает 2–6 участников | S1 (GSR-037, фундамент) | `boardCells`, `config.players`, board size/reward; authoring → manifest | полное поле, типы клеток и проекция до шести произвольных participant id | manifest authoring, 40 уникальных индексов/10 типов, границы 2/6, plugin projection | реализовано как фундамент; landing-сценарии ниже ещё открыты |

## Запланировано после S0

| Правило | Срез | Состояние / Game Intent / план | UI | Проверка | Статус |
|---|---|---|---|---|---|
| Старт, налоги, нейтральные клетки, посещение/отправка в тюрьму проходят через dispatcher | S1 | `turn.phase`, `players.*.metrics`; `turn.roll` → landing plans; только активированные типы | landing panel и next action | positive/negative fixtures по каждому активированному типу | запланировано |
| Порядок 2–6 участников выбирается сервером один раз и используется дальше | S1 | `state.players`, `turn.order`; `session.start`; bounded actor plan | список участников и порядок хода | фикстуры 2 и 6 участников, replay порядка | запланировано |
| Дубли, повтор хода, третий дубль и прохождение старта имеют точные переходы | S1 | `turn.phase`, position/cash; `turn.roll` и `turn.next`; landing plan | объяснение результата и следующего действия | boundary fixtures для 0/1/2/3 дублей и старта | запланировано |
| Отказ от покупки создаёт обязательный последовательный аукцион | S2 | auction state, `activePlayerId` + `resumePlayerId`; `property.auction.*`; общий actor plan | панель ставки, pass и завершения | bid/pass, чужой ход, сумма/баланс, победитель и retry | запланировано |
| Рента различается для групп, станций и коммунальных объектов | S2 | owner/group/type metrics; `property.pay-rent`; formula plan | карточка собственности и объяснение формулы | neutral fixtures всех типов и отрицательный баланс | запланировано |
| Две скрытые колоды дают оригинальный эффект, discard и повторное перемешивание | S3 | deck/discard state; `deck.draw/resolve`; bounded deck plan | карточка и журнал эффекта | replay recorded randomness, exhaustion и reshuffle | запланировано |
| Удерживаемая карта выхода извлекается и возвращается в колоду | S3 | `held` card; `deck.extract/return`; accepted deck operations | панель удерживаемой карты | три цикла draw/hold/return, закрытый порядок игроку и ИИ | запланировано |
| Тюрьма имеет оплату, дубль и предел попыток выхода | S3 | jail phase/attempts; `jail.pay`, `turn.roll`, `turn.next`; jail chain | состояние тюрьмы и доступные способы выхода | все три ветви и правильная terminal phase | запланировано |
| Строительство/продажа равномерны и ограничены запасом банка 32/12 | S4 | improvement inventory, group/building metrics; `property.build/sell`; bounded inventory plan | панель застройки и доступные действия | дефицит, равномерность, атомарный отказ, 32/12 fixture | запланировано |
| Отель заменяет четыре дома, обратный разбор и продажа используют согласованную долю | S4 | building level/inventory; `property.build/sell`; transition plan | ступень ренты и подтверждение продажи | все уровни туда/обратно и точные суммы | запланировано |
| Залог запрещён улучшенной группе; заложенный объект исключается из ренты | S4 | mortgage state; `property.mortgage/redeem`, `property.pay-rent`; invariant plan | панель залога/выкупа | positive/negative mortgage fixtures и рента | запланировано |
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
| P-01: окончательные публичные названия, тексты, цены и таблицы ренты | S0 → S1/S3/S7/S10 | source-of-truth content package ещё не утверждён; менять schema/runtime нельзя | публикационный текст и брендинг не утверждаются | PM выбирает оригинальный пакет либо отдельно подтверждённые права | заблокировано: P-01 pending |
| Нормативная публикация S1 и случайный playthrough до S2/S3 | S1 | оригинальные данные допустимы только во внутреннем непубликуемом срезе; `session.start/turn.*` | production/catalog UI не объявляется готовым | content/provenance gate после P-01 | заблокировано: P-01 pending |
| Сетевая партия | S8 | зависит от ADR-059 participants/join, персональной доставки и reconnect, не меняет game manifest | network UI не активируется | platform task + PostgreSQL/concurrency/browser checks | заблокировано: внешняя платформа |
| ИИ-места | S9 | зависит от participants и actor-scoped availability из ADR-060; отдельную ветку runtime создавать нельзя | AI seat UI не активируется | adversarial projection/fallback checks после S8 prerequisites | заблокировано: внешняя платформа |
| Каталог и полное закрытие | S10 | зависит от P-01, S6/S7, `LEGACY-0072` и `LEGACY-0068`; source of truth не расширяется | каталог не публикуется | milestone H/N/A и product/rights acceptance | заблокировано: зависимости |

Таким образом, ни одно существенное правило S1–S10 не остаётся без среза,
состояния/намерения, UI, проверки и статуса; `запланировано` не означает
фактическую реализацию.
