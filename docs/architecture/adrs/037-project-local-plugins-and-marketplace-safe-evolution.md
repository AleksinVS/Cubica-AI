# ADR-037: Project-Local Plugins And Marketplace-Safe Evolution

- **Дата**: 2026-05-28
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: Game Projects, Editor Web, Player Web, Runtime API, Plugin Validation, Marketplace
- **Связанные решения**: ADR-019, ADR-026, ADR-027, ADR-030, ADR-036, ADR-039, ADR-040, ADR-084

> [!IMPORTANT]
> Поправка ADR-084: упоминания JSON Patch, JsonLogic, manifest action handlers
> и custom transition functions ниже описывают историческую границу выбора.
> Действующая проверка сначала определяет, выражается ли механика через Game
> Intent, типизированный Mechanics IR и закреплённый общий модуль. Если нет,
> исполняемый код допускается только как безопасное изолированное расширение в
> границе конкретной игры; удалённый effects/JsonLogic executor не является
> альтернативой.

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Runtime-api plugins](#5-runtime-api-plugins)
- [6. Целевая структура plugin](#6-целевая-структура-plugin)
- [7. Валидация и безопасность](#7-валидация-и-безопасность)
- [8. Preview hot reload](#8-preview-hot-reload)
- [9. Отклоненные альтернативы](#9-отклоненные-альтернативы)
- [10. Последствия](#10-последствия)

## 1. Понимание решения

Решение понято так: пользовательские плагины живут в Git-репозитории
конкретного игрового проекта, редактируются через session worktree и проходят
проверку до сохранения. Доверенные project-local плагины являются первой
границей доверия, а сторонние плагины требуют marketplace-safe sandbox.

## 2. Контекст

ADR-026 ввел game-agnostic plugin architecture для `player-web`: конкретная игра может зарегистрировать `GameConfig` resolvers, а generic player не должен получать game-specific branches. ADR-027 сделал plugin optional для простых игр: если UI/runtime манифесты достаточно выразительны, игра запускается без custom plugin.

Project Git Workspace требует, чтобы authoring manifests, assets, tests and user
plugins версионировались вместе в project repo. Поэтому пользовательский plugin
code не должен жить внутри исходников платформенного приложения.

Marketplace означает, что plugin contract учитывает сторонних авторов,
зависимости, происхождение кода и sandboxing независимо от текущей границы
доверенных project-local плагинов.

## 3. Термины

- **Project-local plugin** - подключаемый модуль игры, который лежит внутри `games/<gameId>/plugins/<pluginId>/` и версионируется вместе с проектом игры.
- **Marketplace plugin** - plugin от стороннего автора, распространяемый через каталог/marketplace и допускаемый к использованию только после отдельной верификации.
- **Runtime-api plugin** - plugin target для backend runtime. Политика таких
  расширений определяется ADR-040.
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
3. Поддерживаемым пользовательским target является `player-web`. Другие targets
   требуют отдельного принятого архитектурного решения.
4. Существующие game-specific плагины должны мигрировать из platform-local
   каталогов в project-local границу.
5. `apps/player-web/src/plugins/*` is not the target architecture. It can remain only as temporary legacy while migration is in progress.
6. Plugin dependencies from npm are forbidden for all plugins until verification system exists. After verification exists, npm dependencies are allowed only for verified plugins under a pinned dependency and provenance policy.
7. Preview must pick up plugin code changes without restarting `player-web`.
8. Marketplace support must use a sandbox-capable design. Доверенные локальные
   команды проверки допустимы только внутри project-local границы доверия.

## 5. Runtime-api plugins

Runtime-api plugins are backend plugins. They would run or influence code inside the runtime service boundary, for example:

- custom deterministic action handlers;
- custom state transition functions that cannot be expressed through manifest actions, JSON Patch or JsonLogic;
- server-side validators;
- integrations with external services;
- custom content projection for runtime/player DTOs.

They are needed for some classes of games because authoritative game logic lives on the server. They are also higher risk than player-web plugins because they can affect authoritative game state, session processing and backend resources.

ADR-040 является нормативной политикой runtime-api extensions: общие
декларативные механики обязательны везде, где они достаточны; game-specific
functionality запрещена в generic Runtime API; in-process расширения допустимы
только для отдельно проверенного внутреннего кода, а недоверенные расширения
исполняются изолированно. ADR-037 не добавляет runtime-api plugin как
пользовательский target.

## 6. Целевая структура plugin

Minimal `plugin.json` shape:

```json
{
  "$schema": "../../../../docs/architecture/schemas/plugin.schema.json",
  "id": "example-player",
  "gameId": "example-game",
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

Точная схема может эволюционировать, но следующие понятия стабильны:

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

Граница сохраняет content-source/session boundary из ADR-036. ADR-039 определяет
передачу session-scoped bundle для preview и неизменяемого published bundle для
production; Runtime API передаёт только ссылки, а Player Web проверяет их
явный `scope`.

## 9. Отклоненные альтернативы

### Continue Current `apps/player-web/src/plugins` As Target

Rejected. It keeps game-specific code inside platform app source, makes editor session Git versioning impossible for plugins and blocks marketplace packaging.

### Enable Runtime-api Plugins As First-Class Target Immediately

Rejected. Backend plugins affect authoritative state and service resources. They require a separate sandbox/permissions/observability decision. Limited legacy plugin-like runtime code is allowed only as documented debt until that decision exists.

### Allow npm Dependencies Before Verification

Rejected. Marketplace dependencies need verification, pinning, provenance and security policy. Until that exists, project plugins can use platform-provided dependencies only.

### Require Restart For Plugin Preview Changes

Rejected. It breaks the preview-first authoring workflow. Plugin edits must refresh session preview without restarting `player-web`.

## 10. Последствия

Positive:

- plugins become part of the game project, not platform source;
- editor can apply, validate, undo and commit plugin changes in the same session model as authoring manifests;
- project-local граница совместима с последующим marketplace sandbox;
- simple games still do not need plugins;
- platform purity is strengthened because game-specific code has a clear home.

Negative:

- plugin bundling and hot reload add a new build pipeline;
- validation becomes more expensive when plugin code changes;
- dependency policy is intentionally strict until verification exists;
- прежний platform-local слой нельзя считать постоянным fallback после переноса
  game-specific плагина в project-local границу.
