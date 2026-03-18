# Черновик: последовательности Router (MVP)

## Сценарий: старт игры
1. Клиент вызывает `POST /submit` с `action=StartGame`.
2. Router создаёт сессию (или использует существующую) и возвращает `state`.

## Сценарий: действие игрока
1. Клиент вызывает `POST /submit` с `action=<...>` и `payload`.
2. Router проверяет сессию/версию/лимиты.
3. Router вызывает Engine (`POST /evaluate`) и получает патч состояния.
4. Router возвращает клиенту `mergePatch` (RFC 7396) или `jsonPatch` (RFC 6902).

