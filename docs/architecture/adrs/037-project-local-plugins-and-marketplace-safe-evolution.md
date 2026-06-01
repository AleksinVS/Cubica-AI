# ADR-037: Project-Local Plugins And Marketplace-Safe Evolution

- **Дата**: 2026-05-28
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Game Projects, Editor Web, Player Web, Runtime API, Plugin Validation, Marketplace
- **Связанные решения**: ADR-019, ADR-026, ADR-027, ADR-030, ADR-036, ADR-039, ADR-040

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Runtime-api plugins](#5-runtime-api-plugins)
- [6. Целевая структура plugin](#6-целевая-структура-plugin)
- [7. Валидация и безопасность](#7-валидация-и-безопасность)
- [8. Preview hot reload](#8-preview-hot-reload)
- [9. Миграция Antarctica](#9-миграция-antarctica)
- [10. Следующий шаг после plugin system](#10-следующий-шаг-после-plugin-system)
- [11. Отклоненные альтернативы](#11-отклоненные-альтернативы)
- [12. Последствия](#12-последствия)
- [13. Открытые вопросы](#13-открытые-вопросы)

## 1. Понимание решения

Решение понято так: текущий `apps/player-web/src/plugins/*` слой остается полезным доказательством game-agnostic подхода, но он больше не является целевой архитектурой пользовательских плагинов. Целевые плагины должны жить в Git-репозитории конкретного игрового проекта, редактироваться через editor session worktree, проверяться до Save и со временем стать пригодными для marketplace.

Принимаем вариант: **project-local trusted plugins сейчас, marketplace-safe sandbox path позже**. Текущий platform-plugin подход не продолжаем как целевой; его используем только как legacy source при миграции Antarctica.

## 2. Контекст

ADR-026 ввел game-agnostic plugin architecture для `player-web`: конкретная игра может зарегистрировать `GameConfig` resolvers, а generic player не должен получать game-specific branches. ADR-027 сделал plugin optional для простых игр: если UI/runtime манифесты достаточно выразительны, игра запускается без custom plugin.

Editor-engine добавил Project Git Workspace: authoring manifests, assets, tests and user plugins должны версионироваться вместе в project repo. Поэтому user plugin code не должен жить внутри platform app directory like `apps/player-web/src/plugins`; иначе редактор не сможет безопасно править, валидировать and commit plugin changes как часть игры.

Будущий marketplace означает, что plugin contract должен сразу учитывать сторонних авторов, зависимости, provenance and sandboxing, даже если первая реализация запускает только доверенный project-local code.

## 3. Термины

- **Project-local plugin** - подключаемый модуль игры, который лежит внутри `games/<gameId>/plugins/<pluginId>/` и версионируется вместе с проектом игры.
- **Marketplace plugin** - plugin от стороннего автора, распространяемый через каталог/marketplace и допускаемый к использованию только после отдельной верификации.
- **Runtime-api plugin** - plugin target для backend runtime. Такой plugin мог бы добавлять серверные обработчики действий, state transition helpers, validators or runtime-side integrations. В первой реализации этот target запрещен.
- **Player-web plugin** - plugin target для web player: state resolvers, action adapter, screen/layout overrides, renderer/fallback behavior and preview metadata helpers.
- **Editor-web plugin** - future target для editor tooling: property panel extensions, custom inspectors, editor commands or entity projections.
- **Sandbox** - изолированная среда выполнения недоверенного кода с ограниченными правами файловой системы, сети, environment variables and process spawning.

## 4. Решение

1. Целевой plugin root:

```text
games/<gameId>/plugins/<pluginId>/
  plugin.json
  package.json
  src/
  tests/
```

2. `plugin.json` становится декларативным contract-файлом plugin. Его структура должна задаваться JSON Schema and validated through AJV, not through manual TypeScript guards.
3. Первым поддерживаемым target является `player-web`. `runtime-api` and `editor-web` targets are reserved until separate ADR/implementation.
4. Antarctica plugin must migrate from its former platform-local directory to `games/antarctica/plugins/antarctica-player`.
5. `apps/player-web/src/plugins/*` is not the target architecture. It can remain only as temporary legacy while migration is in progress.
6. Plugin dependencies from npm are forbidden for all plugins until verification system exists. After verification exists, npm dependencies are allowed only for verified plugins under a pinned dependency and provenance policy.
7. Preview must pick up plugin code changes without restarting `player-web`.
8. Future marketplace support must use a sandbox-capable design. The first implementation may run trusted local plugin validation commands, but the manifest and validation model must not block later sandboxing.
9. If server-side game logic requires runtime-api plugin-like code before the dedicated ADR exists, it may be created only as documented legacy/technical debt. Such code is not part of the target plugin system and must be migrated or retired when runtime-api plugin architecture is accepted.

## 5. Runtime-api plugins

Runtime-api plugins are backend plugins. They would run or influence code inside the runtime service boundary, for example:

- custom deterministic action handlers;
- custom state transition functions that cannot be expressed through manifest actions, JSON Patch or JsonLogic;
- server-side validators;
- integrations with external services;
- custom content projection for runtime/player DTOs.

They are needed for some classes of games because authoritative game logic lives on the server. They are also higher risk than player-web plugins because they can affect authoritative game state, session processing and backend resources.

Therefore ADR-037 does **not** define runtime-api plugins as a first-class target yet. A runtime-api plugin target requires a separate architecture decision with sandbox, permissions, observability and rollback policy.

2026-05-30 update: ADR-040 is accepted as the runtime-api extension policy. It does not add runtime-api plugins to the current ADR-037 implementation. It makes manifest/platform capabilities mandatory wherever possible, forbids game-specific functionality in generic `runtime-api`, allows in-process runtime plugins only for internal separately reviewed cases, and makes an isolated runner the target for all non-internal runtime plugins.

Temporary legacy exception:

- server-side plugin-like code may be created before that ADR only when the mechanic cannot reasonably be expressed through manifests, schemas, reusable handlers, JSON Patch, JsonLogic or player-web plugins;
- it must be explicitly documented as legacy/technical debt, with owner, reason and expected migration path;
- it must not be exposed to marketplace authors;
- it must not be treated as editor-editable user plugin code;
- it must have focused tests and platform-purity review so game-specific code does not silently leak into generic runtime core.

## 6. Целевая структура plugin

Minimal `plugin.json` shape:

```json
{
  "$schema": "../../../../docs/architecture/schemas/plugin.schema.json",
  "id": "antarctica-player",
  "gameId": "antarctica",
  "apiVersion": "1.0",
  "targets": {
    "player-web": {
      "entry": "src/index.ts",
      "contributes": {
        "gameConfigFactory": true
      }
    }
  },
  "validation": {
    "typecheck": "typecheck",
    "build": "build",
    "test": "test"
  },
  "permissions": {
    "network": false,
    "filesystem": "plugin-root-only",
    "environment": []
  },
  "dependenciesPolicy": "platform-only"
}
```

The exact schema can evolve during implementation, but these concepts are stable:

- stable `id`;
- explicit `gameId`;
- `apiVersion`;
- explicit targets;
- explicit entrypoints;
- explicit contribution points;
- explicit validation commands;
- explicit permission request;
- explicit dependency policy.

## 7. Валидация и безопасность

Plugin validation gates for any ChangeSet touching `games/<gameId>/plugins/**`:

1. Path boundary check: plugin edits stay under the project plugin root and cannot touch platform roots.
2. JSON Schema validation of `plugin.json`.
3. Dependency policy check:
   - first stage: no plugin npm dependencies;
   - later: dependencies allowed only for verified marketplace plugins with pinned versions and provenance checks.
4. Command allowlist check: validation commands must be declared in `plugin.json` and must map to known package scripts.
5. Command execution uses direct process APIs, not shell command strings. Node.js docs warn that shell-based `exec()` must not receive unsanitized input; use `execFile`/`spawn` style execution with explicit argv, timeout and abort support.
6. Typecheck/build/test gates run in the session worktree before Save.
7. Runtime/player smoke runs when plugin output affects preview/runtime behavior.
8. Validation result is stored in the patch journal and shown as a human-readable status in the editor.

Future sandbox path:

- marketplace plugins run in a restricted environment;
- plugin permissions are explicit and reviewable;
- network/filesystem/env/process access defaults to denied;
- runtime-api target requires stronger isolation than player-web target.

## 8. Preview hot reload

Preview must reflect plugin code changes without restarting `player-web`.

Target behavior:

- editor session compiles plugin code inside the session worktree;
- editor preview registers or refreshes a session-scoped plugin bundle together with generated manifests;
- player-web preview loads the plugin bundle for that session/content source;
- changing plugin files invalidates only the session preview bundle;
- production player keeps using published bundles, not editor worktree code.

The first implementation preserves the content-source/session boundary from ADR-036. ADR-039 defines the concrete handoff: editor-web builds a session-scoped browser bundle for preview, the publish builder creates immutable published bundles for production, runtime-api carries only bundle references, and player-web loads bundles according to their explicit `scope`.

## 9. Миграция Antarctica

Antarctica plugin migration target:

```text
games/antarctica/plugins/antarctica-player/
  plugin.json
  package.json
  src/index.ts
  src/config-data.ts
  src/contracts.ts
  src/state-resolvers.ts
  src/register.ts
```

Migration rules:

- do not add Antarctica-specific branches to `apps/player-web`, `runtime-api` or shared contracts;
- keep manifest-driven/default player path for simple games;
- keep `simple-choice` plugin-free;
- use the former platform-local implementation only as migration input;
- after migration, remove the former platform-local Antarctica plugin directory; local editor preview uses ADR-039 session bundles, and non-preview player mode uses ADR-039 published bundle references.

## 10. Следующий шаг после plugin system

After the plugin system is implemented and Antarctica is migrated, the next editor-engine step is:

1. implement production/remote generated bundle handoff policy;
2. make Save/Publish decide whether generated manifests, source maps and plugin bundles are committed, uploaded or rebuilt server-side;
3. extend browser e2e from local session preview to published/remote preview;
4. then continue richer timeline work: playthrough rollback UI, snapshot restore controls and e2e coverage for time travel.

This ordering matters: plugin code hot reload and validation define what a generated/published game bundle contains. Publishing policy should not be finalized before plugin bundle artifacts are part of the model.

## 11. Отклоненные альтернативы

### Continue Current `apps/player-web/src/plugins` As Target

Rejected. It keeps game-specific code inside platform app source, makes editor session Git versioning impossible for plugins and blocks marketplace packaging.

### Enable Runtime-api Plugins As First-Class Target Immediately

Rejected. Backend plugins affect authoritative state and service resources. They require a separate sandbox/permissions/observability decision. Limited legacy plugin-like runtime code is allowed only as documented debt until that decision exists.

### Allow npm Dependencies Before Verification

Rejected. Marketplace dependencies need verification, pinning, provenance and security policy. Until that exists, project plugins can use platform-provided dependencies only.

### Require Restart For Plugin Preview Changes

Rejected. It breaks the preview-first authoring workflow. Plugin edits must refresh session preview without restarting `player-web`.

## 12. Последствия

Positive:

- plugins become part of the game project, not platform source;
- editor can apply, validate, undo and commit plugin changes in the same session model as authoring manifests;
- marketplace path is not blocked by the first implementation;
- simple games still do not need plugins;
- platform purity is strengthened because game-specific code has a clear home.

Negative:

- plugin bundling and hot reload add a new build pipeline;
- validation becomes more expensive when plugin code changes;
- dependency policy is intentionally strict until verification exists;
- Antarctica migration is required before the current platform plugin layer can be retired.

## 13. Открытые вопросы

- `plugin.json` JSON Schema exists at `docs/architecture/schemas/plugin.schema.json`; versioning policy beyond `apiVersion: "1.0"` remains open.
- Exact player-web plugin bundle format for production publish is implemented in ADR-039: published bundles are immutable content-hash artifacts exposed through `PlayerFacingContent.pluginBundles`.
- Whether verified marketplace plugins are copied into project repos, referenced by package id/version, or both.
- Sandbox technology for untrusted marketplace plugins.
- First concrete runtime-api plugin target implementation remains future work. ADR-040 defines the accepted policy, but not the implementation slice.
