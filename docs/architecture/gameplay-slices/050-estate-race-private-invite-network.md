# GSR-050: Estate Race — private invite network v1

- **Дата:** 2026-08-27
- **Статус:** Accepted for closed alpha; not catalog/production ready
- **Предусловие:** GSR-047/S8 и GSR-049/S9 приняты локально; архитектурная граница ADR-059 принята
- **Архитектура:** ADR-059

## Оглавление

- [Наблюдаемый результат](#наблюдаемый-результат)
- [Общая граница](#общая-граница)
- [Приёмка](#приёмка)
- [Упрощение и исключения](#упрощение-и-исключения)

## Наблюдаемый результат

Estate Race получает optional `accessMode`: `local` (по умолчанию) или
`private-invite`. Участники принадлежат сессии и неизменяемы после создания.
Хост получает credential первого места, а для остальных человеческих мест
создание сессии выдаёт invite links. Секреты хранятся на сервере только как
хеши; host browser временно получает guest credentials для построения ссылок и
удаляет их из Presenter при закрытии панели. Guest browser импортирует
credential-only fragment в HttpOnly SameSite cookie и затем очищает fragment;
место и actor выбираются только runtime по аутентифицированному principal.

Для уже joined human guest seat host может выдать одну новую 24-часовую
одноразовую recovery-ссылку. Участник предъявляет свежий recovery token через
тот же claim endpoint; повторный initial-invite claim или пересоздание сессии
не нужны. Если cookie не соответствует живому principal, она является только
анонимным предъявлением capability; credential другого живого principal claim
не допускает.

## Общая граница

Синхронизация выполняется через аутентифицированный SSE, передающий только
`{stateVersion,lastEventSequence}`; затем клиент делает аутентифицированный
полный GET/resync. Команды остаются HTTP-командами с проверками версии и
идемпотентности. Игровой manifest и механика Estate Race не изменены, а
общий runtime/player слой остаётся game-neutral.
Один principal удерживает не более одного потока на сессию с заменой прежнего;
общий предел 128 возвращает канонический HTTP 429.

## Приёмка

Итоговое доказательство recovery increment: contracts generator `--check`,
schema parity и `verify:api-contracts` — PASS; contracts-session typecheck —
PASS и `16/16`; runtime typecheck — PASS, focused recovery/PostgreSQL/SSE —
`53/53`, полный runtime — `411 pass / 3 skip / 0 fail` (`414`); Player
typecheck — PASS, focused Player — `81/81`, полный Player — `342/342`;
Estate package — `53/53`, plugin — `37/37` и typecheck — PASS; disposable
PostgreSQL 17 migrations/restart — `2/2`; production player build — PASS;
production Playwright Estate private network — `1/1` PASS с явным loopback
insecure-cookie flag. Исторические pre-recovery S10 результаты от 2026-08-25
сохранены отдельно. Verify agent instructions, validate legacy и structure
generated — PASS. Каталог и public release — отдельный product stream с
собственными gates прав, баланса, продуктовой приёмки и технического долга.

## Упрощение и исключения

В v1 намеренно нет invite lifecycle (one-time redemption, TTL, revoke, rotate),
новой invite table, WebSocket, public rooms, presence, matchmaking,
spectators, network+agent mixing или game-specific shared branch. Эти
исключения описывают только сохранённый кандидат, расходятся с принятым
пакетом S10 и не означают изменение ADR-059 или готовность публичного каталога.
