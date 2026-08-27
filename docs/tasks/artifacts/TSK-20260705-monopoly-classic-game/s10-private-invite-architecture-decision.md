# S10: исходный пакет решения для закрытой сетевой партии

Статус: исходный пакет принят PM 2026-08-24, затем superseded (заменён) решением
PM 2026-08-25. Он сохранён как история рассмотренного варианта; действующая
граница описана в ADR-059 и `s10-parallel-implementation-review.md`.

## Исторически принятый пакет

Пакет фиксировал модульный монолит `runtime-api`, PostgreSQL как источник
истины, session-owned participants, персональную проекцию и одноразовое
24-часовое приглашение. В нём также рассматривался отдельный двунаправленный
транспорт с временным ticket. После сравнительного аудита PM отказался от этой
части как от лишнего протокола для пошаговой игры, где команды уже идут по
HTTP.

## Действующая гибридная граница S10

- Для каждого гостевого места runtime выдаёт одноразовый invite на 24 часа.
  В durable storage хранится только hash (SHA-256 digest); ссылка содержит во
  fragment только `sessionId` и `inviteToken`, а Player Web синхронно очищает
  fragment до первого сетевого вызова.
- Одна транзакция атомарно проверяет срок и digest, заменяет invite digest на
  digest нового participant credential и меняет только `joinState`:
  `invited → joined`. Повтор, гонка или истёкший invite не выдают credential.
- Credential передаётся только в session-scoped
  `HttpOnly; SameSite=Strict` cookie Player Web. JavaScript, URL и SSE payload
  его не получают. `joinState` имеет значения `local|invited|joined`; local
  hot-seat остаётся режимом по умолчанию.
- Аутентифицированный SSE endpoint передаёт только
  `{stateVersion,lastEventSequence}`. После первого события, каждого события и
  реконнекта клиент делает полный аутентифицированный GET персональной
  проекции. Игровые команды остаются в HTTP.
- Используется один runtime instance и in-memory реестр SSE-подписок; при
  рестарте клиент реконнектится и повторно получает полный снимок из PostgreSQL.

## Явные нецели

WebSocket, realtime-ticket cache, presence, rooms, Redis, дельты, чат,
matchmaking, spectators, public rooms, multi-use invites, обычная revoke/reissue и
вторая runtime-реплика не входят в S10. Это не утверждение, что эти функции
никогда не понадобятся; их можно открыть только отдельным продуктовым и
архитектурным решением после измеримой потребности.

## Доказательства и оставшиеся ворота

Итоговые проверки recovery increment: contracts generator `--check`, schema
parity и `verify:api-contracts` — PASS; contracts-session typecheck и `16/16` —
PASS; runtime typecheck — PASS. До финальной защиты гонки SSE focused
recovery/PostgreSQL/SSE — `53/53` и полный runtime — `411 pass / 3 skip / 0
fail` (`414`) прошли; после неё свежие session event hub `8/8` и private
invite/recovery `6/6` прошли. Player typecheck — PASS,
focused Player Web — `81/81`, полный Player Web — `342/342`; Estate package —
`53/53`; plugin — `37/37` и typecheck — PASS; disposable PostgreSQL 17
migrations/restart — `2/2`; production player build — PASS; production
Playwright Estate private network — `1/1` PASS с явным loopback insecure-cookie
flag. Исторические S10 two-browser E2E и visual inspection от 2026-08-25
сохранены отдельно.

Позднейшая узкая поправка S10 завершила этот bounded handoff: ведущий может
выдать одну 24-часовую одноразовую recovery-ссылку для уже joined human guest
seat. Она заменяет только pending recovery capability, не отзывает текущий
credential, а успешный claim поворачивает digest на том же principal и очищает
capability. Поэтому потеря ответа после успешного claim больше не требует
пересоздания сессии. Catalog/content/economy/product publication и production
readiness остаются отдельными воротами. Cookie браузера живёт 30 дней, тогда
как credential runtime durable; это операционный residual до согласования
архивирования.

Подробное сравнение исходного пакета и упрощённого гибрида находится в
[`s10-parallel-implementation-review.md`](s10-parallel-implementation-review.md).
