# ADR-052: In-Memory Editor Entity Projection And Optional Hints Sidecar

- **Дата**: 2026-06-16
- **Статус**: Accepted
- **Авторы**: Codex
- **Компоненты**: `packages/editor-engine`, `apps/editor-web`, Manifest Authoring, UI Authoring, Manifest Compiler, Editor Preview, Agent UI
- **Связанные решения**: ADR-025, ADR-030, ADR-034, ADR-036, ADR-037, ADR-048, ADR-049, ADR-050

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Решение](#4-решение)
- [5. Границы источников истины](#5-границы-источников-истины)
- [6. In-memory projection shape](#6-in-memory-projection-shape)
- [7. Optional hints sidecar](#7-optional-hints-sidecar)
- [8. Построение и жизненный цикл](#8-построение-и-жизненный-цикл)
- [9. Работа редактора](#9-работа-редактора)
- [10. Валидация и диагностика](#10-валидация-и-диагностика)
- [11. Архитектурные инварианты](#11-архитектурные-инварианты)
- [12. Отклоненные и отложенные альтернативы](#12-отклоненные-и-отложенные-альтернативы)
- [13. Последствия](#13-последствия)
- [14. Открытые вопросы реализации](#14-открытые-вопросы-реализации)
- [15. Связанные артефакты](#15-связанные-артефакты)

## 1. Понимание решения

Решение понято так: разработчик игры работает не с отдельными файлами
`game.authoring.json` и `ui/<channel>.authoring.json`, а с целостными игровыми
и визуальными сущностями. Сцена, карточка, выбор, экран, действие или метрика
могут иметь смысловую часть в game authoring manifest, визуальную часть в одном
или нескольких UI authoring manifests, а дополнительные сведения в дизайн-
артефактах, source maps или проектных плагинах.

Целевая архитектура должна дать редактору project-level представление таких
сущностей, но не должна создавать третий источник истины рядом с authoring и
runtime manifests. Это общий платформенный механизм редактора, а не механика
конкретной игры.

## 2. Контекст

Cubica разделяет authoring и runtime слои:

- логика игры, содержание, обучающие данные, состояние и действия живут в game
  authoring manifest;
- визуализация по каналам живет в UI authoring manifests;
- runtime получает скомпилированные `game.manifest.json` и
  `ui.manifest.json`;
- редактор по ADR-034 и ADR-036 уже умеет работать с authoring JSON, semantic
  tree, preview selection, source maps, `EditorChangeSet` и session worktrees.

ADR-049 добавил dynamic prompt projection: человек видит собранный промт из
невосстановимой static части и динамической проекции текущего JSON-узла. Для
реальной работы этого подхода редактору нужен способ понять, какие части
нескольких манифестов относятся к одной пользовательской сущности. Такая же
связь нужна для дерева сущностей, панели свойств, выделения в preview и
ограниченного контекста ИИ-помощника.

Ранее рассматривался persisted `editor.entities.json` как полный sidecar
индекс. После критического анализа этот вариант признан слишком рискованным
для первого среза: он дублирует смысловые связи, создает новую точку
рассинхронизации и может выглядеть как источник истины.

## 3. Термины

- **Editor entity** - единая сущность редактора: смысловой игровой или
  визуальный объект, который может иметь источники в нескольких authoring
  файлах, design artifacts и проектных плагинах.
- **EditorEntityProjection** - in-memory проекция: пересобираемый во время
  работы редактора индекс `editor entity -> source facets`. In-memory означает,
  что данные живут в памяти процесса или вкладки и не являются сохраненным
  проектным файлом.
- **Source facet** - грань источника editor entity: логика, содержание,
  состояние, отображение, дизайн, plugin contribution или диагностика связи.
- **Source pointer** - ссылка на исходный узел: пара `file` и JSON Pointer,
  например `game.authoring.json` плюс `/root/logic/actions/0`.
- **Lens** - правило проекции: детерминированная функция редактора, которая
  узнает сущность и ее грани в authoring JSON, source map, схеме или metadata.
- **Projection hints sidecar** - необязательный подсказочный файл рядом с
  authoring manifests. Он может хранить только editor-only подсказки, которые
  нельзя надежно восстановить из источников. Он не хранит копии игровых данных
  и не является обязательным для компиляции.
- **EditorChangeSet** - набор изменений редактора, который содержит JSON Patch
  и связанные изменения проектных файлов. Все durable изменения game/UI
  структуры проходят через этот механизм.

## 4. Решение

Cubica принимает **in-memory `EditorEntityProjection`** как первый и основной
архитектурный слой для project-level editor entities.

1. `EditorEntityProjection` строится в `packages/editor-engine` или близком
   framework-agnostic слое и используется `apps/editor-web`.
2. Проекция пересобирается из authoring manifests, JSON Schema annotations,
   field dictionary, source maps, preview metadata, design artifact metadata и
   project-local plugin metadata.
3. Проекция хранит source pointers и диагностику, но не копирует исходные
   игровые, методические или визуальные узлы.
4. В первом срезе не создается persisted `editor.entities.json`.
5. Будущий persisted файл допустим только как **hints-only sidecar**: файл
   подсказок редактора, где нет канонических связей, поведения, UI-дерева или
   копий source objects.
6. Все durable изменения логики, контента, визуализации, промтов и прототипов
   записываются в authoring sources через `EditorChangeSet`.
7. Runtime-api, player-web и manifest compiler не читают
   `EditorEntityProjection` и не зависят от hints sidecar.

Практика JSON Schema поддерживает этот подход: человеко-читаемые подписи,
описания и подсказки для полей должны по возможности жить в аннотациях схемы
и field dictionary, а не дублироваться в каждом узле манифеста.

## 5. Границы источников истины

Source of truth остается прежним:

- `game.authoring.json` для игровой логики, содержания, обучающих данных,
  состояния, действий, правил и хронологии;
- `ui/<channel>.authoring.json` для channel-specific визуализации;
- schemas and field dictionary для допустимых структур, русских названий
  свойств, описаний и правил отбора значимых полей;
- project-local plugin files для доверенного проектного plugin кода и metadata;
- design artifact JSON files для визуальных артефактов;
- generated runtime manifests только как compiler output.

`EditorEntityProjection` может содержать только производные сведения:

- `entityId`, если он выводится из стабильного source pointer или явного
  authoring ID;
- список source facets;
- labels and summaries, которые можно пересобрать или пометить устаревшими;
- source hashes для обнаружения устаревшей проекции;
- diagnostics, unresolved candidates and preview selection metadata.

Если связь влияет на поведение игрока, доступные действия, состояние, видимый
экран, канал отображения или compiled runtime manifest, эта связь должна жить в
authoring sources, а не только в projection или hints sidecar.

## 6. In-Memory Projection Shape

Минимальная форма in-memory объекта должна оставаться малой и ссылочной:

```json
{
  "projectionVersion": 1,
  "gameId": "antarctica",
  "sourceHashes": {
    "game.authoring.json": "sha256:...",
    "ui/web.authoring.json": "sha256:..."
  },
  "entities": [
    {
      "entityId": "game-step:game.authoring.json#/root/logic/flows/0/steps/17",
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
      },
      "diagnostics": []
    }
  ]
}
```

Форма выше является архитектурным ориентиром, а не финальной JSON Schema.
Финальный контракт должен быть schema-first по ADR-025. Если проекция начнет
передаваться между процессами, сохраняться в кэше или попадать в API, для нее
нужна JSON Schema.

## 7. Optional Hints Sidecar

Persisted sidecar откладывается. Если он понадобится, он должен быть
**projection hints sidecar**, а не полноценный `editor.entities.json`.
Предпочтительный путь для будущего обсуждения:

`games/<gameId>/authoring/editor/projection-hints.json`

Допустимый смысл такого файла:

- пользовательские группы в дереве редактора, если они не являются игровой
  структурой;
- aliases for editor navigation, если их нельзя вывести из `_label`, schemas
  or field dictionary;
- unresolved candidate links, которые ожидают подтверждения;
- suppression decisions для известных editor-only diagnostics;
- ручные hints для линз, если автоматическая привязка неоднозначна.

Недопустимый смысл:

- копии игровых, методических или визуальных узлов;
- единственная копия связи между game step и UI screen;
- поведение действий, transitions, effects, guards or bindings;
- runtime/player configuration;
- generated runtime pointers as the only source.

Пример допустимого hints-only файла:

```json
{
  "schemaVersion": "1.0",
  "gameId": "antarctica",
  "hints": {
    "groups": [
      {
        "id": "editor-group:opening",
        "label": "Вступление",
        "members": [
          {
            "file": "game.authoring.json",
            "pointer": "/root/logic/flows/0/steps/17"
          }
        ]
      }
    ],
    "candidateLinks": []
  }
}
```

Даже этот файл не должен быть первым срезом реализации. Его нужно добавлять
только после того, как in-memory projection докажет пользу и появятся реальные
editor-only данные, которые нельзя восстановить из источников.

## 8. Построение и жизненный цикл

Projection builder работает как слой редактора.

Inputs:

- game authoring manifest;
- all UI authoring manifests for the selected game;
- JSON Schema annotations: `title`, `description`, `default`, custom Cubica
  annotations and meaningful-field markers;
- field dictionary for Russian display labels and property grouping;
- manifest source maps when available;
- renderer/preview selection metadata;
- project-local plugin contribution metadata;
- optional future projection hints sidecar.

Outputs:

- in-memory `EditorEntityProjection`;
- diagnostics for unresolved pointers, ambiguous links, stale hashes and hidden
  technical fields;
- scoped context for AI tools and dynamic prompt projection;
- source pointer groups for property panel and Monaco navigation.

Lifecycle rules:

1. Rebuild projection whenever any input source changes.
2. Treat source hashes as invalidation aids, not as source of truth.
3. If a pointer no longer resolves, keep it only as diagnostic context and
   repair suggestion.
4. Save operations update authoring files first. Projection is rebuilt after
   authoring save or compile validation.
5. Preview sessions may keep temporary projection data in memory or session
   worktrees, but runtime preview still receives generated manifests only.

## 9. Работа редактора

Editor surfaces should use editor entities as the user-facing navigation unit.

Expected behavior:

- left tree shows editor entities, not only file-local JSON nodes;
- property panel groups fields by facets: logic, content, state, view, design
  and plugin;
- preview selection resolves to one editor entity and then to source pointers;
- Monaco can reveal every source pointer involved in the selected entity;
- AI assistant receives scoped projection for the selected entity, not whole
  authoring files;
- dynamic prompt projection from ADR-049 can assemble the visible prompt from
  the selected entity and its significant source facets;
- `EditorChangeSet` writes patches to original authoring files.

Cross-file ownership must be visible. If one property panel edits data from
several files, each edited field must show its source file and pointer.

## 10. Валидация и диагностика

Validation gates:

- authoring manifest schema validation after every accepted `EditorChangeSet`;
- generated runtime manifest validation after compile;
- JSON Pointer existence check for every source pointer in projection;
- no technical properties in user-facing YAML/dynamic prompt projection unless
  they are explicitly marked as meaningful;
- no arbitrary source object copies inside projection or future hints sidecar;
- no game-specific assumptions in platform lenses;
- no runtime-api, player-web or compiler dependency on editor projection.

Diagnostics are non-destructive. The editor can propose repair ChangeSets, but
it cannot silently create, delete or move authoring links just to make the
projection clean.

## 11. Архитектурные инварианты

- Authoring manifests remain the source of truth.
- `EditorEntityProjection` is an editor index, not a gameplay or UI contract.
- Runtime-api and player-web do not read projection or hints sidecar.
- Manifest compiler does not require projection to produce runtime manifests.
- All game-visible changes go through authoring JSON and validation.
- Deleting projection or future hints sidecar cannot change player-visible
  behavior.
- Editor entity IDs must be stable enough for editor UX but cannot replace
  gameplay IDs.
- Cross-channel UI remains explicit: web, telegram, phaser and future channels
  can contribute separate view facets to one editor entity.
- Platform core must not hardcode concrete game entity kinds.
- Projection builder and lenses must stay game-agnostic.

## 12. Отклоненные и отложенные альтернативы

### A. Keep The Editor Strictly Single-Document

Rejected. It preserves a clean implementation boundary, but keeps authors
working with files instead of whole game objects and weakens cross-file
diagnostics, preview selection and AI context.

### B. Persist Full `editor.entities.json`

Rejected for the first architecture slice. A full persisted sidecar would
duplicate meaningful links, create drift and compete with authoring manifests.
The safe subset is a future hints-only file.

### C. Make A New Canonical Editor Manifest

Rejected. A canonical editor manifest would become a third source of truth
between authoring and runtime.

### D. Merge UI Authoring Into Game Authoring

Rejected. It would simplify linking for one channel but weaken channel
separation and future web, telegram, phaser or mobile renderers.

### E. Use Generated Runtime Manifests As Editor Model

Rejected. Runtime manifests are compiler output and intentionally strip
authoring-only metadata such as `_label`, `_semantics`, `_prompt` and prototype
structure.

### F. Store All Cross-File Links Only In Hints

Rejected. Links that affect behavior or rendering belong in authoring sources.
Hints may only help editor grouping, unresolved candidates or diagnostics.

### G. Use Source Maps Only

Rejected as insufficient. Source maps explain compiler provenance, but they do
not provide editor grouping, labels, field dictionary projection, preview
selection semantics or AI context boundaries.

## 13. Последствия

Positive consequences:

- editor can present one coherent game object across logic, content and view;
- preview selection and property panel can operate across multiple authoring
  files;
- AI context becomes smaller and more relevant;
- dynamic prompt projection gets a stable selected-entity boundary;
- cross-file diagnostics become first-class;
- authoring/runtime source-of-truth boundaries remain intact;
- first implementation avoids persisted drift by default.

Costs and risks:

- requires projection builder and lenses;
- entity identity and grouping rules need careful design;
- cross-file ChangeSet UI becomes more complex;
- schema annotations and field dictionary must be maintained carefully;
- optional hints sidecar can still confuse users if it is introduced without
  strict limits.

## 14. Открытые вопросы реализации

These questions are implementation details, not blockers for the accepted
architecture:

- Which entity kinds should the first builder support: steps, screens, actions,
  cards, metrics, object types or only selected `_type` instances?
- What exact derivation rule should generate `entityId` when authoring nodes do
  not have stable IDs?
- Which schema annotations and custom Cubica annotations are enough for Russian
  field labels and hidden technical fields?
- Should future `projection-hints.json` be committed, session-only or split by
  hint type?
- Should projection generation become a blocking CI gate or an advisory editor
  diagnostic first?
- Which UI surfaces consume projection in the first slice: entity tree,
  property panel, preview selection, AI context or all of them?

## 15. Связанные артефакты

- `docs/architecture/adrs/030-semantic-prototype-manifests.md`
- `docs/architecture/adrs/034-editor-engine-authoring-manifest-editor.md`
- `docs/architecture/adrs/036-semantic-authoring-and-preview-timeline-editor.md`
- `docs/architecture/adrs/048-element-authoring-prompt-contract.md`
- `docs/architecture/adrs/049-dynamic-element-prompt-projection-and-sync-strategy.md`
- `docs/architecture/adrs/050-authoring-prototype-extraction-and-promotion.md`
- `docs/architecture/element-prompt-contract.md`
- `docs/processes/editor-prompts.md`
- `packages/editor-engine/src/index.ts`
- `apps/editor-web/src/lib/editor-web-adapter.ts`
