# Project-Local Plugin Gap Closure Plan

Этот документ описывает, как закрыть разрывы между текущей миграцией `Antarctica` и целевой архитектурой плагинов из ADR-037, ADR-039 и ADR-040.

## Оглавление

- [1. Понимание задачи](#1-понимание-задачи)
- [2. Уже закрыто](#2-уже-закрыто)
- [3. Оставшиеся разрывы](#3-оставшиеся-разрывы)
- [4. Целевой поток](#4-целевой-поток)
- [5. Этапы закрытия](#5-этапы-закрытия)
- [6. Контракты](#6-контракты)
- [7. Проверки и тесты](#7-проверки-и-тесты)
- [8. Правила безопасности](#8-правила-безопасности)
- [9. Отложенные темы](#9-отложенные-темы)
- [10. Готовность к реализации](#10-готовность-к-реализации)
- [11. Итог закрытия](#11-итог-закрытия)

## 1. Понимание задачи

Задача понята так: код player-плагина `Antarctica` уже перенесен в целевой каталог `games/antarctica/plugins/antarctica-player`, но система плагинов еще не стала полноценной. Нужно закрыть оставшиеся архитектурные и исполнительные разрывы так, чтобы:

- `player-web` не знал о конкретных играх через постоянные статические импорты;
- plugin edits проходили проверку до Save;
- preview подхватывал изменения кода плагина из session worktree без перезапуска `player-web`;
- production player не загружал код из editor worktree;
- `runtime-api` не исполнял frontend plugin code и не получал game-specific branches;
- marketplace и runtime plugins оставались будущими, но текущий дизайн им не мешал.

## 2. Уже закрыто

| Область | Фактическое состояние |
| --- | --- |
| Target home | `Antarctica` player plugin живет в `games/antarctica/plugins/antarctica-player`. |
| Old platform plugin | Бывший платформенный каталог плагина удален. |
| Public API facade | `apps/player-web/src/plugins/player-plugin-api.ts` дает плагину узкий публичный API. |
| `plugin.json` schema | `docs/architecture/schemas/plugin.schema.json` добавлена и используется в `verify:manifest-authoring`. |
| Dependency policy | `dependenciesPolicy: "platform-only"` запрещает plugin npm dependencies через manifest-authoring gate. |
| Simple game path | `simple-choice` остается без плагина и проверяет default manifest-driven путь. |
| Runtime purity | `runtime-api` не получил `Antarctica` plugin execution и не импортирует plugin code. |

## 3. Оставшиеся разрывы

| ID | Статус | Разрыв | Что сделано / что осталось |
| --- | --- | --- | --- |
| G1 | Закрыт | Static bridge в `player-web` | `apps/player-web/src/plugins/register-games.ts` удален. Preview идет через session bundle, non-preview режим идет через generated published bundle reference. |
| G2 | Закрыт | Нет discovery | `apps/editor-web/src/lib/project-plugin-validation.ts` ищет `games/<gameId>/plugins/<pluginId>/plugin.json`, валидирует schema, path/id/gameId boundary и оставляет `simple-choice` без плагина. |
| G3 | Закрыт для первого этапа | Validation runner неполный | `plugin.json.validation` сопоставляется с platform-owned allowlist. `typecheck` запускается через `spawn` без shell, с timeout/AbortSignal, stdout/stderr diagnostics. `build`/`test` остаются зарезервированными именами до отдельного runner contract. |
| G4 | Закрыт для local preview | Нет session plugin bundle | `editor-web` собирает browser module в `.tmp/editor-plugin-bundles/...`; `runtime-api` хранит bundle reference внутри `contentSourceId`; `player-web` получает reference через `PlayerFacingContent.pluginBundles`. |
| G5 | Закрыт для local preview | Нет hot preview reload кода plugin | Bundle content hash меняется при изменении plugin source. `player-web` загружает preview bundle с hash query и пересобирает config после `activate(api)` без перезапуска dev server. |
| G6 | Закрыт | Production boundary не оформлен кодом | Publish builder creates immutable published bundle artifacts and metadata. Runtime-api exposes them through `PlayerFacingContent.pluginBundles`; player-web loads only `scope: "published"` outside preview. |
| G7 | Закрыт | `apiVersion` не проверяется | First production policy is exact `apiVersion: "1.0"`; published metadata schema and player-web loader both enforce it. |
| G8 | Закрыт | Diagnostics не попадают в journal | Preview/compile/save получают plugin diagnostics; Save commit блокируется при ошибке. Editor UI теперь показывает отдельный `PluginDiagnosticsJournal`, а Save HTTP 422 раскрывает реальные plugin diagnostics вместо generic failure. |
| G9 | Не входит в этот этап | Runtime plugins не реализованы | ADR-040 остается действующим ограничением: manifest/platform capabilities first, trusted runtime plugin только отдельным процессом и отдельным ревью. Полноценный runtime-api plugin runner оформлен как debt `LEGACY-0014`. |
| G10 | Закрыт | Manifest debt у `Antarctica` и `simple-choice` | Бывшие script actions и runtime-script заглушка закрыты. Schema/runtime принимают deterministic-изменения через `effects[]`. Исполнительные записи: `antarctica-manifest-cleanup.md`, `deterministic-effects-migration-closeout.md`. |

## 4. Целевой поток

Целевой поток для editor preview:

```text
Editor ChangeSet touches plugin files
  -> path boundary check
  -> plugin discovery under games/<gameId>/plugins/<pluginId>
  -> plugin.json schema validation
  -> dependency policy check
  -> validation commands through platform-owned runner
  -> browser bundle build for player-web target
  -> bundle reference registered inside session contentSourceId boundary
  -> player-web preview loads bundle only in preview mode
  -> plugin activate(api)
  -> preview remounts when pluginVersion hash changes
```

Целевой поток для production:

```text
Published game version
  -> published manifests/source maps
  -> immutable published plugin bundle artifacts under games/<gameId>/published/
  -> player-web-plugin-bundles.json metadata
  -> runtime-api exposes published bundle references
  -> player-web loads only published bundle references
  -> no editor worktree paths, no local session code
```

`runtime-api` в обоих потоках не исполняет `player-web` plugin code. Он может хранить и отдавать metadata (метаданные - описание ссылки, hash и target), но не запускать frontend code.

## 5. Этапы закрытия

### Этап 1. Discovery и contract hardening

Цель: заменить ручные знания о файлах плагина на общий discovery.

Сделать:

- найти plugin roots только по шаблону `games/<gameId>/plugins/<pluginId>/plugin.json`;
- проверить, что `pluginId` из пути совпадает с `plugin.json.id`;
- проверить, что `gameId` из пути совпадает с `plugin.json.gameId`;
- проверить `apiVersion` against supported range;
- вернуть typed discovery result для editor validation и bundle builder;
- оставить `simple-choice` без plugin roots.

Acceptance:

- schema-valid `Antarctica` plugin находится автоматически;
- plugin outside `games/<gameId>/plugins` игнорируется или получает diagnostic;
- несовпадение path/id/gameId блокирует validation;
- `simple-choice` не получает пустой no-op plugin.

### Этап 2. Validation runner

Цель: запускать проверки плагина до Save и preview.

Правило: `plugin.json.validation` содержит имена проверок, а не shell commands. В первой реализации эти имена сопоставляются с platform-owned command templates. Script strings из `package.json` не исполняются как произвольные команды.

Минимальные команды:

| Validation name | Platform-owned command template |
| --- | --- |
| `typecheck` | `node <platform-typescript>/tsc -p <generated-plugin-tsconfig> --noEmit` |
| `test` | reserved until plugin-local tests are added |
| `build` | reserved until bundle builder contract is implemented |

Execution rule:

- использовать `execFile` или `spawn` с явным argv;
- не использовать `exec(commandString)`;
- не включать `shell: true`;
- задавать `cwd = platformRoot`, а plugin source подключать через generated tsconfig; это важно для isolated editor project roots, где есть `games/**`, но нет `apps/player-web`;
- задавать timeout и `AbortSignal`;
- ограничивать stdout/stderr;
- сохранять exit code, signal, duration and truncated output в diagnostics.

Context7 / Node.js note: Node.js docs warn that shell-based `exec()` processes command strings through a shell and must not receive unsanitized input. Node.js `spawn` accepts `AbortSignal`, so validation cancellation and timeout should use that path.

Acceptance:

- failing typecheck blocks Save/preview and writes diagnostic;
- timeout blocks Save/preview and writes diagnostic;
- unknown validation command is rejected before process start;
- command with shell metacharacters cannot be represented in `plugin.json`;
- package dependencies remain forbidden for `platform-only`.

### Этап 3. Session plugin bundle builder

Цель: собрать браузерный файл плагина из session worktree.

Bundle (браузерный файл плагина) должен:

- экспортировать `activate(api)`;
- импортировать только plugin-local relative files and `@cubica/player-web/plugin-api`;
- не импортировать private `apps/player-web` modules;
- быть content-hashed;
- писаться под `.tmp/editor-plugin-bundles/<gameId>/<pluginId>/<contentHash>.mjs` внутри session content root;
- иметь hash, source root and entry in runtime/editor diagnostics. Manifest sidecar пока не нужен для local preview, потому что runtime получает typed metadata через `/content/reload`.

Next.js note: Next.js supports bundling local/monorepo packages with `transpilePackages`, but editor session worktree TypeScript is not automatically a browser bundle. Поэтому для session preview нужен явный bundle handoff из ADR-039, а не надежда на Next dev module graph.

Acceptance:

- изменение `src/register.ts` или `src/state-resolvers.ts` пересобирает bundle;
- hash меняется только при изменении plugin-relevant inputs;
- bundle builder typechecks against the public API facade from the platform checkout and bundles only plugin-local relative files plus `@cubica/player-web/plugin-api`;
- bundle builder не пишет в `apps/player-web/src`.

### Этап 4. Runtime-api bundle metadata handoff

Цель: передать ссылку на bundle через уже существующую session/content boundary.

`runtime-api` должен:

- принимать bundle metadata только для allowlisted editor session roots;
- хранить metadata рядом с `contentSourceId`;
- отдавать metadata в player-facing preview response or preview bootstrap endpoint;
- не исполнять bundle;
- не читать plugin source для runtime decisions;
- не добавлять game-specific branches.

Acceptance:

- preview contentSourceId имеет bundle references in `PlayerFacingContent.pluginBundles`;
- production request без preview не получает editor session bundle reference;
- invalid contentSourceId не раскрывает локальные пути;
- runtime-api tests доказывают, что сервис только передает metadata.

### Этап 5. Player-web dynamic bundle loader

Цель: убрать static bridge из preview and production player paths.

`player-web` должен:

- загружать session plugin bundles только when `preview=1` and `contentSourceId` present;
- загружать published plugin bundles только outside preview mode;
- проверять `target === "player-web"` and compatible `apiVersion`;
- проверять expected `scope`;
- вызывать `activate(playerPluginApi)`;
- remount or rebuild config when `pluginVersion` changes;
- не грузить editor worktree code in production mode;
- сохранить default manifest-driven path для игр без плагинов.

Acceptance:

- `Antarctica` preview работает через loaded bundle;
- изменение plugin source в session worktree refreshes preview without restarting `player-web`;
- `simple-choice` preview работает без plugin bundle;
- production build не содержит session worktree paths.

### Этап 6. Editor Save/ChangeSet integration

Цель: plugin validation becomes a first-class Save gate.

Editor flow:

- ChangeSet touches plugin files;
- boundary validation runs;
- discovery identifies affected plugin roots;
- schema/dependency/version checks run;
- validation runner runs requested commands;
- bundle build runs for preview-affecting player-web plugin;
- diagnostics are added to validation result and patch journal;
- Save is blocked on error diagnostics.

Acceptance:

- UI shows plugin validation failures in the same validation surface as manifest errors;
- patch journal records validation status;
- failed plugin validation prevents Save commit;
- passing plugin validation allows Save commit.

### Этап 7. E2E closeout

Цель: доказать end-to-end behavior, not only unit checks.

Required e2e:

- editor opens `Antarctica` session;
- patch changes plugin-visible text or resolver behavior inside session worktree;
- validation passes;
- preview refreshes without restarting `player-web`;
- iframe shows changed plugin behavior;
- `simple-choice` preview still works without plugin bundle.

## 6. Контракты

### 6.1. Discovery result

```ts
interface ProjectPluginDescriptor {
  gameId: string;
  pluginId: string;
  pluginRoot: string;
  manifestPath: string;
  apiVersion: string;
  targets: {
    playerWeb?: {
      entry: string;
      contributes: {
        gameConfigFactory?: boolean;
      };
    };
  };
}
```

### 6.2. Validation diagnostic

```ts
interface PluginValidationDiagnostic {
  severity: "error" | "warning" | "info";
  pluginId: string;
  filePath?: string;
  code:
    | "plugin.schema"
    | "plugin.path"
    | "plugin.dependencies"
    | "plugin.command"
    | "plugin.timeout"
    | "plugin.version"
    | "plugin.bundle";
  message: string;
  details?: {
    exitCode?: number;
    signal?: string;
    durationMs?: number;
    stdout?: string;
    stderr?: string;
  };
}
```

### 6.3. Bundle reference

```ts
interface PlayerWebPluginBundleReference {
  gameId: string;
  pluginId: string;
  target: "player-web";
  apiVersion: string;
  bundleUrl: string;
  contentHash: string;
  mode: "editor-preview" | "published";
}
```

Rule: `bundleUrl` must be a URL served by the platform preview/publish layer, not a raw filesystem path.

## 7. Проверки и тесты

Unit/focused tests:

- plugin schema and bundle path are covered by `apps/editor-web/src/lib/project-plugin-validation.test.ts`;
- dependency policy rejects `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`;
- validation runner rejects unsafe script declarations and unknown commands before shell execution;
- validation runner records non-zero exit diagnostics;
- validation runner records timeout diagnostics;
- simple-choice remains plugin-free;
- player preview loader imports a session module and updates config data without restarting `player-web`.

Integration tests:

- editor Save fails on broken plugin typecheck;
- editor Save succeeds on valid plugin change;
- runtime-api stores and returns bundle metadata only inside registered `contentSourceId`;
- player-web preview loads bundle and calls `activate(api)`;
- simple-choice remains plugin-free.

Static scans:

```text
rg -n "editor-engine" apps/player-web services/runtime-api
rg -ni "gameId ===|antarctica" apps/player-web services/runtime-api packages/contracts
rg -n "_source_trace|editor\\.layout|editor-playthrough" games/*/game.manifest.json games/*/ui/*/ui.manifest.json
```

## 8. Правила безопасности

- `plugin.json` is validated by JSON Schema before any plugin command runs.
- Path checks use normalized real paths and must reject traversal outside plugin root.
- Symlinked plugin files are rejected unless a later ADR explicitly allows them.
- `dependenciesPolicy: "platform-only"` forbids npm dependencies.
- Validation command names are allowlisted; arbitrary shell command strings are not accepted.
- Process execution uses `execFile` or `spawn` with explicit argv, timeout and `AbortSignal`.
- Plugin validation output is truncated before writing diagnostics.
- Preview bundle code is loaded only in preview mode from registered content source.
- Production player loads only published bundle references.
- Runtime-api never executes player-web plugin code.

## 9. Отложенные темы

These are not blockers for closing the current project-local player-web plugin gaps:

- marketplace plugin verification and provenance;
- npm dependencies for verified marketplace plugins;
- runtime-api plugins as first-class target;
- container sandbox and WebAssembly/WASI runner;
- production-safe published player plugin bundle handoff.

`Antarctica` manifest cleanup closed game-specific `capabilityFamily` names, former `script` actions, the obsolete runtime-script placeholder and early deterministic fields. Broader platform cleanup has also removed schema/runtime compatibility after `simple-choice` moved to `effects[]`.

Cleanup scope and checks are documented in `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-manifest-cleanup.md`. Full runtime-api plugin runner remains legacy debt `LEGACY-0014` until a separate implementation slice proves the need and satisfies ADR-040.

## 10. Готовность к реализации

Implementation started after these conditions were met:

- ADR-039 is accepted or explicitly kept as the implementation direction for local preview;
- this gap closure plan is linked from the active TSK and execution matrix;
- `plugin.schema.json` remains the single source of truth for `plugin.json`;
- `Antarctica` plugin typecheck remains green;
- `simple-choice` still has no plugin root.

The first implementation slice is now in code: discovery + validation runner + diagnostics + local preview bundle handoff. Preview does not load plugin code until validation passes.

## 11. Итог закрытия

Итоговый документ закрытия миграции `Antarctica`: `docs/tasks/artifacts/TSK-20260527-editor-engine-preview-timeline-editor/antarctica-plugin-migration-closeout.md`.

Implemented files:

- `apps/editor-web/src/lib/project-plugin-validation.ts` - discovers project-local plugins, validates `plugin.json` through JSON Schema, enforces `platform-only`, runs direct typecheck with timeout, and builds session-scoped browser modules.
- `apps/editor-web/app/api/editor/preview/route.ts` - validates and bundles session plugins before runtime preview.
- `apps/editor-web/app/api/editor/compile/route.ts` and `apps/editor-web/app/api/editor/file/route.ts` - include plugin validation diagnostics; Save commit is blocked when plugin validation fails.
- `scripts/manifest-tools/build-player-web-plugin-bundles.cjs` - builds published `player-web` bundles, writes hash-addressed artifacts and checks generated metadata drift.
- `docs/architecture/schemas/player-web-plugin-bundles.schema.json` - validates generated published bundle metadata.
- `services/runtime-api/src/modules/content/contentService.ts` and `services/runtime-api/src/modules/player-api/httpServer.ts` - carry preview bundle references inside `contentSourceId`, load published bundle metadata for normal player content, and serve bundle files without executing them.
- `apps/player-web/src/plugins/preview-plugin-loader.ts` and `apps/player-web/src/components/game-player.tsx` - load preview or published bundles according to explicit scope and rebuild config after `activate(api)`.
- `packages/contracts/manifest/src/index.ts` - adds `PlayerWebPluginBundleReference` and optional `PlayerFacingContent.pluginBundles`.

Remaining gaps after this closure:

- Plugin validation diagnostics are returned by preview/compile/save and shown in a dedicated editor UI journal row.
- Runtime plugins remain a separate ADR-040 slice.
- Cleanup манифестов `Antarctica` и `simple-choice` закрыт: deterministic-изменения идут через `effects[]`, без ранних schema/runtime алиасов. Полноценный runtime-api plugin runner зафиксирован как `LEGACY-0014`.
