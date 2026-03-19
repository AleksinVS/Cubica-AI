# Contracts Packages

Каталог `packages/contracts/` содержит машинно-читаемые контракты, которые должны стать общим источником истины для:

- `services/runtime-api`
- будущих backend-модулей и сервисов
- SDK
- viewers / players
- AI orchestration layer

Структура:

- `manifest/` — manifest bundle, metadata, content contracts
- `session/` — session lifecycle, commands, query DTO, events
- `runtime/` — state delta, action result, effects, runtime envelopes
- `ai/` — AI task/result contracts, eval/replay contracts

На ближайшей фазе это каркас. Следующий шаг — начать переносить в него реальные DTO из `services/runtime-api`.
