# TSK-20260613 Execution Matrix

## Оглавление

- [Purpose](#purpose)
- [Decision Coverage](#decision-coverage)
- [Implementation Status](#implementation-status)
- [Non-Negotiable Invariants](#non-negotiable-invariants)
- [Execution Slices](#execution-slices)
- [Candidate Scoring](#candidate-scoring)
- [Validation Gates](#validation-gates)
- [Promotion Checklist](#promotion-checklist)
- [AI-Assisted Designer Boundaries](#ai-assisted-designer-boundaries)
- [Handoff Checklist](#handoff-checklist)

## Purpose

Эта матрица переводит ADR-050 в проверяемые implementation slices. Она нужна, чтобы исполнитель мог выбрать маленький следующий шаг, не смешивая архитектурные решения, runtime migration и UI/editor работу в один большой change.

## Decision Coverage

| Variant | Status | Execution Meaning |
| --- | --- | --- |
| A. Local extraction | Accepted | Начинаем с game-level prototype внутри конкретной игры или authoring-файла. |
| B. Two-level prototypes | Accepted | Локальный прототип может стать platform-level только через ручное повышение и checklist. |
| D. AI-assisted designer | Accepted | ИИ предлагает proposal и `EditorChangeSet`, но не применяет и не повышает автоматически. |
| C. Automatic platform promotion | Rejected | Не реализовывать. Автоматическое повышение создает риск game-specific drift в платформе. |

## Implementation Status

| Slice | Status | Notes |
| --- | --- | --- |
| A1. Proposal contract | Implemented first slice | `packages/editor-engine` exports `createPrototypeExtractionProposal` with definition pointer, common body, instance overrides, runtime-diff expectation, source-map impact, validation gates and `EditorChangeSet`. |
| A2. Discovery scoring | Implemented first slice | `discoverPrototypeExtractionCandidates` groups authoring objects by normalized structure and returns scoring/risk fields. |
| A3. Local extraction apply | Implemented review staging | Proposal creates `_definitions` and replacement operations; editor-web route dry-runs the `EditorChangeSet`, and `editor.preparePrototypeChangeSet` can manually stage it as the planned ChangeSet without applying it. |
| A4. Source map proof | Implemented server gate | `planPrototypeExtractionForEditor` compiles before/after, verifies canonical runtime diff and checks source-map pointers. Browser preview selection proof remains follow-up e2e work. |
| B1. Promotion governance | Implemented as process doc | Checklist exists in this artifact, ADR-050 and `docs/processes/authoring-prototype-promotion.md`; no platform catalog is created yet. |
| D1/D2. AI-assisted designer | Implemented read-only proposal + manual staging | `editor.proposePrototypeExtraction` calls the read-only route and stores proposal separately from apply flow; `editor.preparePrototypeChangeSet` requires passed gates and only then stages the ChangeSet for the existing dry-run/apply path. Plain-language explanation remains follow-up. |

## Non-Negotiable Invariants

| Invariant | Required Control |
| --- | --- |
| Runtime/player не резолвят authoring-прототипы. | Нет новых handlers или branches в `runtime-api`/`player-web` для `_definitions`, `_type`, `_extends`. |
| Generated runtime manifests чистые. | Leakage scan по `_definitions`, `_type`, `_extends`, `_promptTemplate`, `_prototypeImports`, `_source_trace`. |
| JSON Schema остается источником истины. | Структурная validation идет через schemas/AJV, не через ручные TypeScript guards вместо schema. |
| Чистое extraction не меняет runtime output. | Canonical runtime diff до/после применения proposal. |
| Platform promotion не автоматическая. | Promotion checklist и ручная classification "general vs game-specific". |
| Source maps остаются пригодными для editor/preview. | Pointer existence check после compile. |
| AI не применяет изменения напрямую. | AI output ограничен proposal + `EditorChangeSet`, применение через dry-run/approval. |

## Execution Slices

| Slice | Goal | Main Files/Areas | Done When |
| --- | --- | --- | --- |
| P0. Baseline targets | Выбрать первые безопасные authoring targets и baseline outputs. | `games/*/authoring/**`, generated manifests, source maps | Есть список targets, baseline compile проходит или documented unrelated failure записан. |
| A1. Proposal contract | Ввести единый формат prototype extraction proposal. | `packages/editor-engine`, `apps/editor-web`, tests/docs | Proposal содержит pointers, body, overrides, diff, source-map impact, gates, inverse summary. |
| A2. Discovery scoring | Найти похожие authoring-узлы по normalized structure. | editor-engine/tooling | Scoring объясняет similarity и over-extraction risk. |
| A3. Local extraction apply | Сгенерировать локальный `_definitions` entry и instance overrides. | authoring compiler/editor change flow | Dry-run показывает нулевой runtime diff, apply идет через `EditorChangeSet`. |
| A4. Source map proof | Доказать, что editor/preview pointers не потеряны. | compiler source maps, editor tests | Все affected pointers существуют после compile. |
| B1. Promotion governance | Описать поддерживаемый путь `game-level -> platform-level`. | process docs/task artifact | Есть checklist с classification, examples, tests, versioning, migration guidance. |
| B2. Platform catalog prework | Подготовить отдельную structural task для platform catalog. | future `packages/authoring-prototypes/` | Не создается runtime dependency; home и import contract согласованы отдельно. |
| D1. AI suggestion capability | Разрешить ИИ предлагать prototype proposal. | agent/editor integration | AI возвращает proposal, explanation и optional `EditorChangeSet`, но не apply. |
| D2. AI validation parity | Прогнать AI proposal через те же gates, что ручной extractor. | agent tests/editor tests | Нет обхода schema, compile, diff, source-map и approval gates. |
| Closeout | Синхронизировать docs и handoff. | TSK, artifacts, `NEXT_STEPS.md`, structure | Handoff обновлен, структура регенерирована при новых каталогах. |

## Candidate Scoring

Первый scoring должен быть простым и объяснимым. Не нужно строить сложную эвристику до появления реальных examples.

| Factor | Good Signal | Bad Signal |
| --- | --- | --- |
| Repetition count | 3+ похожих узла или 2 крупных стабильных узла | Один случай без явного class-of-elements |
| Shared structure | Совпадают тип, layout shape, handlers/effects shape | Совпадают только имена или тексты |
| Override size | Instance overrides меньше общего body | Overrides почти такие же большие, как prototype |
| Runtime diff | Нулевой canonical diff | Generated output меняется без migration task |
| Readability | `_type` и parameters понятнее копий | Нужно прыгать между файлами для понимания простого элемента |
| Generality | Паттерн встречается в двух играх/каналах | Паттерн содержит локальный game id, screen id, asset path или текст |

## Validation Gates

Каждый accepted proposal должен пройти:

1. Authoring JSON Schema validation.
2. Compiler dry-run.
3. Generated runtime manifest validation.
4. Authoring-only leakage scan.
5. Canonical runtime diff.
6. Source map pointer existence check.
7. Editor dry-run with inverse `EditorChangeSet`.
8. Semantic diagnostics for `_label`, `_semantics`, `_promptTemplate`.
9. Manual approval before apply.

Recommended review commands:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
npm run verify:editor-engine
npm run verify:editor-web
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json
git diff --check
```

## Promotion Checklist

Локальный прототип можно предложить как platform-level prototype только если:

1. Есть минимум два независимых use case или доказанный класс игр/каналов.
2. Удалены или параметризованы game-specific fields.
3. Есть `_semantics`, объясняющий общий смысл прототипа.
4. Есть `_promptTemplate`, если прототип используется для создания или уточнения элементов через редактор.
5. Есть authoring schema example.
6. Есть compiler/validation coverage.
7. Есть migration guidance для локальных пользователей.
8. Есть versioning policy для breaking changes.
9. Записана classification "general vs game-specific".
10. Promotion оформлен как ручное architecture/process решение, не как автоматический результат extractor.

## AI-Assisted Designer Boundaries

AI-assisted designer может:

- находить похожие группы;
- предлагать имя прототипа;
- выделять common body и instance overrides;
- писать `_semantics` и `_promptTemplate`;
- готовить proposal и optional `EditorChangeSet`;
- объяснять риск over-extraction.

AI-assisted designer не может:

- применять изменения без approval envelope;
- повышать прототип до platform-level;
- обходить JSON Schema, compiler dry-run или runtime diff;
- добавлять runtime branches под конкретную игру;
- объявлять game-specific паттерн платформенным на основании одного использования.

## Handoff Checklist

Перед остановкой работы исполнитель должен обновить:

- active task `Handoff Log`;
- статус relevant slices в этой матрице, если они были начаты;
- список changed files;
- выполненные validation commands и их результат;
- следующий безопасный шаг;
- known risks или unrelated failures.
