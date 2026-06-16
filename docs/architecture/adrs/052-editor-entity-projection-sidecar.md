# ADR-052: Editor Entity Projection Sidecar

- **Дата**: 2026-06-15
- **Статус**: Draft
- **Авторы**: Codex
- **Компоненты**: `packages/editor-engine`, `apps/editor-web`, Manifest Authoring, UI Authoring, Manifest Compiler, Editor Preview
- **Связанные решения**: ADR-025, ADR-030, ADR-034, ADR-036, ADR-037, ADR-048, ADR-049, ADR-050

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Границы источников истины](#5-границы-источников-истины)
- [6. Минимальная форма sidecar](#6-минимальная-форма-sidecar)
- [7. Построение и жизненный цикл](#7-построение-и-жизненный-цикл)
- [8. Работа редактора](#8-работа-редактора)
- [9. Валидация и drift diagnostics](#9-валидация-и-drift-diagnostics)
- [10. Архитектурные инварианты](#10-архитектурные-инварианты)
- [11. Отклоненные альтернативы](#11-отклоненные-альтернативы)
- [12. Последствия](#12-последствия)
- [13. Открытые вопросы](#13-открытые-вопросы)
- [14. Связанные артефакты](#14-связанные-артефакты)

## 1. Понимание решения

Решение понято так: разработчик игры не мыслит отдельными файлами
`game.authoring.json` and `ui/<channel>.authoring.json`. Для него сцена,
карточка, выбор, шаг, экран, метрика или действие являются одним игровым
объектом, даже если их смысл, содержание и отображение хранятся в разных
authoring-манифестах.

Текущий редактор уже строит tree, graph, property panel and preview из
authoring JSON, но фактически остается привязанным к одному активному
документу. Нужно добавить проектный слой, который связывает несколько
authoring-документов в единую модель сущностей редактора, не создавая нового
источника истины для игры.

## 2. Контекст

Cubica разделяет игру на несколько авторских и runtime-слоев:

- логика и правила игры живут в game authoring manifest;
- содержание игры, игровые элементы и состояние тоже живут в game authoring
  manifest;
- визуализация по каналам живет в UI authoring manifests;
- runtime получает только скомпилированные `game.manifest.json` and
  `ui.manifest.json`.

ADR-034 запретил делать flow-chart или tree собственным source of truth.
ADR-036 перенес редактор к preview-first подходу и semantic entity tree, но
текущий entity tree строится из одного открытого authoring JSON. Из-за этого
редактор хорошо показывает структуру файла, но хуже показывает целостный
игровой объект, который пересекает несколько файлов и каналов.

Нужен промежуточный редакторский слой, который:

- объединяет logic, content and view pointers в одну editor entity;
- помогает preview selection, property panel, AI context and diagnostics;
- остается полностью пересобираемым из authoring sources;
- не попадает в runtime-api, player-web or manifest compiler как обязательный
  runtime input.

## 3. Термины

- **Editor entity** - единая сущность редактора: смысловой игровой объект,
  который может иметь источники в game authoring manifest, одном или нескольких
  UI authoring manifests, design artifacts or project-local plugins.
- **Projection sidecar** - сопутствующий файл-проекция: JSON-индекс, который
  хранит связи между editor entity and source JSON Pointers. Он помогает
  редактору, но не является источником истины для игры.
- **Source facet** - грань editor entity: логика, содержание, состояние,
  отображение, дизайн, plugin contribution или диагностика связи.
- **Authoring source** - редактируемый исходный JSON-документ, из которого
  компилируются runtime manifests.
- **Generated runtime manifest** - скомпилированный JSON для runtime-api and
  player-web. Его можно пересобрать из authoring sources.
- **JSON Pointer** - стандартный строковый адрес узла внутри JSON-документа,
  например `/root/logic/actions/0`.
- **EditorChangeSet** - набор изменений редактора, который может включать
  JSON Patch для authoring-файлов and related project-file changes.
- **Drift diagnostics** - диагностика расхождения между sidecar and authoring
  sources: устаревшие hashes, несуществующие pointers, неоднозначные связи or
  потерянные каналы отображения.

## 4. Решение

Cubica принимает draft-направление: добавить **Editor Entity Projection
Sidecar** как project-level projection for editor workflows.

1. Sidecar является tooling-only artifact and may be persisted under
   `games/<gameId>/authoring/editor.entities.json` when durable editor state is
   needed.
2. Sidecar строится из authoring manifests, source maps, schema/projection
   rules, renderer adapter metadata and optional editor-only grouping hints.
3. Sidecar хранит editor entities and links to source JSON Pointers, not copies
   of game logic, content or UI trees.
4. All durable gameplay or visual changes still write back to authoring sources
   through `EditorChangeSet` and JSON Patch.
5. Runtime-api and player-web must never read `editor.entities.json`.
6. If sidecar is deleted, game behavior, generated runtime manifests and
   published player output must remain recoverable from authoring sources.

This sidecar upgrades the editor from a single-document surface to a
project-level editor surface. Single-document surface means one open authoring
JSON is the main editing unit. Project-level editor surface means the main
editing unit is an editor entity assembled from multiple authoring files.

## 5. Границы источников истины

Source of truth remains:

- `game.authoring.json` for game logic, game content, state model, actions,
  rules and chronology;
- `ui/<channel>.authoring.json` for channel-specific visualization;
- project-local plugin files for trusted plugin code and plugin manifests;
- design artifact JSON files for visual design metadata;
- generated runtime manifests only as compiler output.

Sidecar may own only editor-only information:

- stable editor entity IDs when they are not gameplay IDs;
- entity grouping hints that do not affect runtime behavior;
- cached source hashes;
- source pointer lists;
- derived labels and summaries that can be recomputed or invalidated;
- unresolved candidate links and drift diagnostics;
- editor navigation preferences that are not already covered by
  `editor.layout.json`.

If a link changes gameplay behavior, player-visible rendering, available
actions, state transitions or channel output, that link belongs in authoring
sources, not only in sidecar.

## 6. Минимальная форма sidecar

The first durable shape should stay small and schema-validated:

```json
{
  "schemaVersion": "1.0",
  "gameId": "antarctica",
  "sourceHashes": {
    "game.authoring.json": "sha256:...",
    "ui/web.authoring.json": "sha256:..."
  },
  "entities": {
    "step:i17": {
      "kind": "game-step",
      "label": "Информационный экран i17",
      "primarySource": {
        "file": "game.authoring.json",
        "pointer": "/root/logic/flows/0/steps/17"
      },
      "facets": {
        "logic": [
          {
            "file": "game.authoring.json",
            "pointer": "/root/logic/flows/0/steps/17"
          }
        ],
        "content": [
          {
            "file": "game.authoring.json",
            "pointer": "/root/content/infos/i17"
          }
        ],
        "views": [
          {
            "channel": "web",
            "file": "ui/web.authoring.json",
            "pointer": "/root/screens/3"
          }
        ]
      }
    }
  },
  "diagnostics": []
}
```

The sidecar schema must forbid storing arbitrary nested copies of source
objects. Values such as label and kind are convenience metadata only and must
have clear derivation or invalidation rules.

## 7. Построение и жизненный цикл

The projection builder should run in `packages/editor-engine` or a dedicated
framework-agnostic package used by `editor-web`.

Inputs:

- game authoring manifest;
- all UI authoring manifests for the selected game;
- existing source-map files when available;
- authoring schemas and field dictionary;
- renderer adapter metadata from preview when available;
- project-local plugin contribution metadata when relevant.

Outputs:

- in-memory `EditorEntityProjection` for current editor session;
- optional persisted `editor.entities.json`;
- drift diagnostics routed to tree, property panel, preview overlay and AI
  context.

Lifecycle rules:

1. Rebuild sidecar whenever source hashes change.
2. If persisted sidecar hash does not match sources, mark it stale and rebuild
   before use.
3. If a pointer no longer resolves, preserve the entity as unresolved only for
   diagnostics and repair suggestions.
4. A save operation may update sidecar after authoring files are saved.
5. Preview sessions may keep temporary projections in session worktrees, but
   runtime preview receives generated manifests only.

## 8. Работа редактора

Editor surfaces should use editor entities as the user-facing navigation unit.

Expected behavior:

- left tree shows editor entities, not only file-local nodes;
- property panel groups fields by source facet: logic, content, view, state,
  design and plugin;
- selecting a preview object resolves to one editor entity and then to its
  source pointers;
- Monaco can reveal every source pointer involved in the selected entity;
- AI assistant receives scoped entity projection, not whole authoring files;
- ChangeSet generation writes patches to original authoring files.

For example, selecting one scene can show:

- scenario step from `game.authoring.json`;
- text/content block from `game.authoring.json`;
- web screen from `ui/web.authoring.json`;
- telegram screen from `ui/telegram.authoring.json`;
- related runtime source-map entries;
- diagnostics for missing actions, stale view bindings or unresolved content
  references.

The editor must make cross-file ownership visible. A field shown in one
property panel should still display which authoring file and JSON Pointer it
will modify.

## 9. Валидация и drift diagnostics

Before durable persistence, sidecar needs a JSON Schema, tentatively:
`docs/architecture/schemas/editor-entity-projection.schema.json`.

Validation gates:

- sidecar schema validation;
- source file existence;
- source hash check;
- JSON Pointer existence check;
- no arbitrary source object copies;
- no runtime-only generated pointers as sole source;
- no game-specific platform code assumptions;
- authoring validation after every ChangeSet;
- compiler validation against runtime manifests after save or preview compile.

Drift diagnostics should be non-destructive. The editor can propose repair
ChangeSets, but it cannot silently create or remove authoring links just to
make sidecar clean.

## 10. Архитектурные инварианты

- Authoring manifests remain the source of truth.
- Sidecar is a projection/index, not a gameplay or UI contract.
- Runtime-api and player-web do not read editor sidecars.
- Manifest compiler does not require sidecar to produce runtime manifests.
- All game-visible changes go through authoring JSON and validation.
- Sidecar deletion cannot change player-visible behavior.
- Editor entity IDs must be stable enough for editor UX but cannot replace
  gameplay IDs.
- Cross-channel UI remains explicit: web, telegram, phaser and future channels
  can contribute separate view facets to one editor entity.
- Platform core must not hardcode concrete game entity kinds.
- Sidecar schema and builder must stay game-agnostic.

## 11. Отклоненные альтернативы

### A. Keep The Editor Strictly Single-Document

Rejected. It preserves a clean implementation boundary, but it keeps the author
working with files instead of whole game objects and makes cross-file
diagnostics, preview selection and AI context weaker.

### B. Make A New Canonical Editor Manifest

Rejected. A canonical editor manifest would become a third source of truth
between authoring and runtime, creating drift and unclear ownership.

### C. Merge UI Authoring Into Game Authoring

Rejected. It would simplify editor linking for one channel but would weaken
channel separation and make web, telegram, phaser and future renderers harder
to evolve independently.

### D. Use Generated Runtime Manifests As Editor Model

Rejected. Runtime manifests are compiler output and intentionally strip
authoring-only metadata such as `_label`, `_semantics`, `_prompt` and prototype
structure. Editing generated output would lose authoring intent.

### E. Store All Cross-File Links Only In Sidecar

Rejected. Links that affect behavior or rendering must live in authoring
sources. Sidecar may store editor-only grouping hints, unresolved candidates and
cached indexes, but not the only copy of meaningful game links.

## 12. Последствия

Positive consequences:

- editor can present one coherent game object across logic, content and view;
- preview selection and property panel can operate across multiple authoring
  files;
- AI context becomes smaller and more relevant;
- cross-file diagnostics become first-class;
- authoring/runtime source-of-truth boundaries remain intact.

Costs and risks:

- requires a new projection builder and likely a JSON Schema;
- stale sidecar handling must be rigorous;
- entity identity and grouping rules need careful design;
- cross-file ChangeSet UI becomes more complex;
- manual editor-only grouping can confuse users if it looks like game logic.

## 13. Открытые вопросы

- Should the persisted path be exactly
  `games/<gameId>/authoring/editor.entities.json` or a nested editor directory?
- Which sidecar fields are allowed to be committed, and which must stay
  session-only?
- Should tree collapse/expand state move into this sidecar or remain separate
  from `editor.layout.json`?
- How should manual editor-only grouping be represented so it is not confused
  with gameplay links?
- Which entity kinds should the first builder support: steps, screens, actions,
  cards, metrics, object types, or all semantic `_type` instances?
- Should sidecar generation be part of `verify:manifest-authoring` or a
  separate advisory gate first?

## 14. Связанные артефакты

- `docs/architecture/adrs/030-semantic-prototype-manifests.md`
- `docs/architecture/adrs/034-editor-engine-authoring-manifest-editor.md`
- `docs/architecture/adrs/036-semantic-authoring-and-preview-timeline-editor.md`
- `docs/architecture/adrs/048-element-authoring-prompt-contract.md`
- `docs/architecture/adrs/049-dynamic-element-prompt-projection-and-sync-strategy.md`
- `packages/editor-engine/src/index.ts`
- `apps/editor-web/src/lib/editor-web-adapter.ts`
- `apps/editor-web/src/lib/editor-repository.ts`
