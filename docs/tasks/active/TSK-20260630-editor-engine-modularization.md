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

implemented (2026-07-05) — Phases 1–4 done

Выполнены Phase 1 (разбиение `editor-engine/index.ts` на 14 связных модулей +
тонкий фасад), Phase 2 (dedup `isPlainJsonObject`, удаление пустого интерфейса,
пометка test-only экспортов), Phase 3 (authoritative schema-driven role inference
с документированным substring-fallback) и Phase 4 (декомпозиция
`editor-workspace.tsx`: 4351 → 57 строк, контроллер `useEditorWorkspace` +
5 доменных state-хуков + презентационные панели в `workspace/`). Публичная
поверхность (`@cubica/editor-engine`) сохранена, поведение неизменно:
`verify:editor-engine` (38), editor-web typecheck + 105 unit, **editor e2e 8/8**
через `npm run test:e2e:prod`. LEGACY-0018 снят, LEGACY-0019 задокументирован.

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
- 2026-07-04: Phases 1–3 реализованы (поведение-сохраняющий рефакторинг).
  - **Phase 1:** `packages/editor-engine/src/index.ts` (5428 строк) → тонкий
    фасад (91 строка), реэкспортирующий 14 связных модулей: `types`, `shared`
    (dependency-free JSON/token/diagnostic helpers, канонический
    `isPlainJsonObject`), `json-pointer-patch` (включая сохранённый array-insert
    inverse fix), `document-store`, `change-set`, `tree-view`, `graph-projection`,
    `role-inference`, `semantics` (cross-cutting предикаты — вынесены отдельно во
    избежание циклов), `preview`, `entity-projection`, `schema`,
    `prototype-extraction`, `reverse-projection`. Имена экспортов не менялись;
    facade реэкспортирует публичные функции явно + все типы через `export *`
    (внутренние cross-module хелперы НЕ утекают в публичную поверхность).
  - **Phase 2:** канонический `isPlainJsonObject` в `shared.ts`, дубль в
    `apps/editor-web/src/lib/agent-context-projection.ts` заменён на импорт
    (копия в `editor-workspace.tsx` оставлена — это Phase 4). Пустой интерфейс
    `BuildEntityTreeViewModelInput` → type-alias. Экспорты
    `buildEditorEntityYamlProjection`, `createStaticPreviewRendererAdapter`,
    `previewRectsIntersect`, `TreeViewModelBuilder` подтверждены как test-only
    (нет production-потребителя) и помечены комментарием; тесты не менялись.
  - **Phase 3:** `inferSemanticRole` теперь сначала консультирует authoritative
    сигнал (`_type`/`role`/`_semantics` через data-driven
    `AUTHORITATIVE_ROLE_BY_TOKEN`), и только при его отсутствии применяет
    английскую substring-эвристику как явный документированный fallback
    (LEGACY-0019). Регресс-тесты: кириллический путь с явным `role`/`_type`
    классифицируется верно; fallback по-прежнему работает без явного сигнала.
  - **Проверки:** `verify:editor-engine` (typecheck + 38 тестов, было 36 + 2 новых),
    editor-web typecheck и `npm test @cubica/editor-web` (105 тестов) — зелёные.
    `validate-legacy` — те же 30 baseline-маркеров, ни одного нового и ни одного
    в `editor-engine/src`. `debt-log.csv`/`stubs-register.md` обновлены (LEGACY-0018
    engine-split done / component-decomp deferred; LEGACY-0019 authoritative-first
    landed, fallback documented).
  - **Отложено (Phase 4):** декомпозиция `editor-workspace.tsx` (reducer/хуки,
    дочерние панели) — отдельный срез с e2e-приёмкой; последняя копия
    `isPlainJsonObject` живёт там.
- 2026-07-05: **Phase 4 разблокирована** (в рамках TSK-20260704, срез A): editor
  e2e теперь 4/4 на этом хосте через `npm run test:e2e:prod` (prod-режим серверов,
  без компиляции во время тестов); два интерактивных теста чинились обновлением
  устаревших ожиданий спека, а не машиной ≥8 ядер (детали —
  `docs/reviews/2026-07-05-remediation-closeout-and-e2e-blockers.md` §7).
  Gate декомпозиции: typecheck + unit editor-web + build + editor e2e 4/4.
  Выполняется следующим срезом оркестрации TSK-20260704.
- 2026-07-05 (позже): **Phase 4 выполнена** (срез B оркестрации TSK-20260704,
  Opus-субагент). `editor-workspace.tsx` (4351 строки) → тонкая композиция
  (57 строк) + `apps/editor-web/src/components/workspace/` (17 файлов):
  `types`/`constants`, презентационные панели (toolbar, activity bar,
  left/right sidebar, preview stage, status bar, property panel, timeline,
  ai-chat, trace details, semantic-graph), `api-client` (fetch-обёртки
  `/api/editor/*`), `agent-surface`, чистые `workspace-helpers`,
  `use-editor-workspace-state` (5 доменных хуков: session/document,
  selection/graph, preview/runtime, ai-patch, layout/ui) и контроллер
  `use-editor-workspace` (эффекты/хендлеры перенесены дословно).
  Последний дубль `isPlainJsonObject` заменён каноническим импортом из
  `@cubica/editor-engine`. Осознанные решения: доменные хуки вместо
  useReducer (сохранение батчинг/functional-update семантики без
  behavior-риска); новая мемоизация не добавлялась (панели получают объект
  контроллера — useCallback не сократил бы ре-рендеры; профиль ре-рендеров
  не изменился). Хвост: `use-editor-workspace.ts` ~2440 строк — дальнейшее
  разрезание контроллера на доменные хендлер-хуки возможно отдельным срезом.
  Гейт: verify:editor-engine 38, editor-web typecheck + 105 unit,
  `npm run test:e2e:prod` 8/8 (39.4s). LEGACY-0018 переведён в removed
  (debt-log.csv, stubs-register.md). Задача закрыта.
