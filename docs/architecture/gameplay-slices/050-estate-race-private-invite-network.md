# GSR-050: Estate Race — private invite network v1

- **Дата:** 2026-08-23
- **Статус:** Реализация существует; финальная production two-browser E2E и primary visual acceptance ожидаются
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

## Общая граница

Синхронизация выполняется через аутентифицированный SSE, передающий только
`{stateVersion,lastEventSequence}`; затем клиент делает аутентифицированный
полный GET/resync. Команды остаются HTTP-командами с проверками версии и
идемпотентности. Игровой manifest и механика Estate Race не изменены, а
общий runtime/player слой остаётся game-neutral.
Один principal удерживает не более одного потока на сессию с заменой прежнего;
общий предел 128 возвращает канонический HTTP 429.

## Приёмка

Нейтральные runtime/contracts/player проверки зелёные; полный runtime result —
395 pass / 2 skipped / 0 fail, contracts-session — 16/16, player-web —
332/332, typechecks и API contract gate — green, disposable PostgreSQL restart
proof — 1/1. Production two-browser E2E и primary visual acceptance ещё
не выполнены и являются единственным финальным gate network-части этого среза.
Каталог и public release — отдельный product stream с собственными gates прав,
баланса, продуктовой приёмки и технического долга.

## Упрощение и исключения

В v1 намеренно нет invite lifecycle (one-time redemption, TTL, revoke, rotate),
новой invite table, WebSocket, public rooms, presence, matchmaking,
spectators, network+agent mixing или game-specific shared branch. Эти
исключения не расширяют ADR-059 и не означают готовность публичного каталога.
