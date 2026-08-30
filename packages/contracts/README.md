# Contracts Packages

Каталог `packages/contracts/` содержит машинно-читаемые контракты, которые должны стать общим источником истины для:

- `services/runtime-api`
- будущих backend-модулей и сервисов
- SDK
- viewers / players
- AI orchestration layer

Структура:

- `manifest/` — manifest bundle, metadata, content contracts
- `session/` — session lifecycle, commands, query DTO, protected events and the
  schema-generated portable public journal contract
- `runtime/` — state delta, action result, effects, runtime envelopes
- `ai/` — AI task/result contracts, eval/replay contracts

Пакеты уже используются реальными runtime/player потребителями. JSON Schema
остаётся источником истины для schema-backed поверхностей; оставшиеся старые
session/runtime-типы переводятся на этот контур отдельными ограниченными срезами.
