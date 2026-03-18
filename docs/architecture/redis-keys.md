# Redis Keys — Repository/Manifest Caching

## Оглавление
- [Назначение](#назначение)
- [Ключи для кэширования манифестов](#ключи-для-кэширования-манифестов)
- [Стратегии инвалидации](#стратегии-инвалидации)
- [Связанные документы](#связанные-документы)

## Назначение

Этот файл описывает **схему ключей Redis для кэширования манифестов игр** в контексте Game Repository. Общая стратегия использования Redis в платформе описана в `docs/architecture/backend/redis-usage.md`.

## Ключи для кэширования манифестов

- `game:{game_id}:version:{version_id}:manifest`
  - Payload: JSON manifest (stringified)
  - TTL: 30 days (immutable content); can be left without TTL if memory allows

- `game:{game_id}:channel:{name}:version`
  - Payload: `{ "versionId": "<content-hash>", "checksum": "<sha256>", "updatedAt": "<rfc3339>" }`
  - TTL: 60s (align with CDN `max-age`); clients rely on SWR and 304

- `manifest:etag:{version_id}`
  - Payload: ETag string for conditional GET acceleration
  - TTL: 30 days

## Стратегии инвалидации

- Versioned manifests: no invalidation needed (keys are immutable).
- Channel pointers: update `channel:{name}:version` atomically after DB transaction; optionally publish a message on a Redis channel `events:channel-updated`.

## Связанные документы

- `docs/architecture/backend/redis-usage.md` — общая стратегия использования Redis (сессии, блокировки).

