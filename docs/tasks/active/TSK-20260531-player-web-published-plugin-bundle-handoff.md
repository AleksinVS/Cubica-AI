# TSK-20260531-player-web-published-plugin-bundle-handoff: Published Player-Web Plugin Bundles

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Baseline](#architecture-baseline)
- [Best Practices](#best-practices)
- [Chosen Direction](#chosen-direction)
- [Alternatives](#alternatives)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Open Questions](#open-questions)
- [Handoff Log](#handoff-log)

## Status

implemented

## Understanding

Задача понята так: local preview уже умеет собирать session-scoped `player-web` plugin bundle, передавать ссылку через `PlayerFacingContent.pluginBundles` и загружать код в браузере без перезапуска `player-web`. Теперь нужно закрыть production-разрыв: обычный player без `preview=1` должен получать опубликованный plugin bundle из published content metadata, а не через временную статическую регистрацию в `apps/player-web`.

Под **published bundle** здесь понимается неизменяемый браузерный JavaScript-файл плагина, созданный publish pipeline для конкретной версии игры. Файл имеет content hash, то есть идентификатор, вычисленный из байтов файла.

## Architecture Baseline

- ADR-037: плагины живут в `games/<gameId>/plugins/<pluginId>/`, первый target - trusted project-local `player-web`.
- ADR-039: local preview bundle handoff and production/published handoff are implemented for trusted project-local `player-web` plugins.
- ADR-040: runtime-api plugins остаются отдельной темой; production handoff не исполняет plugin code на сервере.
- `plugin.json` validates through `docs/architecture/schemas/plugin.schema.json`; JSON Schema остается single source of truth.
- `runtime-api` передает preview and published bundle references через `PlayerFacingContent.pluginBundles`.
- `player-web` импортирует browser bundle and calls `activate(api)` for the allowed scope only.

## Best Practices

Используемые практики:

- Неизменяемые JavaScript assets должны иметь hash in URL/filename and long cache headers. Mutable files from a generic public folder should not be treated as forever-cacheable.
- Metadata that points to bundles can change and should be revalidated together with game content.
- Browser `import()` is a good fit for loading a single ESM plugin module at runtime.
- Dynamic `import()` does not give a portable per-call integrity option like `<script integrity>`. Поэтому baseline protection is server-side hash verification plus content-addressed URLs.
- Publish/validation commands must run through direct process execution: `spawn` or `execFile`, argv array, timeout and `AbortSignal`; no shell strings.
- Plugin code receives only `PlayerPluginApi`, not private imports from `apps/player-web`.

Sources checked:

- Context7: Next.js static assets, CDN `assetPrefix`, public folder cache policy.
- Context7: Node.js `child_process.spawn`/`execFile`, timeout and abort behavior.
- MDN: dynamic `import()`, `Cache-Control`, Subresource Integrity.

## Chosen Direction

Use one plugin loading contract for preview and production:

```text
PlayerFacingContent.pluginBundles[]
  -> player-web validates scope/apiVersion/hash metadata
  -> browser imports bundle URL
  -> bundle exports activate(api)
  -> plugin registers config/resolvers through PlayerPluginApi
```

Preview and production differ only by bundle source:

| Mode | Bundle source | Scope |
| --- | --- | --- |
| Editor preview | `.tmp/editor-plugin-bundles/...` registered through `contentSourceId` | `preview` |
| Production/published | generated published artifact root or CDN/object storage with immutable hash URLs | `published` |

Implemented published metadata shape:

```json
{
  "schemaVersion": "1.0",
  "bundles": [
    {
      "pluginId": "antarctica-player",
      "gameId": "antarctica",
      "apiVersion": "1.0",
      "target": "player-web",
      "scope": "published",
      "contentHash": "64-char-sha256-hex",
      "integrity": "sha256-base64-digest",
      "filePath": "published/antarctica-player.64-char-sha256-hex.mjs",
      "url": "/published-plugin-bundles/antarctica/antarctica-player/64-char-sha256-hex.mjs"
    }
  ]
}
```

The first production slice serves published bundles through `runtime-api`. CDN/object storage can be added later by preserving the same metadata contract and immutable URLs.

## Alternatives

| Option | Decision | Reason |
| --- | --- | --- |
| Keep static registration in `player-web` | Rejected as target | Keeps game-specific plugin activation in platform source and blocks real publish artifacts. |
| Store bundle URL directly inside `game.manifest.json` | Rejected for first slice | Runtime game manifest should describe game logic; published artifact metadata should describe build outputs. |
| Use Module Federation | Rejected for now | Too much bundler/runtime negotiation before we need shared dependencies. |
| Serve bundles only from CDN | Deferred | Good future backend, but not needed to remove static fallback. |
| Reuse preview bundle path in production | Rejected | Preview bundle is tied to session content source and `.tmp` worktree. |

## Scope

In scope:

- Add an explicit `scope: "preview" | "published"` to `PlayerWebPluginBundleReference`.
- Define supported `apiVersion` policy for `player-web`; first version is exact `1.0`.
- Add publish-time plugin bundle generation for trusted project-local `player-web` plugins.
- Generate published plugin bundle metadata.
- Let `runtime-api` expose published bundle references for normal player content without `contentSourceId`.
- Serve published bundle files with path-boundary and content-hash verification.
- Update `player-web` loader so preview and published bundles share one loading path.
- Switch `Antarctica` non-preview mode to published bundle handoff.
- Remove the temporary static bridge after `Antarctica` passes through published bundle loading.
- Keep `simple-choice` plugin-free.

## Non-Goals

- Marketplace plugin verification.
- Runtime-api plugin runner.
- npm dependencies in project-local plugins.
- Container/WASI sandbox.
- CDN deployment automation beyond a compatible metadata shape.
- Changing gameplay logic or manifest action semantics.

## Execution Plan

### Phase 1. Contract And Metadata

1. Done: `PlayerWebPluginBundleReference` now has `scope`.
2. Done: runtime/player tests cover preview and published scope.
3. Done: generated metadata lives at `games/<gameId>/published/player-web-plugin-bundles.json`.
4. Done: `docs/architecture/schemas/player-web-plugin-bundles.schema.json` validates generated metadata.

### Phase 2. Publish Builder

1. Done: `scripts/manifest-tools/build-player-web-plugin-bundles.cjs` reuses the project-local plugin contract.
2. Done: typecheck runs through direct `spawn`, no shell string, with timeout/abort support.
3. Done: bundle is written to an immutable content-hash path under `games/<gameId>/published/`.
4. Done: metadata records `contentHash` and `integrity`.
5. Done: `--check` fails when generated bundle files or metadata are stale.

### Phase 3. Runtime Exposure

1. Done: runtime-api loads published bundle metadata from the game published root.
2. Done: runtime-api filters by `gameId` and `target`; player-web enforces supported `scope`.
3. Done: `/published-plugin-bundles/:gameId/:pluginId/:contentHash.mjs` serves bundle bytes.
4. Done: published bundle responses use `Cache-Control: public, max-age=31536000, immutable`.
5. Done: preview bundle serving remains separate and session-scoped.

### Phase 4. Player Loading

1. Done: the existing loader now exposes `loadPlayerWebPluginBundles`.
2. Done: unsupported `apiVersion` and unexpected `scope` fail closed.
3. Done: loader uses the bundle URL plus `contentHash` as import identity.
4. Done: `GamePlayer` rebuilds game config after `activate(api)`.
5. Done: player-web and runtime-api tests cover production bundle references.

### Phase 5. Antarctica Cutover

1. Done: published bundle metadata was generated for `Antarctica`.
2. Done: non-preview `Antarctica` receives a `published` bundle reference from runtime-api.
3. Done: editor preview still uses `preview` bundles under `contentSourceId`.
4. Done: `simple-choice` still has no plugin bundle.
5. Done: `apps/player-web/src/plugins/register-games.ts` was removed.

## Acceptance

- Production `PlayerFacingContent` for `Antarctica` contains a `published` player-web plugin bundle reference.
- Production `player-web` loads `Antarctica` resolver/config from the published bundle, not from static local registration.
- Editor preview still loads `preview` bundle by `contentSourceId` and refreshes after plugin source change.
- `simple-choice` remains plugin-free and works through default manifest-driven path.
- Unsupported `apiVersion` fails publish and fails closed in `player-web`.
- Published bundle bytes are content-addressed and served with immutable cache headers.
- No production path reads plugin source from `games/<gameId>/plugins/<pluginId>/`.

## Validation

Required checks:

```bash
git diff --check
npm run verify:player-web
npm run verify:runtime-api
npm run verify:manifest-authoring
npm run verify:game-agnostic
npm run test:e2e -- apps/editor-web/e2e/editor-session-preview.spec.ts
rg -n "editor-engine" apps/player-web services/runtime-api
rg -ni "gameId ===|antarctica" apps/player-web services/runtime-api packages/contracts
rg -n "apps/player-web/src/plugins/antarctica|@/plugins/antarctica|presenter/antarctica-config-data" .
```

Additional checks for this task:

```bash
rg -n "register-games" apps/player-web
rg -n "scope.*published|scope.*preview" packages/contracts services/runtime-api apps/player-web
```

## Open Questions

- Resolved: published metadata lives at `games/<gameId>/published/player-web-plugin-bundles.json`.
- Resolved for first slice: CDN/object storage is not required; runtime-api serves hash-addressed bundles and keeps the URL contract CDN-compatible.
- Deferred: optional `modulepreload` can be added later if performance data shows it is needed.

## Handoff Log

- 2026-05-31: Task created. ADR-039 updated to accept the production/published bundle handoff model.
- 2026-05-31: Implemented production/published handoff. Added published metadata schema, bundle builder, Antarctica published artifacts, runtime-api published bundle loading/serving, player-web scope-aware loader, tests and manifest-authoring drift checks. Removed the old static `register-games.ts` bridge.
