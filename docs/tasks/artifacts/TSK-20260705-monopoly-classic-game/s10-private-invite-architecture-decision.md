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
matchmaking, spectators, public rooms, multi-use invites, revoke/reissue и
вторая runtime-реплика не входят в S10. Это не утверждение, что эти функции
никогда не понадобятся; их можно открыть только отдельным продуктовым и
архитектурным решением после измеримой потребности.

## Доказательства и оставшиеся ворота

Канонические OpenAPI/generated session contracts и constituent gates проходят:
runtime — `403 pass / 3 skip`, Player Web — `328/328` + typecheck и production
build, Estate Race package — `53/53`, plugin — `37/37` + typecheck, disposable
PostgreSQL integration — `2/2`. Player Web интеграция, PostgreSQL restart и
Estate Race two-browser E2E с desktop+narrow primary visual inspection
реализованы и проверены; S10 принят для закрытой альфы.

Если claim уже записан, но ответ с credential потерян, закрытая альфа требует
пересоздать тестовый сеанс ведущим. Recoverable handoff обязателен до
каталога/production. Catalog/content/economy/product publication и production
readiness остаются отдельными воротами. Cookie браузера живёт 30 дней, тогда
как credential runtime durable; это операционный residual до согласования
архивирования.

Подробное сравнение исходного пакета и упрощённого гибрида находится в
[`s10-parallel-implementation-review.md`](s10-parallel-implementation-review.md).
