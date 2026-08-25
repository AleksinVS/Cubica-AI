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

## Приёмка

- PostgreSQL restart и concurrent single-winner/replay сценарии проходят.
- Estate Race two-browser flow проходит; чужое место и устаревшая версия
  отклоняются управляемо.
- Реализация принята для закрытой альфы. Два браузера прошли E2E с desktop+narrow
  primary visual inspection; runtime — `403 pass / 3 skip`, Player Web —
  `328/328` с typecheck и production build, Estate Race — `53/53`, plugin —
  `37/37` с typecheck, disposable PostgreSQL integration — `2/2`; канонические
  constituent gates пройдены.

## Ограничения и долг

Если claim уже записан, но ответ с credential потерян, закрытая альфа требует
пересоздать тестовый сеанс ведущим. Это bounded debt: до каталога/production
нужен recoverable handoff, позволяющий безопасно восстановить доступ к уже
занятому месту без повторного claim. Операционный residual: браузерная cookie живёт
30 дней, тогда как participant credential в runtime durable; срок и порядок
архивирования должны быть согласованы перед production.

Каталог, content/economy/product publication и production readiness не входят
в принятие закрытой альфы. WebSocket, presence, дельты, Redis, public rooms,
matchmaking, spectators и revoke/reissue не входят в этот срез.
