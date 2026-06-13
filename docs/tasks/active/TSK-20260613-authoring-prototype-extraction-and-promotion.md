# TSK-20260613-authoring-prototype-extraction-and-promotion: Извлечение и повышение authoring-прототипов

## Оглавление

- [Status](#status)
- [Implemented First Slice](#implemented-first-slice)
- [Understanding](#understanding)
- [Why](#why)
- [Architecture Baseline](#architecture-baseline)
- [Terms](#terms)
- [Classification](#classification)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Artifacts](#artifacts)
- [Risks And Controls](#risks-and-controls)
- [Handoff Log](#handoff-log)

## Status

implemented-fourth-slice-audit

## Implemented First Slice

Первый срез реализован в `packages/editor-engine` как authoring/tooling API без изменений в `runtime-api` и `player-web`.

Добавлено:

- `discoverPrototypeExtractionCandidates` - поиск повторяющихся authoring-объектов по нормализованной структуре;
- `createPrototypeExtractionProposal` - создание локального proposal с `_definitions` entry, instance overrides, validation gates, source map impact и `EditorChangeSet`;
- scoring для repeated candidates: количество повторов, общие поля, override-поля, shared ratio, readability risk и over-extraction risk;
- safe `_type` handling: если все источники имеют один `_type`, локальный prototype получает `_extends`, а экземпляры переходят на новый локальный `_type`;
- отказ от extraction при смешанных `_type`, чтобы не спрятать разные семантические типы под одним прототипом;
- snapshot tests для UI-like authoring examples и dry-run через существующий `EditorChangeSet` flow.

Осталось следующими срезами:

- сделать полноценный ручной proposal review surface в `apps/editor-web` с явной кнопкой "Use as planned ChangeSet";
- вводить platform-level catalog и `_prototypeImports` только отдельной schema/compiler задачей.

Второй срез добавил:

- server-side route `/api/editor/prototype-extraction`, который не пишет файлы и не применяет ChangeSet;
- `planPrototypeExtractionForEditor` в `apps/editor-web/src/lib/compiler-workflow.ts`: proposal, editor dry-run, compiler dry-run, runtime schema validation, canonical runtime diff and source-map pointer checks;
- read-only assistant tool `editor.proposePrototypeExtraction`;
- local AG-UI routing по запросам про прототипы;
- отдельный client state для prototype proposal, чтобы proposal не попадал в `agentPlannedChangeSet` и не включал Apply автоматически.

Третий срез добавил:

- явную команду `Use as planned ChangeSet` в fallback assistant panel и Cubica Surface;
- read-only/system-approved assistant tool `editor.preparePrototypeChangeSet`, который переводит последний проверенный proposal в обычный planned `EditorChangeSet`, но не применяет его;
- повторный editor dry-run на текущем документе перед подготовкой planned ChangeSet, чтобы stale proposal не прошел в apply-flow;
- сброс старого `agentPlannedChangeSet` при создании нового prototype proposal, чтобы кнопка Apply не относилась к предыдущему плану.

Принятое расширение процесса добавило:

- регулярный deterministic audit для PR/измененных authoring-файлов;
- недельный полный deterministic scan всех authoring-файлов;
- недельный LLM-семантический audit для смысловых дублей, которые не совпадают по JSON-форме;
- promotion backlog review в том же недельном цикле;
- suppression records с причиной, владельцем и датой пересмотра;
- editor notification для пропущенного, просроченного, упавшего или частичного weekly audit;
- отдельный process doc `docs/processes/authoring-prototype-audit.md`.

Четвертый срез реализовал:

- CLI `audit:prototype-candidates` для deterministic, changed-file, weekly, semantic-llm and promotion backlog modes;
- GitHub Actions workflow `prototype-audit.yml` для PR deterministic audit, weekly scheduled audit and manual rerun;
- status JSON contract and validator `validate-prototype-audit-status.js`;
- pluggable LLM semantic pass through `PROTOTYPE_AUDIT_LLM_COMMAND`;
- editor-web route `/api/editor/prototype-audit/status`;
- nonblocking editor footer notice for `missing`, `stale`, `failed`, `partial` and `outdated-report`.

## Understanding

Задача понята так: ADR-050 уже принял три направления для работы с часто повторяющимися authoring-элементами: локальное извлечение прототипов, двухуровневую модель `game-level -> platform-level` и AI-assisted designer. Теперь нужен исполнительный документ: что именно реализовывать, в каком порядке, какие границы не нарушать, как проверять результат и где оставлять артефакты.

Здесь "исполнительная документация" означает рабочую задачу, а не новое архитектурное решение. Архитектурный источник истины остается в ADR-050 и `docs/architecture/PROJECT_ARCHITECTURE.md`.

## Why

Сейчас authoring-слой уже поддерживает прототипы через `_definitions`, `_type`, `_extends`, `_semantics` и `_promptTemplate`, но нет поддерживаемого механизма, который:

- находит повторяющиеся элементы в game/UI authoring manifests;
- предлагает безопасное локальное извлечение в game-level prototype;
- показывает runtime diff и влияние на source maps до применения;
- проводит изменения через `EditorChangeSet`, dry-run, approval и undo;
- отделяет локальные прототипы от кандидатов на platform-level prototype;
- помогает ИИ-агенту предлагать прототипы без прямого применения изменений.

Без такого слоя повторяющиеся UI/game patterns остаются копиями, а удачные локальные решения не получают управляемого пути к платформенному переиспользованию.

## Architecture Baseline

Работа реализует ADR-050 и опирается на действующие решения:

- ADR-025: JSON Schema остается источником истины для структур манифеста.
- ADR-030: агенты и редактор меняют authoring manifests, runtime/player получают только generated runtime manifests.
- ADR-036: AI-правки проходят через `EditorPatchIntent -> EditorChangeSet -> dry-run -> apply/undo/save`.
- ADR-040: game-specific ветки в platform/runtime слоях запрещены.
- ADR-048: `_prompt` и `_promptTemplate` являются authoring-only полями и удаляются из runtime output.
- ADR-049: draft prompt storage и drift diagnostics не должны подменять структурные validation gates.
- ADR-050: приняты варианты A, B и D; полностью автоматическое повышение отклонено.

## Terms

- **Authoring manifest** - исходный JSON-манифест для разработки, где разрешены authoring-only ключи вроде `_definitions`, `_type`, `_extends`, `_semantics`, `_prompt` и `_promptTemplate`.
- **Runtime manifest** - generated JSON-манифест, который потребляют `runtime-api`, `player-web` и другие runtime-каналы.
- **Game-level prototype** - локальный прототип конкретной игры. Он может содержать смысл, названия и параметры, специфичные для этой игры.
- **Platform-level prototype** - общий authoring-прототип платформы Cubica. Он не содержит идентификаторов, текстов, asset paths или правил, осмысленных только для одной игры.
- **Proposal** - предложение изменения: список исходных JSON Pointer, тело прототипа, параметры экземпляров, expected runtime diff, влияние на source map и validation gates.
- **JSON Pointer** - стандартный путь к узлу внутри JSON-документа, например `/root/screens/0/components/2`.
- **Нулевая runtime-разница** - результат компиляции до и после извлечения совпадает по runtime-смыслу. Для чистого извлечения первый режим должен требовать canonical JSON diff без изменений.

## Classification

Механизм извлечения и повышения прототипов является **общим платформенным authoring/tooling-механизмом**. Он применим к классам игр, UI-манифестам, редактору и агентскому workflow.

Первый извлеченный прототип может быть **game-specific**, если он живет только в `games/<gameId>/authoring/**` и не требует runtime branches. Повышение в platform-level prototype возможно только после отдельной ручной классификации "general vs game-specific" по ADR-050.

## Scope

Входит в работу:

- описать и реализовать proposal format для prototype extraction;
- добавить discovery pass, который ищет похожие authoring-узлы по нормализованной структуре;
- реализовать локальное извлечение в `_definitions` конкретной игры без runtime-разницы по умолчанию;
- провести применение только через `EditorChangeSet`, dry-run, validation, approval и undo;
- добавить validation gates для authoring schema, generated runtime schema, leakage scan, source map pointers и runtime diff;
- подготовить editor surface для review proposal до применения;
- описать и реализовать ручной promotion checklist для platform-level prototype;
- подготовить контракт будущего platform-level catalog без включения его в runtime layer;
- добавить AI-assisted designer как suggestion layer, который формирует proposal, но не применяет его напрямую;
- добавить регулярный audit process: PR deterministic scan, weekly deterministic scan, weekly LLM-семантический scan и promotion backlog review;
- добавить тестовые fixtures на game authoring и UI authoring;
- обновить документацию после фактической реализации.

## Non-Goals

Не входит в работу:

- автоматически повышать локальные прототипы до platform-level;
- добавлять поддержку authoring-прототипов в `runtime-api` или `player-web`;
- менять runtime action templates ADR-028 как часть prototype extraction;
- переносить всю `Antarctica` на прототипы одним большим изменением;
- делать `_prototypeImports` runtime-контрактом;
- создавать platform-level catalog без версии, examples, tests и migration policy;
- применять AI-generated changes без approval envelope и dry-run;
- считать extraction успешным, если generated runtime output изменился без отдельной migration task.

## Execution Plan

### Phase 0. Baseline And Test Targets

1. [x] Зафиксировать первый безопасный UI-like test target внутри `packages/editor-engine/tests/index.test.ts`.
2. [ ] Сохранить baseline compile output и source maps для выбранных targets.
3. [x] Проверить, что `npm run verify:manifest-authoring` проходит до изменений или явно записать существующий unrelated failure.
4. [x] Уточнить, какие fields считаются known-variant для первых candidates: `id`, `_label`, `_semantics`, `_prompt`, тексты, координаты, action ids.

### Phase 1. Proposal Contract

1. [x] Описать TypeScript/JSON shape для proposal в editor/tooling layer.
2. [x] Включить в proposal обязательные поля: source pointers, proposed definition pointer, common body, instance overrides, expected runtime diff, source map impact и validation gates. Inverse ChangeSet остается результатом существующего `dryRunEditorChangeSet`.
3. [x] Добавить schema-backed или snapshot-backed тесты для proposal examples.
4. [x] Запретить proposal без явной classification: `game-level`, `candidate-for-platform` или `rejected-over-extraction`.

### Phase 2. Local Extraction Engine, Variant A

1. [x] Реализовать normalized comparison для authoring-узлов без ad hoc string matching.
2. [x] Добавить scoring: количество повторов, стабильность shape, доля общих полей, число overrides, риск потери читаемости.
3. [x] Генерировать локальный `_definitions` entry и instance overrides только в authoring-файле конкретной игры.
4. [x] Запускать compiler dry-run и canonical runtime diff до применения.
5. [x] Блокировать extraction, если source map pointers после изменения не указывают на существующие authoring paths.

### Phase 3. Editor Review And Apply Flow

1. [ ] Показать proposal в полноценном editor review surface: группа повторов, параметры, runtime diff, source map impact и warnings. Текущий срез показывает summary/gates/action в assistant surface.
2. [x] Применять изменения только через `EditorChangeSet`.
3. [x] Добавить UI dry-run summary, undo journal и понятный failure state. `editor.preparePrototypeChangeSet` повторно dry-run'ит proposal; применение идет через существующий apply/undo journal.
4. [x] Не скрывать результирующий `_definitions` entry в JSON tree/Monaco/property flows. После apply меняется обычный authoring JSON, без отдельного скрытого состояния.
5. [x] Проверить, что source map pointers после извлечения существуют. Browser-level preview selection остается отдельной e2e проверкой для review surface.

### Phase 4. Platform Promotion Governance, Variant B

1. [x] Оформить promotion checklist как поддерживаемый artifact или process doc.
2. [x] Зафиксировать критерии platform-level prototype: минимум два независимых use case или доказанный класс игр, отсутствие game-specific fields, `_semantics`, `_promptTemplate`, examples, tests, versioning и migration guidance.
3. [ ] Подготовить будущий home для catalog только после отдельной structural task. Предпочтительный кандидат из ADR-050: `packages/authoring-prototypes/`.
4. [ ] Если вводится `_prototypeImports`, сначала расширить authoring JSON Schema и compiler stripping rules, затем добавить validation на отсутствие import metadata в runtime output.
5. [x] Запретить promotion без ручной записи классификации "general vs game-specific".

### Phase 5. AI-Assisted Designer, Variant D

1. [x] Добавить assistant capability, которая возвращает proposal, а не прямой patch.
2. [x] Ограничить AI output структурой proposal и Cubica `EditorChangeSet` на уровне reusable `editor-engine` API.
3. [ ] Требовать plain-language explanation: почему элементы похожи, какие поля стали параметрами, почему это не over-extraction.
4. [x] Добавить защиту от автоматического platform promotion. Ни proposal tool, ни prepare tool не пишут platform catalog и не вводят `_prototypeImports`.
5. [x] Прогнать AI suggestions через те же gates, что ручной extractor.

### Phase 6. Documentation Closeout

1. [x] Обновить `docs/architecture/PROJECT_ARCHITECTURE.md`, только если реализация уточнит принятые архитектурные ограничения. В этом срезе архитектурные ограничения не менялись.
2. [x] Обновить активную задачу фактическими командами, результатами и оставшимися ограничениями.
3. [x] Обновить `PROJECT_STRUCTURE.yaml`, если появятся новые значимые каталоги или `.desc.json`.
4. [x] Записать handoff: измененные файлы, проверки, что сделано, что осталось и следующий безопасный шаг.

### Phase 7. Regular Prototype Candidate Audit

1. [x] Зафиксировать архитектурное решение в ADR-050: PR deterministic audit, weekly deterministic scan, weekly LLM-семантический audit и promotion backlog review.
2. [x] Создать process doc для регулярного аудита кандидатов.
3. [x] Реализовать CLI `audit:prototype-candidates` поверх deterministic normalized comparison. Скрипт живет в `scripts/manifest-tools/audit-prototype-candidates.cjs`.
4. [x] Добавить changed-file режим для PR-аудита через `--changed <base-ref>`.
5. [x] Добавить weekly report формат со stable candidate ids, summary, local prototypes and promotion backlog.
6. [x] Добавить LLM-семантический weekly pass, который получает compact context и возвращает только candidate records. Provider подключается через `PROTOTYPE_AUDIT_LLM_COMMAND`; отсутствие provider дает `llmStatus=skipped`.
7. [x] Добавить CI workflow с `pull_request`, `workflow_dispatch` и weekly `schedule` triggers.
8. [x] Добавить review handoff из weekly audit в promotion backlog через секцию `promotionBacklog` в report.
9. [x] Добавить audit status record с `lastStartedAt`, `lastCompletedAt`, `status`, `llmStatus`, `reportPath`, summary и commit metadata.
10. [x] Добавить editor-web route для чтения audit status.
11. [x] Добавить неблокирующее уведомление в редакторе для статусов `missing`, `stale`, `failed`, `partial` и `outdated-report`.
12. [x] Добавить ручное действие "Open audit workflow" или "Snooze for session" в notice surface. Прямой `workflow_dispatch` из editor-web остается future backend integration.

## Acceptance

1. Есть proposal format, понятный редактору, агенту и review flow.
2. Есть локальный extractor для game-level prototypes, который не меняет runtime output по умолчанию.
3. Изменения применяются через `EditorChangeSet`, dry-run, validation, approval и undo.
4. Generated runtime manifests не содержат `_definitions`, `_type`, `_extends`, `_promptTemplate`, `_prototypeImports` или source trace.
5. Source maps после extraction указывают на существующие authoring pointers.
6. UI authoring manifests поддерживаются наравне с game authoring manifests.
7. Есть promotion checklist для platform-level prototype, и promotion не автоматизирован без ручного архитектурного решения.
8. AI-assisted designer может предложить prototype proposal, но не может применить его напрямую или повысить прототип.
9. JSON Schema остается источником истины для authoring/runtime структур; TypeScript не заменяет schema validation.
10. Не добавлены game-specific ветки в `runtime-api`, `player-web` или contracts layer.
11. PR-аудит кандидатов работает в deterministic mode и не вызывает LLM по умолчанию.
12. Недельный LLM-семантический аудит возвращает только candidate records и требует deterministic gates перед любым proposal/apply.
13. Suppression records имеют причину, владельца и дату пересмотра.
14. Редактор показывает неблокирующее уведомление, если weekly audit отсутствует, просрочен, завершился ошибкой, прошел без LLM-семантической части или относится к устаревшему commit.

## Validation

Минимальные команды для реализации:

```bash
npm run compile:manifests -- --check
npm run verify:manifest-authoring
npm run verify:editor-engine
npm run verify:editor-web
rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json
git diff --check
```

Ожидаемый результат leakage scan для generated runtime manifests:

- нет `_definitions`;
- нет `_type`;
- нет `_extends`;
- нет `_promptTemplate`;
- нет `_prototypeImports`;
- нет `_source_trace`.

Для чистого extraction отдельно обязателен canonical runtime diff:

```bash
npm run compile:manifests -- --check
```

Если diff показывает изменение generated runtime output, это не считается безопасным извлечением прототипа и должно быть вынесено в отдельную migration task.

Известное ограничение проекта:

- `npm run verify:canonical` может падать на уже существующем `verify:legacy` из-за незарегистрированных `mock/not implemented` markers вне этой задачи. Эта задача не должна добавлять новые незарегистрированные markers.

## Artifacts

- `docs/architecture/adrs/050-authoring-prototype-extraction-and-promotion.md` - принятое архитектурное решение.
- `docs/processes/authoring-prototype-audit.md` - поддерживаемый процесс регулярного deterministic/LLM-аудита кандидатов в прототипы.
- `docs/processes/authoring-prototype-promotion.md` - поддерживаемый процесс ручного повышения локального прототипа в platform-level prototype.
- `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md` - матрица исполнения по вариантам A, B и D.
- `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md` - этот исполнительный план.

## Risks And Controls

- **Over-extraction**: похожие элементы могут стать хуже читаемыми после выноса в прототип. Контроль: scoring и обязательное объяснение why-not-copy.
- **Platform contamination**: game-specific prototype может попасть в platform catalog. Контроль: ручная classification и promotion checklist.
- **Runtime leakage**: authoring-only поля могут попасть в generated manifests. Контроль: compiler stripping rules и leakage scan.
- **Source map drift**: preview/editor selection может потерять связь с исходным узлом. Контроль: source map pointer existence check.
- **AI overreach**: AI может предложить слишком общий или небезопасный patch. Контроль: AI возвращает только proposal, применение идет через стандартный approval flow.
- **LLM false positives**: смысловой аудит может найти похожие по описанию, но разные по назначению элементы. Контроль: LLM создает только candidate records, а deterministic gates остаются обязательными.
- **Audit noise**: регулярные отчеты могут стать слишком шумными. Контроль: stable candidate ids, suppression с причиной и датой пересмотра, PR-аудит сначала в advisory mode.

## Handoff Log

### 2026-06-13 - Codex Documentation Setup

- Изменено:
  - `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/.desc.json`
  - `docs/tasks/active/.desc.json`
  - `NEXT_STEPS.md`
  - `PROJECT_STRUCTURE.yaml`
- Сделано: создана исполнительная документация для реализации ADR-050: фазы, acceptance, validation, risks and controls, artifact matrix.
- Проверки:
  - `node scripts/dev/generate-structure.js` - OK.
  - `node -e "JSON.parse(...)"` для новых `.desc.json` - OK.
  - `git diff --check` - OK.
  - `npm run verify:manifest-authoring` - OK.
- Осталось: начать Phase 0 с выбора первых безопасных targets и baseline compile/source-map proof.
- Следующий безопасный шаг: открыть `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md` и выбрать минимальный implementation slice A1/A2 для локального extraction proposal.
- Риски: нельзя начинать platform catalog или `_prototypeImports` до явной schema/compiler задачи; нельзя менять runtime output в рамках "чистого" extraction.

### 2026-06-13 - First Engine Slice Implemented

- Изменено:
  - `packages/editor-engine/src/index.ts`
  - `packages/editor-engine/tests/index.test.ts`
  - `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md`
  - `NEXT_STEPS.md`
- Сделано: добавлен reusable `editor-engine` API для discovery и proposal generation; proposal строит локальный `_definitions` entry, instance overrides, validation gates, source map impact и `EditorChangeSet`.
- Сделано: добавлена защита от смешивания разных `_type`; общий `_type` переносится в `_extends` локального прототипа.
- Проверки:
  - `npm run verify:editor-engine` - OK.
  - `npm run typecheck --workspace @cubica/editor-engine` - OK.
  - `npm test --workspace @cubica/editor-engine -- --run` - OK.
  - `npm run compile:manifests -- --check` - OK.
  - `npm run verify:manifest-authoring` - OK.
  - `rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json` - no matches.
  - `npm run verify:editor-web` - OK.
  - `git diff --check` - OK.
- Осталось: editor-web proposal review UI, compiler/source-map gate runner, assistant tool/handler, future platform catalog task.
- Следующий безопасный шаг: реализовать A4/Phase 3 integration в editor-web: dry-run proposal, compile check, source-map pointer existence check и визуальный review перед apply.
- Риски: текущий срез не применяет compiler dry-run автоматически; callers должны запускать validation gates из proposal до apply.

### 2026-06-13 - Server Gates And Assistant Tool Implemented

- Изменено:
  - `apps/editor-web/src/lib/compiler-workflow.ts`
  - `apps/editor-web/src/lib/compiler-workflow.test.ts`
  - `apps/editor-web/app/api/editor/prototype-extraction/route.ts`
  - `apps/editor-web/app/api/editor/prototype-extraction/.desc.json`
  - `apps/editor-web/src/lib/editor-agent-tool-catalog.ts`
  - `apps/editor-web/src/lib/agent-assistant-registry.test.ts`
  - `apps/editor-web/src/lib/editor-agent-tool-catalog.test.ts`
  - `apps/editor-web/src/lib/editor-agent-local-backend.ts`
  - `apps/editor-web/src/lib/editor-agent-local-backend.test.ts`
  - `apps/editor-web/src/components/editor-agent-ui.tsx`
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `PROJECT_STRUCTURE.yaml`
  - `NEXT_STEPS.md`
- Сделано: prototype proposal теперь проходит editor dry-run, compiler dry-run, runtime schema validation, canonical runtime diff and source-map pointer existence gates через read-only editor-web route.
- Сделано: добавлен read-only assistant tool `editor.proposePrototypeExtraction`; proposal сохраняется отдельно от `agentPlannedChangeSet`, поэтому Apply не появляется автоматически.
- Проверки:
  - `npm test --workspace @cubica/editor-web -- --run src/lib/compiler-workflow.test.ts` - OK.
  - `npm test --workspace @cubica/editor-web -- --run src/lib/editor-agent-tool-catalog.test.ts src/lib/agent-assistant-registry.test.ts src/lib/editor-agent-local-backend.test.ts src/lib/compiler-workflow.test.ts` - OK.
  - `npm run typecheck --workspace @cubica/editor-web` - OK.
  - `npm test --workspace @cubica/editor-engine -- --run` - OK.
  - `node scripts/dev/generate-structure.js` - OK.
- Осталось: полноценная ручная review surface для proposal, browser/e2e proof preview selection after extraction, future platform catalog task.
- Следующий безопасный шаг: добавить UI panel/action "Use proposal as planned ChangeSet" с явным dry-run и без автоматического apply.
- Риски: текущий assistant tool показывает proposal и gates, но не дает dedicated UI для сравнения source groups и parameters; это нужно закрыть до первого реального authoring migration.

### 2026-06-13 - Manual Prototype Proposal Staging Implemented

- Изменено:
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `apps/editor-web/src/components/editor-agent-ui.tsx`
  - `apps/editor-web/src/lib/editor-agent-tool-catalog.ts`
  - `apps/editor-web/src/lib/editor-agent-local-backend.ts`
  - `apps/editor-web/src/lib/editor-agent-local-backend.test.ts`
  - `apps/editor-web/src/lib/agent-assistant-registry.test.ts`
  - `apps/editor-web/app/globals.css`
  - `docs/processes/authoring-prototype-promotion.md`
  - `docs/processes/.desc.json`
  - `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md`
  - `NEXT_STEPS.md`
  - `PROJECT_STRUCTURE.yaml`
- Сделано: добавлен ручной action `Use as planned ChangeSet`; он доступен в fallback assistant panel и Cubica Surface только после успешных proposal gates.
- Сделано: добавлен tool `editor.preparePrototypeChangeSet`; он повторно запускает editor dry-run на текущем документе, кладет proposal ChangeSet в `agentPlannedChangeSet` и не применяет JSON автоматически.
- Сделано: при создании нового prototype proposal старый planned ChangeSet сбрасывается, чтобы Apply не относился к предыдущему плану.
- Сделано: promotion checklist вынесен в поддерживаемый процессный документ `docs/processes/authoring-prototype-promotion.md`; создан `docs/processes/.desc.json` и регенерирован `PROJECT_STRUCTURE.yaml`.
- Проверки:
  - `npm test --workspace @cubica/editor-web -- --run src/lib/editor-agent-tool-catalog.test.ts src/lib/agent-assistant-registry.test.ts src/lib/editor-agent-local-backend.test.ts` - OK.
  - `npm run typecheck --workspace @cubica/editor-web` - OK.
  - `npm test --workspace @cubica/editor-web -- --run src/lib/editor-agent-tool-catalog.test.ts src/lib/agent-assistant-registry.test.ts src/lib/editor-agent-local-backend.test.ts src/lib/compiler-workflow.test.ts` - OK.
  - `npm test --workspace @cubica/editor-engine -- --run` - OK.
  - `npm run compile:manifests -- --check` - OK.
  - `npm run verify:manifest-authoring` - OK.
  - `npm run verify:editor-engine` - OK.
  - `npm run verify:editor-web` - OK.
  - `node scripts/dev/generate-structure.js` - OK.
  - `rg -n '"_definitions"|"_type"|"_extends"|"_promptTemplate"|"_prototypeImports"|"_source_trace"' games/*/game.manifest.json games/*/ui/*/ui.manifest.json` - no matches.
  - `git diff --check` - OK.
- Осталось: dedicated review surface с группами источников/параметрами, browser/e2e proof preview selection after extraction, future platform catalog task.
- Следующий безопасный шаг: добавить e2e/visual proof для proposal -> planned ChangeSet -> Apply -> preview source-map selection на `simple-choice`.
- Риски: кнопка пока показывает summary/gates, а не полный табличный review common body/overrides; для массовой миграции прототипов нужен отдельный полноценный review экран.

### 2026-06-13 - Regular Prototype Audit Documentation Accepted

- Изменено:
  - `docs/architecture/adrs/050-authoring-prototype-extraction-and-promotion.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `PROJECT_OVERVIEW.md`
  - `docs/processes/authoring-prototype-audit.md`
  - `docs/processes/authoring-prototype-promotion.md`
  - `docs/processes/.desc.json`
  - `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md`
  - `NEXT_STEPS.md`
  - `PROJECT_STRUCTURE.yaml`
- Сделано: принята и задокументирована регулярная процедура поиска кандидатов: PR deterministic audit, weekly deterministic scan, weekly LLM-семантический audit, suppression и promotion backlog review.
- Сделано в следующем срезе: реализованы CLI `audit:prototype-candidates`, CI workflow, weekly report/status storage, LLM compact-context runner и editor notification для пропущенных weekly audits.
- Следующий безопасный шаг: подключить production `PROTOTYPE_AUDIT_LLM_COMMAND`, добавить persistent suppression store и browser/e2e proof для editor notice.
- Риски: LLM-аудит не должен запускаться на каждый PR и не должен создавать `EditorChangeSet`; он возвращает только candidate records для последующей deterministic проверки.

### 2026-06-13 - Missed Weekly Audit Notification Added To Plan

- Изменено:
  - `docs/architecture/adrs/050-authoring-prototype-extraction-and-promotion.md`
  - `docs/architecture/PROJECT_ARCHITECTURE.md`
  - `PROJECT_OVERVIEW.md`
  - `docs/processes/authoring-prototype-audit.md`
  - `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md`
  - `NEXT_STEPS.md`
- Сделано: добавлено требование editor notification для weekly audit statuses `missing`, `stale`, `failed`, `partial` и `outdated-report`.
- Сделано: уточнен запуск weekly audit: GitHub Actions `schedule` на default branch, ручной `workflow_dispatch` для перезапуска и отдельный PR deterministic trigger.
- Осталось: подключить production LLM provider command, решить постоянный home для audit history/suppressions и добавить browser e2e для notice в editor shell.
- Следующий безопасный шаг: добавить suppression store and review UI для weekly report, затем dedicated prototype review UI с группами источников/параметрами.

### 2026-06-13 - Prototype Audit Implementation

- Изменено:
  - `.github/workflows/prototype-audit.yml`
  - `.github/workflows/.desc.json`
  - `package.json`
  - `scripts/manifest-tools/audit-prototype-candidates.cjs`
  - `scripts/manifest-tools/.desc.json`
  - `scripts/ci/validate-prototype-audit-status.js`
  - `scripts/ci/.desc.json`
  - `apps/editor-web/app/api/editor/prototype-audit/.desc.json`
  - `apps/editor-web/app/api/editor/prototype-audit/status/.desc.json`
  - `apps/editor-web/app/api/editor/prototype-audit/status/route.ts`
  - `apps/editor-web/src/lib/prototype-audit-status.ts`
  - `apps/editor-web/src/lib/prototype-audit-status.test.ts`
  - `apps/editor-web/src/components/prototype-audit-notice.tsx`
  - `apps/editor-web/src/components/prototype-audit-notice.test.tsx`
  - `apps/editor-web/src/components/editor-workspace.tsx`
  - `apps/editor-web/app/globals.css`
  - `docs/processes/authoring-prototype-audit.md`
  - `docs/tasks/active/TSK-20260613-authoring-prototype-extraction-and-promotion.md`
  - `docs/tasks/artifacts/TSK-20260613-authoring-prototype-extraction-and-promotion/execution-matrix.md`
  - `NEXT_STEPS.md`
  - `PROJECT_STRUCTURE.yaml`
- Сделано: реализованы deterministic local/changed/full audit modes, pluggable LLM semantic mode, weekly report/status output, promotion backlog generation, CI workflow and editor missed-audit notice.
- Проверки:
  - `npm run audit:prototype-candidates -- --scope all --mode deterministic --format json --output .tmp/prototype-audit/deterministic-report.json --status-output .tmp/prototype-audit/status.json` - OK.
  - `npm run audit:prototype-candidates -- --scope all --mode promotion-backlog --format json --output .tmp/prototype-audit/promotion-report.json --status-output .tmp/prototype-audit/promotion-status.json` - OK.
  - `node scripts/manifest-tools/audit-prototype-candidates.cjs --changed HEAD --mode deterministic --format markdown --output .tmp/prototype-audit/changed-report.md` - OK.
  - `npm run audit:prototype-candidates -- --scope all --mode weekly --format markdown --output .tmp/prototype-audit/weekly-report.md --status-output .tmp/prototype-audit/status.json` - OK; local LLM provider отсутствует, поэтому `llmStatus=skipped`.
  - `node scripts/ci/validate-prototype-audit-status.js .tmp/prototype-audit/status.json` - OK.
  - `PROTOTYPE_AUDIT_LLM_COMMAND='<test runner>' node scripts/manifest-tools/audit-prototype-candidates.cjs --scope all --mode semantic-llm --format json --output .tmp/prototype-audit/semantic-report.json --status-output .tmp/prototype-audit/semantic-status.json --require-llm` - OK.
  - `node scripts/ci/validate-prototype-audit-status.js .tmp/prototype-audit/semantic-status.json` - OK.
  - `node scripts/ci/validate-prototype-audit-status.js .tmp/prototype-audit/promotion-status.json` - OK.
  - `npm test --workspace @cubica/editor-web -- --run src/lib/prototype-audit-status.test.ts src/components/prototype-audit-notice.test.tsx` - OK.
  - `npm test --workspace @cubica/editor-web -- --run` - OK.
  - `npm run typecheck --workspace @cubica/editor-web` - OK.
  - `npm test --workspace @cubica/editor-engine -- --run` - OK.
  - `npm run verify:manifest-authoring` - OK.
  - `npm run compile:manifests -- --check` - OK.
  - `node scripts/dev/generate-structure.js` - OK.
  - `git diff --check` - OK.
- Осталось: production LLM command/provider, persistent suppression storage, browser/e2e proof for editor notice, dedicated weekly report review surface.
- Риски: deterministic audit currently reports many low-level repeated prop objects; suppression/review UI should be the next UX control before turning PR advisory into a soft gate.
