# TSK-20260630-editor-engine-modularization: Split oversized editor modules and schema-driven role inference

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Current Findings](#current-findings)
- [Target State](#target-state)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

planned

## Understanding

Работа понята так: редакторный слой накопил незадокументированный структурный долг -
один файл `editor-engine` на 5400 строк, компонент `EditorWorkspace` на ~2500 строк, и
инференс ролей по английским подстрокам вместо схемы. Нужно разбить эти модули и
сделать инференс ролей schema-driven, без изменения поведения редактора.

## Architecture Source

- `docs/architecture/adrs/052-editor-entity-projection-sidecar.md`
- `docs/architecture/adrs/034-editor-engine-authoring-manifest-editor.md`
- `docs/architecture/adrs/036-semantic-authoring-and-preview-timeline-editor.md`
- `docs/architecture/adrs/025-json-schema-as-ssot-for-manifest-validation.md`
- `docs/reviews/2026-06-27-full-project-review.md` (разделы 1.1.E, 3 editor)
- `docs/legacy/debt-log.csv` (LEGACY-0018, LEGACY-0019)

## Why

`editor-engine/index.ts` содержит несвязанные обязанности (JSON pointer/patch, graph,
entity projection, preview, schema, prototype extraction, эвристики ролей) в одном
файле - это главная проблема сопровождения и мешает находить мёртвый код. Инференс
ролей по английским токенам молча деградирует для не-английских манифестов.

## Current Findings

1. `packages/editor-engine/src/index.ts` - ~5400 строк, один модуль.
2. `apps/editor-web/src/components/editor-workspace.tsx:511-3045` - ~2500 строк, 63
   `useState`, 20 `useEffect`, 2 `useCallback`.
3. `packages/editor-engine/src/index.ts:5090-5138` - классификация узлов по подстрокам
   английских слов (`screen/page/view`, `step/stage/...`) вместо `_type`/`role`/схемы.
4. Мёртвые/только-тестовые экспорты: `buildEditorEntityYamlProjection` (`:1888`),
   `createStaticPreviewRendererAdapter` (`:1782`), `previewRectsIntersect` (`:1720`),
   `TreeViewModelBuilder` (`:299`). Пустой интерфейс
   `BuildEntityTreeViewModelInput extends BuildTreeViewModelInput {}` (`:290`).
   `isPlainJsonObject` дублируется в 3 файлах.

## Target State

1. `editor-engine` разбит на связные модули (`json-pointer-patch`, `graph-projection`,
   `entity-projection`, `preview`, `schema`, `prototype-extraction`, `role-inference`),
   ре-экспортируемые из `index.ts` для обратной совместимости импортов.
2. `EditorWorkspace` декомпозирован: состояние через `useReducer`/хуки, панели
   (graph, JSON tree, property, preview, agent chat) - дочерние компоненты;
   мемоизированные хендлеры.
3. Инференс ролей опирается на `_type`/`role`/аннотации схемы; substring-эвристика -
   только явный fallback с документированным ограничением.
4. Удалены мёртвые экспорты, пустой интерфейс и дубли `isPlainJsonObject`.

## Scope

- Рефакторинг `packages/editor-engine/src/index.ts` (поведение неизменно, тесты те же).
- Декомпозиция `apps/editor-web/src/components/editor-workspace.tsx`.
- Перевод role inference на schema-driven.
- Чистка мёртвых экспортов и дублей.

## Non-Goals

- Не менять поведение редактора и контракты проекции.
- Не чинить баг инверсии массива (это correctness TSK).
- Не вводить новый persisted sidecar (запрещено ADR-052).

## Execution Plan

### Phase 1. editor-engine split

1. Выделить модули по обязанностям; `index.ts` оставить тонким фасадом ре-экспортов.
2. Сохранить публичный API; прогнать `verify:editor-engine` после каждого выделения.

### Phase 2. Dead-export pruning

1. Удалить/привязать мёртвые экспорты и пустой интерфейс; вынести `isPlainJsonObject`
   в общий util и переиспользовать в editor-web.

### Phase 3. Schema-driven role inference

1. Заменить substring-классификацию на чтение `_type`/`role`/аннотаций схемы.
2. Оставить substring как явный fallback с тестом и записью в debt-log (LEGACY-0019).

### Phase 4. EditorWorkspace decomposition

1. Ввести `useEditorWorkspaceState` (reducer) и вынести панели в дочерние компоненты.
2. Мемоизировать хендлеры; сохранить e2e-поведение.

### Phase 5. Closeout

1. Обновить статус, Handoff Log, `NEXT_STEPS.md`; обновить/снять LEGACY-0018/0019.

## Acceptance

- `editor-engine/index.ts` - тонкий фасад; обязанности в отдельных модулях.
- `EditorWorkspace` разбит, состояние через reducer/хуки.
- Инференс ролей schema-driven; не-английские манифесты не деградируют молча.
- Мёртвые экспорты и дубли удалены.
- `verify:editor-engine`, typecheck editor-web и e2e зелёные; поведение не изменилось.

## Validation

```text
npm run verify:editor-engine
npm run typecheck --workspace @cubica/editor-web
npm run test:e2e
```

## Risks

- Большой рефакторинг может задеть импорты по всему editor-web - двигаться малыми
  срезами с зелёными проверками между ними.

## Handoff Log

- 2026-06-30: задача создана по результатам полного ревью; покрывает LEGACY-0018/0019.
