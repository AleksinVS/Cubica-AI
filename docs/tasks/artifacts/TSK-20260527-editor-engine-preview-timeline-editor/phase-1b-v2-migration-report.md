# Phase 1B Report: Full Authoring Manifest Migration To V2

## Оглавление

- [1. Понимание этапа](#1-понимание-этапа)
- [2. Миграционный подход](#2-миграционный-подход)
- [3. Что изменено](#3-что-изменено)
- [4. Итоговая структура](#4-итоговая-структура)
- [5. Проверки](#5-проверки)
- [6. Остаточные ограничения](#6-остаточные-ограничения)

## 1. Понимание этапа

Phase 1B завершает первый архитектурный этап: существующие authoring-манифесты больше не являются prototype-heavy v1 документами. Они переведены на semantic authoring v2, где реальные game/UI сущности живут в `root`, а `_label` хранит editor-facing имя сущности.

В этом отчете **authoring-манифест** означает редактируемый source JSON. Generated runtime manifests остаются выходом компилятора.

## 2. Миграционный подход

Миграция выполнена скриптом `scripts/manifest-tools/migrate-authoring-v2.cjs`.

Причина: большие JSON-файлы нельзя безопасно переписывать вручную в контексте модели. Скрипт строит v2 authoring из текущих generated runtime manifests, добавляет semantic metadata and preserves runtime-facing fields.

Скрипт поддерживает:

- `--dry-run` / `--check` - проверить, что миграция уже применена;
- `--write` - переписать authoring-файлы;
- `--game <id>` - ограничить миграцию одной игрой.

## 3. Что изменено

Мигрированы все текущие authoring-файлы:

| File | Version | `_definitions` | Typed entities with `_label` |
| --- | --- | ---: | ---: |
| `games/antarctica/authoring/game.authoring.json` | `2.0` | 0 | 299 |
| `games/simple-choice/authoring/game.authoring.json` | `2.0` | 0 | 6 |
| `games/antarctica/authoring/ui/telegram.authoring.json` | `2.0` | 0 | 6 |
| `games/antarctica/authoring/ui/web.authoring.json` | `2.0` | 0 | 292 |
| `games/simple-choice/authoring/ui/web.authoring.json` | `2.0` | 0 | 14 |

Typed entities without `_label`: 0 for all migrated authoring manifests.

Generated source maps were rebuilt because source pointers changed from v1 `_definitions` pointers to v2 `root` pointers.

Editor-web local schema registry now points to authoring v2 schemas, so in-editor validation matches the migrated documents.

## 4. Итоговая структура

Game authoring root:

```text
root._type
root._label
root._semantics
root.meta
root.config
root.content
root.engine
root.state
root.logic
```

Game logic:

```text
root.logic.flows[]
root.logic.systems[]
root.logic.rules[]
root.logic.actions[]
root.logic.templates
```

UI authoring root preserves runtime-facing order but changes `screens` from runtime map to authoring array:

```text
root.screens[] -> generated screens map
screen.root -> component tree
component.children[] -> nested UI tree
```

Compiler v2 transforms:

- `root.logic.actions[]` into runtime `actions`;
- `root.logic.templates` into runtime `templates`;
- `root.screens[]` into runtime `screens`;
- authoring-only fields `_type`, `_label`, `_semantics`, `_schemaVersion`, `_manifestType`, `_channel`, `_definitions` are stripped from runtime output.

## 5. Проверки

Phase 1B validation:

```text
node scripts/manifest-tools/migrate-authoring-v2.cjs --dry-run
node scripts/manifest-tools/compile-authoring-manifests.cjs --check --quiet
npm run verify:manifest-authoring
npm run verify:editor-engine
npm test --workspace @cubica/editor-web
npm run verify:editor-web
```

The authoring governance check now requires `_schemaVersion: "2.0"` for repository authoring manifests.

## 6. Остаточные ограничения

- `_definitions` are empty after migration. Reusable prototypes can be reintroduced later only as true prototypes, not as the main container for real content.
- The migration script creates useful labels with deterministic heuristics. Some labels still include technical ids or English source names where the current runtime content has no Russian title.
- `root.logic.flows[]` is derived from available runtime content. Future timeline work should refine chronology semantics rather than treating this migration output as a final narrative model.
