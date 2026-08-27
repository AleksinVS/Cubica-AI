# GSR-050: Estate Race — закрытая сеть по приглашению S10

- **Дата:** 2026-08-25
- **Статус:** Accepted for closed alpha; not catalog/production ready
- **Предусловие:** GSR-047/S8 и GSR-049/S9 приняты; ADR-059 и гибридная граница S10 приняты PM
- **Архитектура:** ADR-059

## Наблюдаемый результат

Гость Estate Race занимает заранее созданное место по одноразовой ссылке
приглашения. После успешного claim место становится `joined`, а игра
продолжается через тот же PostgreSQL-сеанс и обычные Game Intents.

## Сетевая граница

Приглашение действительно 24 часа и атомарно заменяется durable participant
credential. Credential хранится в session-scoped `HttpOnly; SameSite=Strict`
cookie; URL fragment очищается до первого сетевого вызова. Authenticated SSE
передаёт только версию и номер события, после чего Player Web получает полную
персональную проекцию защищённым HTTP GET. После рестарта SSE-реестр теряется,
но клиент выполняет reconnect и восстанавливает состояние из PostgreSQL.

Узкая поправка к закрыто-альфовой границе S10 добавляет восстановление уже
занятого human guest seat: ведущий private session может выдать ровно одну
новую одноразовую recovery-ссылку на 24 часа через
`POST /sessions/{sessionId}/seat-recovery-invites`. Она заменяет только
ожидающую recovery-возможность и не отзывает действующий credential. Новый
recovery token предъявляется как recovery claim через тот же claim endpoint,
который допускает анонимный вызов; повторный initial-invite claim не нужен.
Успешный recovery claim поворачивает digest credential на том же participant
principal и очищает
recovery-возможность; если в браузере уже есть credential, он служит только
доказательством того же principal. Живой credential другого места или initial
invite отклоняются без потребления token и без замены cookie; уже недействующая
cookie не даёт прав и не мешает новому recovery claim. `principalId`, `seatId`,
`playerId`, роль, actor scope,
участники, game state, `stateVersion`, event cursor, receipts и events не
меняются. Старый SSE-поток закрывается после commit, старый credential
отклоняется, а новый управляет той же идентичностью гостя.

Raw recovery token доступен только при создании, в storage хранится только его
hash и Player Web его не сохраняет; ссылка копируется в том же fragment-формате.
Локальная подсказка ведущего влияет лишь на видимость, а авторизация остаётся
за runtime. Recovery и initial claim используют существующий claim endpoint,
который допускает анонимный вызов. Для обоих claim-потоков неверный,
истёкший, повторно использованный, заменённый или проигравший конкурентную
гонку token, а также claim-lock, возвращают `401`; `423` возвращается только
authenticated endpoint выдачи recovery `POST /sessions/{sessionId}/seat-recovery-invites`.
Восстановление ограничено уже joined human guest seat:
seat ведущего, invited/local/agent seats, rooms, accounts и прочие области не
входят; обычная reissue ещё не занятого initial invite также исключена.

## Приёмка

- PostgreSQL restart и concurrent single-winner/replay сценарии проходят.
- Estate Race two-browser flow проходит; чужое место и устаревшая версия
  отклоняются управляемо.
- Реализация принята для закрытой альфы. Recovery increment дополнительно
  подтверждён contracts generator `--check`, schema parity и
  `verify:api-contracts` — PASS; contracts-session `16/16` + typecheck. До
  финальной защиты гонки SSE runtime focused `53/53` + typecheck и full runtime
  `411 pass / 3 skip / 0 fail` (`414`) прошли; после неё свежие session event
  hub `8/8` и private invite/recovery `6/6` прошли.
  Player focused `81/81` + typecheck, full Player `342/342`; Estate package —
  `53/53`, plugin — `37/37` + typecheck, disposable PostgreSQL 17 — `2/2`,
  production player build — PASS. Финальное recovery доказательство также
  включает Playwright Estate private network `1/1` PASS (с явным loopback
  insecure-cookie flag). Исторические результаты
  S10 от 2026-08-25 включают two-browser E2E с desktop+narrow primary visual
  inspection, runtime — `403 pass / 3 skip`, Player Web — `328/328` с typecheck
  и production build, Estate Race — `53/53`, plugin — `37/37` с typecheck,
  disposable PostgreSQL integration — `2/2`; обновлённые recovery E2E/build/visual
  проверки приняты.

## Ограничения и долг

Потеря ответа после успешного claim теперь покрыта этим bounded recoverable
handoff и не требует пересоздания сессии или повторного initial-invite claim:
ведущий выдаёт новую recovery-ссылку, которую нужно предъявить через тот же
claim endpoint. Операционный residual: браузерная cookie живёт
30 дней, тогда как participant credential в runtime durable; срок и порядок
архивирования должны быть согласованы перед production.

Каталог, content/economy/product publication и production readiness не входят
в принятие закрытой альфы. WebSocket, presence, дельты, Redis, public rooms,
matchmaking, spectators и обычная revoke/reissue не входят в этот срез.
