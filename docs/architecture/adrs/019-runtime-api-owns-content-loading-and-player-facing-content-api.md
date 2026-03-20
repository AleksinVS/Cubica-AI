# ADR-019: Runtime API владеет загрузкой игрового контента и player-facing content API

- **Дата**: 2026-03-21
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `services/runtime-api`, `apps/player-web`, `packages/contracts/*`, content pipeline

## Контекст

После ADR-017 и ADR-018 у Cubica уже есть рабочий канонический slice:

- `games/antarctica/game.manifest.json` остаётся source of truth для исполнимой логики;
- `games/antarctica/design/mockups/` остаётся source of truth для UI intent;
- `services/runtime-api` уже умеет загружать manifest bundle для runtime;
- `apps/player-web` уже является каноническим web delivery layer.

Однако фактическая граница между content layer и player delivery layer пока остаётся неустойчивой:

- `apps/player-web/src/lib/antarctica.ts` напрямую читает `games/antarctica/game.manifest.json` и `games/antarctica/design/mockups/*.design.json` через filesystem;
- `services/runtime-api` одновременно содержит player-facing HTTP transport и content loading, но отдаёт наружу только session/action API;
- из-за этого player-web зависит от layout репозитория и от локального доступа к `games/*`, а не от стабильного backend-контракта.

Это создаёт несколько проблем:

- канонический player привязывается к monorepo filesystem вместо player-facing API;
- deployment boundary между `player-web` и `runtime-api` остаётся размытой;
- content projection для игрока начинает жить в приложении-доставщике, а не рядом с каноническим content/runtime boundary;
- будущее выделение `content`-модуля или отдельного content service усложняется, потому что часть content responsibility уже утекла в frontend.

## Решение

Принять следующие правила для ближайшего канонического шага:

Это решение действует сразу как текущее архитектурное правило для canonical slice, даже если кодовая миграция на новый content API ещё не завершена.

1. **`runtime-api` владеет загрузкой игрового контента из `games/*`.**
   - Только backend runtime читает manifest bundle и связанные design artifacts из репозитория или из будущего content storage.
   - `apps/player-web` не должен читать `games/*` напрямую.
2. **`apps/player-web` получает player-facing content только через `runtime-api` API и общий DTO (Data Transfer Object, объект передачи данных) контракт.**
   - Player-facing DTO должен содержать только те поля манифеста и design metadata, которые нужны player experience.
   - DTO не обязан быть полным зеркалом `game.manifest.json`.
3. **Внутри `runtime-api` ответственность должна быть разделена так:**
   - `content`-модуль загружает, валидирует и проецирует content bundle;
   - `player-api`-модуль остаётся transport layer и вызывает `content` через явную query/service boundary.
4. **Player-facing content API становится каноническим способом получения контента для `player-web`.**
   - Session/action API остаётся отдельной boundary.
   - Content API и session API могут жить в одном deployable `runtime-api`, пока это соответствует ADR-017.

## Альтернативы

- **Оставить прямое чтение файлов в `player-web`** — проще в коротком цикле, но ломает backend ownership и делает player зависимым от структуры монорепозитория.
- **Перенести content API сразу в отдельный сервис** — соответствует будущей декомпозиции, но преждевременен для текущей фазы модульного монолита.
- **Отдавать весь manifest как есть** — уменьшает объём backend-работы, но размывает player-facing контракт и тащит в клиент лишние runtime/content details.

## Последствия

Положительные:

- `runtime-api` становится единственной канонической точкой загрузки игрового контента для runtime и player;
- `player-web` получает стабильную backend boundary вместо зависимости от repo filesystem;
- проще вводить кэширование, versioning и future extraction для `content`-модуля;
- контракты player-facing content становятся явными и тестируемыми.

Trade-offs:

- понадобится новый player-facing DTO и HTTP endpoint;
- часть текущей логики разбора manifest/design metadata должна переехать из `player-web` в `runtime-api`;
- до завершения миграции некоторое время будут сосуществовать старый filesystem path и новый content API, но новым каноническим направлением считается только API path.

## Near-Term Implementation Direction

1. Добавить в contracts layer player-facing content DTO для `Antarctica`.
2. В `runtime-api` выделить query/service boundary, которая:
   - загружает manifest bundle;
   - читает нужные design metadata;
   - собирает player-facing content DTO.
3. Добавить player-facing endpoint в `player-api`, например `GET /games/:gameId/content` или эквивалентный route с тем же смыслом.
4. Перевести `apps/player-web` на consumption этого endpoint через собственные route handlers/proxy и убрать прямое чтение repo files.
5. После миграции считать direct filesystem access из `player-web` архитектурным нарушением.

## Связанные артефакты

- `docs/architecture/adrs/017-modular-monolith-transition-and-service-extraction.md`
- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
- `NEXT_STEPS.md`
- `services/runtime-api/HANDOFF.md`
- `apps/player-web/src/lib/antarctica.ts`
- `services/runtime-api/src/modules/content/manifestLoader.ts`
- `services/runtime-api/src/modules/player-api/httpServer.ts`
