# ADR-039: Player-web Plugin Bundle Handoff

- **Дата**: 2026-05-29
- **Актуализировано**: 2026-07-13
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Editor Web, Player Web, Runtime API, Game Projects, Plugin Validation
- **Связанные решения**: ADR-019, ADR-026, ADR-036, ADR-037

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Production Published Handoff](#5-production-published-handoff)
- [6. Best Practices Used](#6-best-practices-used)
- [7. Альтернативы](#7-альтернативы)
- [8. Последствия](#8-последствия)
- [9. Связанные артефакты](#9-связанные-артефакты)

## 1. Понимание решения

Решение понято так: ADR-037 уже определил, что пользовательские плагины должны
жить в `games/<gameId>/plugins/<pluginId>/`. Поддерживаемая граница допускает
только доверенные project-local `player-web` плагины без npm-зависимостей и
должна явно определять безопасную передачу browser bundle для preview и
production.

Этот ADR фиксирует две границы:

1. Local preview: `editor-web` собирает session-scoped browser bundle для `player-web`, `runtime-api` регистрирует ссылку на него внутри существующей `contentSourceId` границы, а `player-web` загружает такой bundle только в editor preview mode.
2. Production/published: publish pipeline выпускает неизменяемый bundle с content hash, кладет ссылку на него в published content metadata, а `runtime-api` отдает эту ссылку в обычном `PlayerFacingContent` без `contentSourceId`. Production player загружает только published bundle references, а не editor worktree и не project source files.

## 2. Контекст

Статический импорт project-local плагина из платформенного приложения не
соответствует целевой модели ADR-037:

- session worktree находится под `.tmp/editor-worktrees/<sessionId>/`, а не в исходниках `apps/player-web`;
- `contentSourceId` передаёт generated manifests через Runtime API, но не
  исполняемый клиентский код;
- статический импорт из `apps/player-web` не увидит изменения plugin source внутри session worktree и привязывает платформенный код к конкретной игре;
- копирование session plugin source в `apps/player-web/src` нарушило бы session boundary и рисковало бы попасть в production build;
- runtime-api не должен исполнять `player-web` plugin code, потому что first-class backend plugins требуют отдельного ADR.

Context7 по Node.js подтверждает ограничение для validation commands: shell-based `exec()` обрабатывает строку через shell и не должен получать непроверенный ввод. Поэтому plugin validation должна использовать direct process APIs (`execFile` или `spawn`) с явным argv, timeout и `AbortSignal`.

Context7 по Next.js подтверждает, что Next dev умеет hot reload для отслеживаемых модулей, поддерживает client-side dynamic import, а production static assets should use hashed immutable files when long-lived caching is desired. Произвольный TypeScript из внешнего session worktree не становится браузерным client bundle сам по себе. Значит, нужен явный bundle handoff contract.

## 3. Термины

- **Plugin bundle** - собранный браузерный JavaScript-модуль плагина, который можно загрузить в `player-web` через `import()` без доступа к исходным `.ts` файлам.
- **Bundle handoff** - передача ссылки на plugin bundle от editor/session pipeline к `player-web` через уже существующую preview/content boundary.
- **Hot preview reload** - обновление iframe предпросмотра после изменения plugin source без перезапуска dev-сервера `player-web`.
- **Player plugin API facade** - маленький стабильный объект API, который `player-web` передает bundle при активации, чтобы плагин регистрировал только разрешенные contribution points и не импортировал внутренние app modules.
- **Published bundle** - неизменяемый bundle, созданный publish pipeline для конкретной версии игры. Такой файл имеет SHA-256 hash in filename/reference and may be cached as immutable.
- **Published content metadata** - generated metadata рядом с опубликованными manifest assets. It lists plugin bundle references that `runtime-api` may expose to production players.

## 4. Решение

Предлагается принять следующую модель.

1. `plugin.json` остается декларативным source of truth для плагина и указывает `targets.player-web.entry`.
2. При editor validation/preview `editor-web` собирает touched `player-web` plugin entry из session worktree в browser ESM bundle под `.tmp/editor-plugin-bundles/<gameId>/<pluginId>/<contentHash>.mjs`.
3. Bundle entry не импортируется статически из `apps/player-web`. Он экспортирует функцию `activate(api)`, где `api` - `Player plugin API facade` от `player-web`.
4. `api` предоставляет только стабильные contribution points, например регистрацию `gameConfigFactory`, generic action adapter helpers и разрешенные preview metadata helpers. Плагин не должен импортировать `@/components`, `@/presenter` или другие private modules `apps/player-web`.
5. `runtime-api` при `/content/reload` продолжает регистрировать generated content root по `contentSourceId`, но может дополнительно хранить session plugin bundle references. Это не делает `runtime-api` plugin target: сервис только передает metadata/URLs и не исполняет plugin code.
6. `player-web` загружает session plugin bundles только когда URL содержит `preview=1` и `contentSourceId`. Production player без preview mode использует только published bundle references или default manifest-driven path.
7. Hot reload выполняется через content hash:
   - editor validation/build пересобирает bundle и вычисляет hash;
   - runtime-api exposes a bundle reference with `contentHash`;
   - `player-web` invalidates dynamic import by URL with hash query and remounts the game config.
8. npm dependencies в project-local plugins остаются запрещенными. Bundle builder должен разрешать только platform-provided API facade and plugin-local relative imports.
9. Игра без плагинов продолжает использовать default manifest-driven path.
10. Project-local plugin подключается через session/published bundle handoff без
    статической регистрации конкретной игры в `apps/player-web`.

## 5. Production Published Handoff

Production handoff uses the same browser activation shape as preview: the bundle exports `activate(api)`, and `player-web` calls it with `PlayerPluginApi`. The difference is the source of the bundle reference.

Normative flow:

```text
Publish game version
  -> validate plugin.json through JSON Schema
  -> run allowlisted validation scripts through spawn/execFile, no shell strings
  -> build browser ESM bundle
  -> compute SHA-256 contentHash and integrity metadata
  -> write immutable bundle artifact
  -> write published content metadata
  -> runtime-api exposes bundle references in PlayerFacingContent
  -> player-web validates apiVersion/scope and imports bundle by hash URL
  -> activate(api) registers config/resolvers
```

Published metadata is generated, not hand-written runtime manifest data. Минимальная форма контракта:

```json
{
  "schemaVersion": "1.0",
  "bundles": [
    {
      "pluginId": "example-player",
      "gameId": "example-game",
      "apiVersion": "2.0",
      "target": "player-web",
      "scope": "published",
      "contentHash": "64-char-sha256-hex",
      "integrity": "sha256-base64-digest",
      "filePath": "published/example-player.64-char-sha256-hex.mjs",
      "url": "/published-plugin-bundles/example-game/example-player/64-char-sha256-hex.mjs"
    }
  ]
}
```

Архитектурные ограничения:

1. Runtime API может отдавать published bundles непосредственно; CDN или
   object storage допустимы при сохранении неизменяемых URL и того же metadata
   contract.
2. Bundle URLs must be content-addressed: the hash in metadata and filename identifies the exact bytes. Existing bundle bytes are never overwritten.
3. `runtime-api` must verify that a published bundle file path stays inside the published artifact root and that the served bytes match `contentHash`.
4. Published bundle responses используют долгоживущее неизменяемое
   кэширование; metadata со ссылками перепроверяется вместе с игровым контентом.
5. `player-web` must not import project source files for production plugins. It should use one loader for preview and published bundles, with explicit scope checks.
6. `PlayerWebPluginBundleReference` has an explicit `scope: "preview" | "published"`. Preview references are `scope: "preview"`; published references are `scope: "published"`.
7. Supported API versions are exact and explicit: принята версия
   `apiVersion: "2.0"`. Unsupported versions fail validation before publish and
   fail closed in the browser if somehow delivered.
8. npm dependencies remain forbidden for project-local plugins until verified dependency policy exists. The published bundle builder may include only relative plugin files and platform-provided facade imports.
9. A static registry of concrete games is not an accepted production fallback.

## 6. Best Practices Used

The decision is based on the following practices:

- Content-hashed JavaScript files should be treated as immutable assets. Next.js documentation describes hashed static assets as suitable for long `max-age` plus `immutable`, while files from `public` default to `max-age=0`; therefore published plugin bundles should be generated artifacts with hash URLs, not mutable public filenames.
- Browser `import()` is asynchronous and supports module URLs; this matches the current runtime loader shape.
- Subresource Integrity is useful for script/link/modulepreload tags, but dynamic `import()` does not give us a widely portable per-call integrity option. Therefore the baseline security check is content-addressed publishing plus server-side hash verification; optional modulepreload/import-map integrity can be added later.
- Node.js command execution for validation/publish must avoid shell command strings. Use `spawn` or `execFile` with argv arrays, timeout and `AbortSignal`.
- The browser should receive a narrow capability object (`PlayerPluginApi`), not imports into private `player-web` modules.

References:

- Next.js static asset and CDN behavior: `assetPrefix`, hashed static assets and `public` folder cache policy.
- Node.js `child_process.spawn`/`execFile` documentation for direct process execution and abort support.
- MDN `import()` and `Cache-Control` documentation for dynamic module loading and immutable caching.
- MDN Subresource Integrity documentation for what SRI covers.

## 7. Альтернативы

### A. Статически импортировать `games/<gameId>/plugins/*` из `player-web`

Отклоняется. Это не видит изменения кода в session worktree, требует game-specific imports в platform app source и не отделяет editor worktree code от production player.

### B. Копировать session plugin source в `apps/player-web/src`

Отклоняется. Это нарушает `contentSourceId` session boundary, создает риск попадания временного кода в production build и смешивает project-local plugin code с platform source.

### C. Исполнять plugin code внутри `runtime-api`

Отклоняется для ADR-037. Backend plugin execution влияет на authoritative game logic и требует отдельного sandbox/permissions/observability ADR.

### D. Использовать только `plugin.json` без исполняемого bundle

Отклоняется как полный ответ на ADR-037. Такой вариант полезен для декларативных contribution points, но не покрывает требование “plugin code changes refresh preview”.

### E. Записывать production bundle URL прямо в `game.manifest.json`

Отклоняется для целевой границы. Runtime game manifest описывает игру, а
published artifact metadata — результат сборки. Это разделение не смешивает
authoring/runtime semantics с конкретным CDN или file layout.

### F. Использовать Module Federation как основной механизм

Отклоняется для текущего этапа. Module Federation полезен для микрофронтендов, но добавляет runtime negotiation, shared dependency policy and bundler coupling. Cubica first needs one verified ESM artifact with a small API facade.

## 8. Последствия

Положительные:

- hot preview reload получает явную границу и не зависит от приватной Next.js module graph магии;
- production player не загружает editor worktree code;
- `runtime-api` остается owner content-source boundary и не исполняет frontend plugin code;
- future marketplace path получает проверяемый артефакт: browser bundle plus manifest, hash and permissions;
- production publish получает cache-friendly immutable artifacts and can later move the same URLs behind a CDN.

Стоимость и риски:

- нужен platform-owned plugin bundle builder;
- нужен стабильный `Player plugin API facade`, чтобы плагины не импортировали private app modules;
- published metadata and artifact storage add one more generated artifact class;
- `apiVersion` policy becomes a publish blocker instead of an informal field;
- optional CDN delivery requires origin allowlist, immutable URL discipline and cache invalidation only for metadata, not bundle files.

## 9. Связанные артефакты

- `docs/architecture/adrs/037-project-local-plugins-and-marketplace-safe-evolution.md`
- `docs/architecture/adrs/036-semantic-authoring-and-preview-timeline-editor.md`
