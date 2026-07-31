# ADR-019: Runtime API владеет загрузкой игрового контента и player-facing content API

- **Дата**: 2026-03-21
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `services/runtime-api`, `apps/player-web`, `packages/contracts/*`, content pipeline

## Оглавление

- [Контекст](#контекст)
- [Решение](#решение)
- [Альтернативы](#альтернативы)
- [Последствия](#последствия)
- [Связанные артефакты](#связанные-артефакты)

## Контекст

После ADR-017 и ADR-018 runtime backend является владельцем исполнимого
контента, а клиентское приложение — каналом доставки. Если клиент читает игровые
пакеты или дизайн-артефакты напрямую из файловой системы, он начинает зависеть
от структуры репозитория и формата внутреннего content bundle вместо стабильного
player-facing API.

Это создаёт несколько проблем:

- канонический player привязывается к monorepo filesystem вместо player-facing API;
- deployment boundary между `player-web` и `runtime-api` остаётся размытой;
- content projection для игрока начинает жить в приложении-доставщике, а не рядом с каноническим content/runtime boundary;
- будущее выделение `content`-модуля или отдельного content service усложняется, потому что часть content responsibility уже утекла в frontend.

## Решение

Принять следующие правила:

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

- требуется отдельный player-facing DTO и content endpoint;
- проекция manifest/design metadata становится ответственностью backend и
  увеличивает объём его публичного контракта.

## Связанные артефакты

- `docs/architecture/adrs/017-modular-monolith-transition-and-service-extraction.md`
- `docs/architecture/adrs/018-game-logic-source-of-truth-is-json-manifest.md`
- `docs/architecture/PROJECT_ARCHITECTURE.md`
