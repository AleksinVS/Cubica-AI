# Руководство по разработке: Runtime API

## Назначение
- Единый deployable backend для ближайшей фазы Cubica.
- Объединяет player-facing API, управление сессиями, runtime исполнения, доступ к контенту, AI-capabilities и telemetry.
- Является реализацией ADR-017: модульный монолит вместо преждевременной сервисной декомпозиции.

## Внутренняя модульная структура
- `player-api/` — внешние endpoints для клиентов.
- `session/` — lifecycle, locking, sequencing, recovery.
- `runtime/` — action dispatch, deterministic transitions, script execution.
- `content/` — загрузка и валидация manifest bundle.
- `ai/` — prompt building, model calls, normalization, eval hooks.
- `telemetry/` — logs, traces, metrics, audit trail.
- `admin/` — health, readiness, inspect/replay, internal ops endpoints.

## Принципы
- Один deployable backend, но строгие внутренние границы между модулями.
- Межмодульное взаимодействие только через публичные интерфейсы, команды, query и доменные события.
- Прямой импорт внутренних деталей соседнего модуля запрещён.
- DTO и event contracts должны выноситься в общий contracts layer по мере стабилизации.

## Объем ближайшей фазы
- Один рабочий vertical slice для `games/antarctica`.
- HTTP API для `createSession`, `getSessionState`, `dispatchAction`.
- In-memory или file-backed session store для MVP.
- Загрузка content bundle напрямую из `games/`.
- AI слой как optional capability, а не обязательный центр runtime.

## Следующие шаги
1. Создать базовый HTTP bootstrap и health endpoints.
2. Перенести router/session contracts в модули `player-api` и `session`.
3. Собрать deterministic runtime path для одной игры.
4. Добавить integration tests через публичный API.
