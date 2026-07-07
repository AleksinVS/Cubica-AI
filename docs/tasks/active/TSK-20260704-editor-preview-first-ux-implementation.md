# TSK-20260704-editor-preview-first-ux-implementation: Preview-first UX редактора — реализация принятых решений

## Оглавление

- [Status](#status)
- [Understanding](#understanding)
- [Architecture Source](#architecture-source)
- [Why](#why)
- [Dependencies And Coordination](#dependencies-and-coordination)
- [Scope](#scope)
- [Non-Goals](#non-goals)
- [Execution Plan](#execution-plan)
- [Acceptance](#acceptance)
- [Validation](#validation)
- [Risks](#risks)
- [Handoff Log](#handoff-log)

## Status

in-progress (2026-07-05) — Phase 0 и Phase 1.1–1.3 выполнены; срезы A (e2e prod-режим) и B (декомпозиция EditorWorkspace) закрыты

## Understanding

Работа понята так: UX-архитектура preview-first редактора принята и зафиксирована в
`docs/architecture/editor-preview-first-ux.md` (обсуждение 2026-07-04). Нужно
реализовать эти уже принятые решения, не меняя целевую архитектуру платформы. Это
программа из связанных срезов: контракты editor-engine (вхождения сущностей,
интерпретатор возвращённого намерения, политика риска, очередь интентов, фикстуры,
кэш), UI по эталонному макету, поведение осей времени/диагностики/создания сущностей.
Детальная спецификация и макет — в артефактах задачи; исполнитель применяет макет,
а не придумывает интерфейс.

## Architecture Source

- `docs/architecture/adrs/057-preview-first-editor-ux-architecture.md` — каноническое архитектурное решение (Accepted)
- `docs/architecture/editor-preview-first-ux.md` — детальный источник UX-решений при ADR-057
- `docs/tasks/artifacts/TSK-20260704-editor-preview-first-ux-implementation/design-spec.md` — детальная спецификация
- `docs/tasks/artifacts/TSK-20260704-editor-preview-first-ux-implementation/editor-workspace-mockup.html` — эталонный макет UI
- ADR-034, ADR-036, ADR-042, ADR-047, ADR-049, ADR-050, ADR-052 — действующие границы
- `docs/architecture/PROJECT_ARCHITECTURE.md`

ADR-057 оформлен 2026-07-04; `PROJECT_ARCHITECTURE.md` и `PROJECT_OVERVIEW.md`
синхронизированы. Если в ходе реализации требуется решение, отсутствующее в
ADR-057/UX-документе, — стоп и эскалация в ADR-процесс, самодеятельность
запрещена.

## Why

Редактор — ключевой инструмент платформы. Принятые решения закрывают: тройственность
сущностей (проекция + маршрутизация записи), безопасное текстовое/агентское
редактирование, две оси времени, создание сущностей, диагностический поток,
медленную загрузку (кэш). Без исполнительной программы решения останутся на бумаге и
начнут дрейфовать относительно параллельной работы.

## Dependencies And Coordination

Работа по проекту идёт параллельно; целевая архитектура не меняется. Обязательные
предпосылки и точки координации:

1. **Блокирует старт Phase 2+**: `TSK-20260630-editor-engine-modularization`
   (LEGACY-0018/0019) — новые контракты кладутся на модульные границы, не на
   монолитный `index.ts`. Профилирование загрузки — внутри модуляризации.
2. **Блокирует конвейер ChangeSet**: пункт 1 `TSK-20260630-review-remediation-correctness`
   (порча документа при undo вставки в массив) — должен быть закрыт до Phase 4.
3. Координация по файлам: `apps/player-web` (preview) — с
   `TSK-20260630-player-web-renderer-purity`; контракты — с
   `TSK-20260630-manifest-contract-parity`; чистка — с
   `TSK-20260630-codebase-cleanup-and-workspace-status`.
4. Перед каждой фазой перечитывать `NEXT_STEPS.md` и Handoff Log пересекающихся TSK;
   не редактировать файлы, находящиеся в активной работе другого TSK, без сверки.

## Scope

- Оформление ADR по принятым UX-решениям (+ обновление `PROJECT_ARCHITECTURE.md`).
- `packages/editor-engine`: контракты из design-spec §2 (occurrences, интерпретатор,
  риск-политика, очередь интентов, схема фикстур, кэш, adapter-расширение,
  операции создания/удаления/рефакторинга).
- `apps/editor-web`: UI по макету (зоны 1–8), поведение по design-spec §3.
- `services/runtime-api`: только в объёме уже принятых границ (preview-only restore
  принимает состояние фикстуры; без новых game-specific веток).
- Диагностики design-spec §4, телеметрия §5, тесты §6.

## Non-Goals

- Не менять целевую архитектуру платформы, runtime/player boundary, схемы манифестов
  сверх явно указанного (schema-признаки «требует отображения», «декоративный»,
  `state-fixture.schema.json` — в объёме).
- Не реализовывать отложенные направления (§11 UX-документа): AI-driven authoring,
  мультиплеер-превью, совместное редактирование, локализация, публикация.
- Не переносить сюда правки чужих TSK (correctness, purity, parity).
- Не делать кэш источником истины и не создавать persisted editor-manifest (ADR-052).

## Execution Plan

Фазы упорядочены по зависимостям; каждая фаза заканчивается зелёными проверками и
записью в Handoff Log. Фазы 3–9 могут при необходимости выделяться в под-TSK.

### Phase 0. Проверка предпосылок и сверка документации

1. ADR-057 уже оформлен; сверить его с `editor-preview-first-ux.md` и design-spec
   на отсутствие расхождений (при расхождении старшинство у ADR-057).
2. Сверить предпосылки (Dependencies 1–2); если не готовы — Phase 1 только по
   не-blocked частям.

### Phase 1. Контракты ядра (editor-engine)

1. Вхождения сущностей: `entityId`/`occurrenceKind` в TreeViewModel (spec §2.1).
2. Политика риска ChangeSet + единая точка применения (spec §2.3).
3. Декларация зависимостей линз (`readPointerPrefixes`) — фундамент кэша.
4. Схема `state-fixture.schema.json` + валидация (spec §2.5).
5. Schema-признаки «требует отображения» / «декоративный» + диагностики
   `entity-view-orphan`, `entity-missing-view`.

### Phase 2. Кэширование (spec §2.6)

1. Уровень 1: инкрементальная инвалидация по указателям.
2. Уровень 2: дисковый кэш `.tmp/editor-cache/` с полным ключом входов ADR-052.
3. Уровень 3: кэш компиляции + переиспользование Ajv-валидаторов.
4. Телеметрия hit/miss и длительностей; замер до/после.

### Phase 3. Дерево и панель сущности (UI по макету, зоны 2 и 4)

1. Переключатель «По экранам/По типам», occurrences, «Логика экрана», поиск.
2. Панель: фасеты с каналом, бейджи источника, промт-строка, подсветка изменённых
   полей, мультивыделение.

### Phase 4. Интерпретатор возвращённого намерения (spec §2.2)

1. Быстрый путь → агентский путь; семантика удалений; построчный отчёт;
   `prompt-stale`; eval-фикстуры.
2. Текстовый режим панели («источник», «Применить как намерение»).

### Phase 5. Оси времени и фикстуры (spec §3.3, §2.5)

1. Политика применения к предпросмотру (авто в Дизайне / плашка в Превью);
   лестница восстановления.
2. Селектор фикстуры в Дизайне; «Закрепить как фикстуру»; `fixture-stale`;
   удержание авто-чекпоинтов + GC.

### Phase 6. Создание и удаление сущностей (spec §2.8, §3.1)

1. Перетаскивание прототипа, «+» по контекстам, меню типов, атомарное
   кросс-манифестное создание, диалог удаления, `renameEntityId`.

### Phase 7. Очередь интентов и параллельность (spec §2.4)

1. Очередь, статусы, отмена в полёте, конфликт read∪write, `intent-stale`.

### Phase 8. Диагностический поток (spec §3.5; зоны 5 и 7)

1. Вкладка «Проверки», быстрые исправления, «Исправить агентом».
2. Последний валидный снимок при сломанной компиляции; индикатор свежести.

### Phase 9. Регион, ассеты, концепты (spec §3.4, §3.6; UX §9.7–9.8)

1. Регион: чипы, снимок области как optional adapter capability, гейты ADR-044.
2. Секция «Ассеты», asset-reference виджет, генерация за операционной политикой.
3. Концепты по готовности: история версий (витрина поверх Git), канальный
   просмотрщик Telegram, viewport-пресеты — допускается выделение в под-TSK.

### Phase 10. Closeout

1. E2E-набор spec §6; телеметрический отчёт; юзабилити-валидация дерева.
2. Обновить статус, Handoff Log, `NEXT_STEPS.md`; зарегистрировать остатки в
   debt-log; снять/обновить связанные LEGACY-записи.

## Acceptance

- ADR-057 сверен со спецификацией; расхождения устранены (сам ADR оформлен 2026-07-04).
- UI соответствует эталонному макету (зоны 1–8, обязательные варианты состояний).
- Контракты spec §2 реализованы и покрыты тестами spec §6; все агентские каналы
  проходят одну точку риск-политики; опасные операции — через approval envelope.
- Тёплая загрузка редактора использует кэш (hit подтверждён телеметрией);
  инкрементальная правка не вызывает полной пересборки проекции.
- Правки при идущем прохождении не теряются молча; сломанная компиляция не гасит
  предпросмотр.
- Runtime/player не импортируют editor-engine и не читают файлы фикстур/кэша;
  game-agnostic инварианты зелёные.
- Все проверки Validation зелёные; поведение вне охвата не изменилось.

## Validation

```text
npm run verify:editor-engine
npm run typecheck --workspace @cubica/editor-web
npm run test:e2e
node scripts/dev/generate-structure.js   # при структурных изменениях
```

Плюс контрактные проверки схем (Ajv) для `state-fixture.schema.json` и
game-agnostic CI invariant.

## Risks

- Параллельные TSK меняют те же файлы — двигаться малыми срезами, сверяться с
  Handoff Log соседей перед каждой фазой.
- Кэш может замаскировать алгоритмические проблемы — сначала профилирование
  (в модуляризации), телеметрия обязательна.
- Объём программы велик — фазы 3–9 выделяются в под-TSK при первом признаке
  расползания; один активный срез за раз.
- Интерпретатор — новая поверхность ошибок ИИ — eval-фикстуры с первого дня,
  построчный отчёт обязателен.

## Handoff Log

- 2026-07-04: задача создана; принятые решения — `docs/architecture/editor-preview-first-ux.md`;
  спецификация, эталонный макет и промт оркестратора — в
  `docs/tasks/artifacts/TSK-20260704-editor-preview-first-ux-implementation/`.
- 2026-07-04 (позже): оформлен ADR-057; `PROJECT_ARCHITECTURE.md` и
  `PROJECT_OVERVIEW.md` синхронизированы; Phase 0 сведена к проверке предпосылок
  и сверке документации.
- 2026-07-05: **Phase 0 выполнена.** (1) Сверка: ADR-057 ↔ UX-документ ↔ design-spec
  согласованы по всем 13 пунктам решения, материальных расхождений нет; макет
  покрывает зоны 1–8 и обязательные состояния. Наблюдение для Phase 1.4:
  `sourceTraceRef` фикстуры указывает в `.tmp/editor-playthroughs/` (чистится GC) —
  в схеме поле сделать необязательным/информационным. (2) Блокеры: инверсия undo
  закрыта (`json-pointer-patch.ts`, `targetsArrayInsertion`, verify 38 зелёный);
  модуляризация editor-engine Phases 1–3 done, **не** сделаны декомпозиция
  `EditorWorkspace` (гейтит Phase 3) и профилирование загрузки (гейтит Phase 2).
  (3) docs-ветка ADR-057 влита в `main` (merge c993f51). (4) План скорректирован
  по блокеру окружения (`docs/reviews/2026-07-05-remediation-closeout-and-e2e-blockers.md`):
  перед UI-фазами идёт срез «e2e в production-режиме» (player-web/editor-web через
  `next build` последовательно + `next start`; preview-путь не зависит от `next dev` —
  в `apps/player-web/src` нет NODE_ENV-веток, preview задаётся query-параметрами;
  build-time env `RUNTIME_API_URL` обязателен из-за rewrites), затем
  `EditorWorkspace` Phase 4 (модуляризационный TSK) с гейтом editor e2e 4/4,
  параллельно — Phase 1 контрактов (не заблокирована).
- 2026-07-05 (позже): **срез A выполнен — блокер окружения снят, e2e 8/8 (~55с) на
  этом хосте.** Добавлены `npm run test:e2e:prod` (`scripts/dev/run-e2e-prod.mjs`,
  `E2E_SERVER_MODE=prod` в playwright-конфиге) и `E2E_LOW_RESOURCE=1` (без записи
  trace/video). Настоящая причина падения 2 интерактивных editor-тестов — не среда,
  а устаревшие ожидания спека (экранные указатели `info-topbar` после нормализации
  UI-манифеста Antarctica; имя кнопки simple-choice) плюс перехват кликов iframe
  открытой JSON-панелью; спек обновлён (выбор по `data-preview-label`, активный файл
  `ui/web.authoring.json`, сворачивание JSON-панели). Продуктовый код не менялся.
  Детали — `docs/reviews/2026-07-05-remediation-closeout-and-e2e-blockers.md` §7.
  Следующий срез: `EditorWorkspace` Phase 4 (декомпозиция), затем Phase 1 контрактов.
- 2026-07-05 (срез B): **декомпозиция `EditorWorkspace` выполнена** (Phase 4
  модуляризационного TSK, Opus-субагент; поведение сохранено, гейт
  verify:editor-engine 38 + typecheck + 105 unit + e2e 8/8). Гейт нашей Phase 3
  со стороны модуляризации снят: дерево/панель кладутся на декомпозированные
  панели `apps/editor-web/src/components/workspace/`. Для Phase 2 (кэш) остаётся
  пред-условие «профилирование загрузки». Следующий срез: Phase 1 контрактов
  editor-engine (1.1 occurrences → 1.2 риск-политика → 1.3 readPointerPrefixes →
  1.4 схема фикстур → 1.5 schema-признаки отображения/декоративности).
- 2026-07-05 (Phase 1.1, готово): вхождения сущностей в TreeViewModel по spec §2.1 —
  `TreeViewNode.entityId`/`occurrenceKind` (аддитивно, по умолчанию `primary`),
  обратный индекс `TreeViewModel.nodesByEntityId`, `buildEntityTreeViewModel`
  принимает `EditorEntityProjection` (дерево не строит свой индекс, ADR-052).
  Поле `id` узла оставлено как `nodeId` из §2.1 (уже уникально, включает путь) —
  задокументировано в типе. verify:editor-engine 42/42. Cross-document occurrences
  и UI-подсветка/auto-reveal — Phase 3.
- 2026-07-05 (Phase 1.2, готово): `classifyChangeSet` в `change-risk.ts`
  (safe/structural/dangerous + reasons; max-risk-wins; входящие ссылки — только из
  проекции) и единая точка применения агентских ChangeSet в editor-web
  (`applyPlannedAiChangeSet`: панельный чат, регион/промт сущности, прототипные
  операции; dangerous → approval envelope ADR-047, отклонение фиксируется без
  мутации документа). verify 54/54 + typecheck + 105 unit. Известное ограничение:
  identity/reference-поля распознаются generic naming convention (`id`, `*Id`,
  `*Ref`…) — кандидат на schema-driven признак вместе с Phase 1.5; интерпретатор
  текстового режима (Phase 4) обязан идти через ту же единую точку.
- 2026-07-05 (Phase 1.3, готово): декларации зависимостей линз — новый контракт
  `ProjectionLens` c `readPointerPrefixes`/`documentKinds`, реестр
  `PROJECTION_LENSES` (1:1 к существующим collectors, включая честную линзу
  `preview-facets` с корневым префиксом), `PROJECTION_LENS_SET_VERSION`, хелперы
  `pointersOverlap`/`pointerAffectsLens`/`collectAffectedEntities` (затронутость
  двунаправленная: правка ниже И выше префикса; источники — только sourcePointers
  проекции, ADR-052). verify 70/70 + editor-web typecheck. Механизм
  инвалидации/кэша не реализовывался — это Phase 2.1.
- 2026-07-05 (Phase 1.4, готово): `state-fixture.schema.json` (draft-07, strict-clean,
  additionalProperties:false; обязательные id/_label/state/manifestHash, опциональные
  screenRef/stepRef/sourceTraceRef/note — sourceTraceRef информационный, протухание
  допустимо) + engine-модуль `state-fixture.ts`: `computeManifestContentHash`
  (sha256 по отсортированным files path+content), `validateStateFixtureSemantics`
  (`fixture-stale` warning по хешу; `fixture-unknown-ref` error — код добавлен в
  реестр spec §4), id-коллекторы поверх существующих проекций. Ajv — через общий
  `createSchemaRegistry` (strict:true, без исключений). verify 85/85 + typecheck +
  verify:manifest-authoring. Runtime/player/compiler фикстуры не читают (инвариант
  соблюдён). Live-валидация в editor-web и CI-валидация коммитнутых фикстур —
  вместе с потребителями (Phase 5).
- 2026-07-05 (Phase 1.5, готово — Phase 1 закрыта целиком): декларативные признаки
  `_requiresView` (true | {channels:[...]}) и `_decorative` в
  manifest-authoring-common.schema.json (на semanticEntity И authoringDefinition),
  вырезаются компилятором (AUTHORING_KEYS) и ловятся CI leak-scan; примеры
  authoring-v2 обновлены. Диагностики `entity-missing-view` (по activeChannel,
  view-фасет канала) и `entity-view-orphan` (недекоративный ui-component без
  ссылки на game-сущность; transitively по поддереву, id/Ref-поля как в
  change-risk) считаются в buildEditorEntityProjection декларативно — без
  хардкод-списков типов. PROJECTION_LENS_SET_VERSION 1→2 (кросс-сущностные
  диагностики не пере-считываются частичной инвалидацией — консервативно).
  verify 91/91 + typecheck + manifest-authoring OK. Известные хвосты: инженерное
  наследование `_requiresView` от прототипа (engine пока читает только инстанс) —
  срез при появлении резолвинга _definitions; schema-driven признак
  reference-полей (общий хвост с 1.2).
- 2026-07-05 (профилирование — вход Phase 2, готово): добавлен воспроизводимый
  бенчмарк `npm run profile:editor-load` (scripts/dev/profile-editor-load.mjs;
  медианы по итерациям, JSON в .tmp/) и baseline-отчёт
  `docs/tasks/artifacts/.../profiling-baseline-2026-07-05.md`. Ключевое:
  холодное открытие antarctica ≈ 2.57с, из них compile.game ≈ 1.19с (50%,
  СВЕРХЛИНЕЙНЫЙ рост 146× при входе 31.7× — подозрение на квадратичность в
  deriveChildSources/sourceExists/readPointer authoring-compiler.cjs:195-237 +
  глубокие JSON-clone); location map ≈ 98% времени парсинга (document-store.ts:258);
  разовая инициализация схем+Ajv ≈ 174мс. Окупаемость: уровень 3 ≈ 61% холодного
  открытия, уровень 2 ≈ 39%, уровень 1 — про интерактивность правок (~763мс на
  правку). **Рекомендованный порядок Phase 2: сначала алгофикс компилятора
  (иначе кэш уровня 3 замаскирует проблему — UX §10), затем уровень 3 → 2 → 1.**
  Замеры при фоновой нагрузке хоста (±20% абсолютных мс), доли/ранжирование
  стабильны. verify:editor-engine 91/91; продуктовый код не менялся.
  СТОП по указанию владельца: Phase 2 не начата — ожидает подтверждения.
- 2026-07-05 (алгофикс компилятора, готово): CPU-профиль уточнил диагноз baseline —
  главная квадратичность была в `copySubtreeMappings` (62.7% self-time: линейный
  скан ВСЕХ ключей mappings на каждое действие/экран), а не в
  deriveChildSources/readPointer (~6%). Фикс в authoring-compiler.cjs:
  (1) copySubtreeMappings — O(поддерева) через индекс pointer→позиция (WeakMap,
  DFS-непрерывные диапазоны ключей); (2) мемоизированное инкрементальное
  разрешение указателей resolveAuthoringPointer. Байт-идентичность выхода
  подтверждена (compile:manifests → пустой diff). compile.game antarctica
  895.9→262.2мс (3.42×), composite 1770.9→1158.6мс (1.53×); нормировка на узел
  3.2×→1.24× — сверхлинейность устранена, кэш L3 больше не замаскирует проблему.
  Замеры и уточнение диагноза — в §4/§9 profiling-baseline-2026-07-05.md.
  verify:manifest-authoring OK, verify:editor-engine 91/91,
  compiler-workflow.test 7/7. СТОП по указанию владельца: следующий шаг
  (Phase 2.3 кэш уровня 3: компиляция+Ajv) не начат.
- 2026-07-05 (решение владельца): **параллелизм компиляции/кэша обязателен в
  дизайне Phase 2** — production-сервер будет многоядерным; «не параллелить»
  было ограничением dev-хоста, не архитектуры. Следствия зафиксированы в
  profiling-baseline-2026-07-05.md §9.6: независимые compile-задания через пул
  worker_threads с конфигурируемой степенью параллелизма (по умолчанию
  availableParallelism, env-override для слабых хостов), Ajv-кэш per-worker по
  хешу схемы, дисковый кэш L2/L3 с атомарной записью и конкурентным доступом.
  Статус: остановка перед Phase 2.3 сохраняется — ждём команды на старт.
- 2026-07-05 (Phase 2.3 — кэш уровня 3, готово): compile-cache.cjs (ключ =
  formatVersion + хеш кода компилятора + хеш 8 схем + kind/пути + хеш authoring;
  атомарная запись temp+rename в .tmp/editor-cache/compile/, любой сбой чтения —
  молчаливый промах) + per-worker/per-process переиспользование Ajv
  (getSharedAjv, shared schema registry editor-web ≈ −137мс/запрос) +
  worker_threads-пул compileJobs (§9.6: default availableParallelism,
  CUBICA_COMPILE_CONCURRENCY override; воркеры чистые, все side effects в главном
  потоке в порядке заданий — выход детерминирован и байт-идентичен
  последовательному) + телеметрия hit/miss/длительностей (CLI-сводка + поля в
  результате compile-workflow editor-web). Кэш включён в editor-пути и
  compile:manifests, ВЫКЛЮЧЕН в CI drift-check (честная компиляция; env-override).
  Числа: warm hit antarctica 264.5→29.5мс (7.6×); CLI-пул на нагруженном 4-ядернике
  медленнее последовательного (ожидаемо по §9.6 — ценность в конфигурируемости).
  Гейты: байт-идентичность ×2 (cold/warm) + seq-режим, manifest-authoring,
  engine 91, editor-web typecheck+105. Замер в §9.7 baseline. Планируемый
  остаток: GC/LRU дискового кэша — вместе с L2 (запись §9.7.6).
- 2026-07-05 (Phase 2.1 — инкрементальная инвалидация L1, ядро готово):
  `updateEditorEntityProjection(previous, next)` + `createEditorEntityProjectionState`
  в entity-projection.ts. Дизайн correctness-first: быстрый путь берётся ТОЛЬКО
  для скалярных правок, доказуемо не меняющих топологию/идентичность/ссылки
  (label-refresh, no-effect); всё остальное — честный полный rebuild, поэтому
  кросс-сущностные производные (identity-диагностики 1.5, индексы ссылок) не
  бывают устаревшими ПО ПОСТРОЕНИЮ (заметка «version 2 = full rebuild из-за
  диагностик» устарела, комментарий у PROJECTION_LENS_SET_VERSION переписан).
  Главный гейт — эквивалентность: deep-equal инкремента и полной пересборки на
  16 тестах (синтетика + детерминированный fuzz по всем указателям реальных
  antarctica/simple-choice; классы: leaf/label/link/link-в-массиве/id-rename/
  ui-фасет/_decorative/_requiresView/метрики/add-remove/замена выше префикса
  линзы). Числа (antarctica, 222 сущности): 0.91мс против 44.5мс (≈49×), 1
  rebuilt/221 reused. Телеметрия в отчёте функции; профиль-стадии
  edit.incrementalProjection/fullProjectionRebuild; §9.8 baseline. verify 107/107
  + typecheck + 105. Клиентская привязка НЕ подключена (точки зафиксированы в
  §9.8/отчёте: previousState ref в контроллере, changed pointers на трёх
  patch-точках, full rebuild для Monaco free-text) — следующий срез.
- 2026-07-05 (Phase 2.1b — клиентская привязка инкремента, готово; + фикс barrel):
  срез вскрыл пред-существующий дефект Phase 1.4 — `computeManifestContentHash`
  (node:crypto) ре-экспортировался из barrel, достижимого из браузерных
  компонентов → `next build` editor-web был сломан с d19f999 (гейты срезов
  typecheck+unit это не ловили). Исправлено: node-only модуль
  `state-fixture-hash.ts` + subpath-export `@cubica/editor-engine/state-fixture-hash`;
  barrel хранит только browser-safe семантическую валидацию. **Урок процесса:
  после любого изменения фасада engine гонять `verify:editor-web` (build).**
  Привязка 2.1b: `createEditorViewModel` принимает `incremental`
  (previousState+changedPointersByFile) и возвращает `projectionState`+
  `incrementalReport`; контроллер держит projectionStateRef, одноразовый
  pendingProjectionEditRef с text-guard (защита от гонок/StrictMode), указатели
  берутся из реально применённых операций на трёх patch-точках (property/graph/
  единая точка ChangeSet), Monaco free-text и undo/redo/load — полный rebuild.
  apply-функции адаптера возвращают операции (EditorAuthoringEditResult).
  Гейты: engine 107, typecheck, unit 108 (3 новых adapter-теста эквивалентности),
  build восстановлен, e2e 8/8 (34.6с).
- 2026-07-05 (Phase 2.2a — дисковый кэш L2, серверная часть, готово):
  сериализация снапшота DocumentStore (document-snapshot-serialization.ts,
  версионированный конверт, строгий revive → null при несовпадении;
  createTextLocationMapFromEntries для восстановления карты без повторного
  парсинга) + editor-file-cache.ts (.tmp/editor-cache/files/, ключ =
  SHA-256(FILE_ARTIFACT_CACHE_FORMAT_VERSION + DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION
  + filePath + текст); версия линз в ключ сознательно НЕ включена — снапшот от
  неё не зависит; schema/semantic-валидация в L2 НЕ кэшируется — text-only ключ
  не хеширует схемы, это покрывает L3). Подключено в оба snapshot-места
  compiler-workflow (отложенная fire-and-forget запись), телеметрия
  fileCacheTelemetry рядом с L3. GC/LRU ВСЕГО .tmp/editor-cache/ (env
  CUBICA_EDITOR_CACHE_MAX_BYTES, дефолт 256MB, LRU по max(atime,mtime)) подключён
  к garbageCollectEditorSessions ADR-042 (+ручной вызов) — закрыт хвост §9.7.6.
  Замер: antarctica 538KB — build 169.2мс / revive 56.1мс (3.0×). Гейты: engine
  111 (+4), editor-web 116 (+8), typecheck, build, e2e 8/8. Остаток L2: проектные
  артефакты (проекция/граф) + гидратация клиента — срез 2.2b.
- 2026-07-05 (Phase 2.2b — L2 проектный артефакт (проекция) + гидратация клиента,
  готово): сериализация `EditorEntityProjection`
  (`editor-entity-projection-serialization.ts`, browser-safe: версионированный
  конверт `formatVersion`+`lensSetVersion`, строгий revive→null; Map-индексы НЕ
  сериализуются, пересобираются общим экспортированным `reindexEditorEntityProjection`,
  которым теперь пользуются и билдер, и инкремент, и revive — DRY). Серверный кэш
  `editor-project-cache.ts` (`.tmp/editor-cache/projects/`, ключ =
  SHA-256(формат-версии + `PROJECTION_LENS_SET_VERSION` + путь + текст);
  отложенная запись; телеметрия hit/miss/read/build); общие дисковые примитивы
  вынесены из `editor-file-cache.ts` (resolveEditorCacheDir/read/writeAtomic/
  isEditorCacheEnabled) — без дублирования; GC L2a рекурсивно покрывает `projects/`.
  Пиггибэк в `/api/editor/file` GET (best-effort, при ошибке поле опущено).
  Гидратация клиента — **вариант (а)**: `createEditorViewModel` принял
  `hydratedProjection` (подставляется как есть, без update-вызова), контроллер —
  одноразовый `pendingHydrationRef` с revive+verify по `documentHashes`
  (hashEditorText) и text-guard, зеркало паттерна `pendingProjectionEditRef`; при
  любом несовпадении/повреждении — молчаливый полный rebuild.
  **Решение/отклонение**: артефакт и ключ ОДНОдокументные (живой клиент строит
  проекцию над одним открытым файлом; мультидок game+ui нарушил бы прозрачность
  кэша hit≡miss и «выкл. кэш = текущее поведение»). Буквальный req 2 (ключ по
  game+ui) отложен до перевода клиента на проектную проекцию; полный список
  входов ADR-052 задокументирован в комментарии ключа (инвариант §10).
  **Граф/деревья НЕ гидратируются** (req 5, по бюджету) — follow-up. Числа
  (profiling §9.9): projection build→revive ≈44–116мс → ≈0.8мс (≈141×); конверт
  99КиБ. Гейты: engine 114 (+3), editor-web 123 (+7: 5 project-cache + 2 adapter
  hydration), typecheck, build (barrel чист — node:crypto не течёт в клиент),
  e2e 8/8 (37.4с). Follow-ups: (A) конверты графа/деревьев + гидратация (≈700мс);
  (B) проектная (game+ui) проекция клиента → ключ по req 2.
- 2026-07-05 (Phase 2 — закрыта): все уровни кэша реализованы и подтверждены
  телеметрией: L1 инкремент (49×, 2.1+2.1b), L2 файлы (revive 3×, 2.2a) +
  проектная проекция с гидратацией клиента (141×, 2.2b), L3 компиляция+Ajv
  (7.6×, 2.3) поверх алгофикса компилятора (3.4×); GC/LRU общий; телеметрия
  hit/miss/длительностей на каждом уровне (CLI + поля workflow + отчёт
  контроллера) — acceptance-пункты «тёплая загрузка использует кэш» и
  «инкрементальная правка не вызывает полной пересборки» выполнены. Замеры —
  baseline §9.7–§9.10. Follow-ups Phase 2: (A) конверты графа/деревьев
  (~700мс тяжёлой игры), (B) проектная game+ui проекция в контроллере —
  естественная часть Phase 3 (дереву нужна мультидок-проекция).
  ОСТАНОВКА по указанию владельца: Phase 3 не начата.
- 2026-07-07 (Phase 3.a — проектная game+ui проекция, готово; фундамент дерева):
  контроллер editor-web переведён с однодок- на ПРОЕКТНУЮ EditorEntityProjection
  (game authoring + все ui-каналы). Сервер (`/api/editor/file` GET, без нового
  маршрута) отдаёт sibling-документы `{filePath,text,documentKind,channel?}`,
  server-derived `activeChannel` и проектный конверт проекции; классификация
  game/ui по `_manifestType` (game-agnostic, не по именам), best-effort с
  fallback на однодок. Контроллер парсит siblings разово на открытие (memo),
  прокидывает `activeChannel`, инкремент сохранён пофайлово (правка game-дока
  пересобирает свои сущности, ui переиспользуются — доказано мультидок-fuzz
  ядра 2.1). Ключ проекционного кэша (закрыт follow-up B / §10-инвариант
  ADR-052) хеширует ВСЕ документы (length-prefixed путь+текст, сортировка) +
  activeChannel + версии; `PROJECT_ARTIFACT_CACHE_FORMAT_VERSION` 1→2; гидратация
  проверяет хеши всех документов + счётчик. Бонус: verbatim-reuse проекции на
  selection/expand-рекомпутах (было — полный rebuild). Числа antarctica: 217
  сущностей, 39 с view-фасетами (кросс-документные game↔UI связи есть); тёплое
  открытие revive 1.1мс vs build 88.4мс (≈83×). Гейты: engine 114, editor-web
  typecheck+123, build, e2e 8/8. Окружение: `npm install` штатно создаёт symlink
  `@cubica/view-protocol` (после ADR-064) — воспроизводимо, не хак.
- 2026-07-07 (Phase 3.b.1 — grouping-aware дерево сущностей в ядре, готово):
  `buildEntityGroupingTreeViewModel({projection, grouping:"byScreen"|"byType",
  documents, activeChannel, activeScreenEntityId})` в новом `entity-grouping-tree.ts`
  (существующий `buildEntityTreeViewModel` не тронут). Аддитивные поля узла:
  entityKind, groupingRole ("prototype"/"screen-logic"), isNonVisual, isDecorative,
  isActiveContext, locationBreadcrumb, diagnosticSeverityCounts (данные бейджей).
  «По экранам»: экраны активного канала (doc-order), UI-вложенность с entityId
  ссылки, подгруппа «Логика экрана» для невизуальных с view-фасетом в поддереве
  экрана, primary = первое появление в pre-order. «По типам»: прототипы (отличимы,
  label из `_definitions[type]._label`) → экземпляры с крошкой; primary = экземпляр
  под своим типом, вложенные чужие = occurrence. documents нужны из-за
  декларативных `_type`/`_definitions`/`_decorative` (проекция — SSOT identity/
  links/diagnostics). 19 тестов (нейтральная фикстура + antarctica), детерминизм
  порядка (numeric-aware pointer comparator + localeCompare). verify:editor-engine
  133, editor-web typecheck. Числа antarctica byType: 13 типов, 217 primary, 100
  occurrence. Честные ограничения (не дефекты — follow-ups отдельного среза
  проекции): реальный web-манифест antarctica не имеет game↔UI ссылок → byScreen
  на нём без cross-links (фикстура покрывает); проекция ключует ui-компоненты по
  подстроке "component" → именованные прототипы antarctica не captured; intrinsic-
  vs-foreign членство прототипа проекция не несёт (ADR-050) → все вложенные =
  occurrence (литеральное правило §7). Следующий срез 3.b.2 — UI дерева по макету.
- 2026-07-07 (Phase 3.b.2 — UI дерева сущностей, готово): компонент
  `workspace/entity-tree.tsx` встроен третьим режимом существующей панели
  «Manifest» рядом с Tree(JSON)/Graph (aria-label существующих не тронуты →
  e2e-селекторы целы). Сегментированный переключатель «По экранам/По типам»,
  поиск (по `_label`/диагностикам/меткам предков), occurrence-строки курсивом
  «— тот же объект ↗» с мягкой подсветкой всех узлов той же сущности,
  прототип-строки с тегом «Прототип», крошки «Экран … ›», подгруппа «Логика
  экрана» (свёрнута), пометка «невизуальный», оранжевый бейдж диагностик из
  `diagnosticSeverityCounts`; auto-reveal активного экрана через
  `resolveActiveScreenEntityId`; клик синхронизирует preview/graph/properties
  через существующий selection-путь; Enter в поиске выбирает первую сущность.
  Режим группировки персистится в localStorage (в приложении нет per-user
  store — ближайший аналог, зафиксировано в коде). Тесты — паттерн проекта
  react-dom/client+act (RTL в репо не используется): 5 юнит-тестов.
  Гейты: typecheck, unit 128, build, e2e 8/8 (подтверждено ИНДЕПЕНДЕНТНО
  оркестратором — субагент шёл ~6ч и завершился штатно, самопроверял скриншотом).
  Отложено (не в срезе): «+»-создание (Phase 6), секции Сценарий/Правила/Ассеты
  (Phase 5/8/9), панель сущности (3.c), переключение документа при выборе
  кросс-документной сущности (3.c). ОТКРЫТЫЙ ВОПРОС языковой политики UI
  редактора: макет русскоязычный, chrome редактора английский; дерево сейчас
  когерентно смешивает (английский chrome «Entities»/«Search» + русские
  доменные подписи из макета) — нужна политика владельца, чтобы не
  дрейфовать; править точечно до решения не стал (не изобретать на пробеле).
- 2026-07-07 (Phase 3.c — панель сущности, готово; Phase 3 закрыта): плавающий
  инспектор `workspace/entity-inspector.tsx` над preview (в `.preview-frame-shell`,
  слой `pointer-events:none` не перехватывает выделение; алгоритм свободного
  квадранта мимо bounds; Esc; переиспользование окна; нижняя панель на узких
  экранах). Заголовок `_label` (инлайн-правка если источник в открытом документе),
  тег прототипа, иконки источник/закрепить (неактивны, Phase 4/позже). Чипы
  «Смысл/Содержание/Вид · <канал>» — свёртка 6 движковых `EditorEntityFacetKind`
  в 3 канонических чипа макета (logic/state/plugin→Смысл, content→Содержание,
  view/design→Вид) + переключатель канала; нет чипа «Вид» у невизуальной; чип-
  предупреждение «создать вид» при `entity-missing-view` (создание — Phase 6).
  Поля по фасетам с бейджем источника (игра/UI·<канал>/ассет); значимые поля —
  через тот же `isTechnicalKey`, что YAML-проекция. Подсветка «изменено агентом»
  из `aiDiffSummary` (до следующего действия). Правка активного документа —
  существующим property-edit путём; кросс-документное поле — read-only +
  «↗ Открыть <файл>» (в неоткрытый файл не пишем). Промт-строка внизу (интерпретатор
  «Применить как намерение» — Phase 4). aria-label «Entity inspector» (e2e-селекторы
  целы). Отложено: интерпретатор/текстовый режим (Phase 4), создание вида (Phase 6),
  кросс-документная запись, док/pin, эскалация в сессионный чат, мультивыбор (в
  UI ещё нет — панель одиночная). Гейты независимо переподтверждены оркестратором
  на чистом слейте: typecheck, unit 133 (+5), build, e2e 8/8 (32.4с). Язык
  согласован с 3.b.2 (англ. chrome / рус. доменные подписи; вопрос политики открыт).
  **Итог Phase 3: дерево (3.b) и панель (3.c) по эталонному макету (зоны 2, 4)
  реализованы поверх проектной проекции (3.a).**
- 2026-07-07 (Phase 4.1 — интерпретатор возвращённого намерения в ядре, готово):
  `interpretReturnedIntent(input, options)` в новом `returned-intent.ts` +
  контракт §2.2 (`ReturnedIntentInput`/`InterpretationLineReport`/
  `ReturnedIntentResult`) в types.ts. Проекция HAND-ROLLED (без yaml-зависимости),
  поэтому быстрый путь — построчный LCS-диф возвращённого текста к исходной
  проекции через новый `facetSourceMap` (добавлен АДДИТИВНО к
  `EditorEntityYamlProjection`: по одной строке-источнику на строку text,
  byte-identical, hidden-поля не в карте; 133 прежних теста целы). Правило
  быстрого пути: пара удалённой/вставленной строк с идентичным префиксом
  «ключ:» (до `valueStart`) = изменение значения известного ключа → replace по
  pointer; инверсия `formatYamlScalar` через JSON.parse; тип-смена число→текст
  отвергается → agent. ИНВАРИАНТ: applied ⇔ есть op в ChangeSet ⇔ path
  "deterministic"; любой нераспознанный фрагмент → весь возврат в agent
  (changeSet:null, would-be-applied → recognized-no-change), НЕТ частичного
  механического применения (§5). Удаления консервативны: чисто удалённый
  единичный блок коллекции → deterministic remove, неоднозначное (object-item
  «-») → agent; скаляр → no-change; пустой ввод → no-op (не масс-удаление).
  Три корзины applied/recognized-no-change/unrecognized, hard-guard против
  пустого отчёта при непустом diff. prompt-stale: сверка sourceHashes с
  options.currentSourceHashes до диффа, короткое замыкание. 11 eval-фикстур
  (ADR-038/§6) как расширяемый JSON-корпус. verify:editor-engine 149 (+16),
  editor-web typecheck. Контрактная заметка: свежие хеши как опциональный
  options.currentSourceHashes (verbatim-вход §2.2 не тронут) — 4.2 их
  пересчитывает из DocumentStore. Следующий срез 4.2 — текстовый режим панели
  («источник», «Применить как намерение») + агентский путь + прогон детерм.
  ChangeSet через classifyChangeSet→dry-run→validation→undo journal + телеметрия.
- 2026-07-07 (Phase 4.2 — текстовый режим панели + применение намерения, готово;
  Phase 4 закрыта): `entity-source-text-mode.tsx` — иконка «источник ⌗» в
  инспекторе открывает редактируемую моноширинную промт-проекцию (textarea, не
  Monaco: плавающая панель, единственный editorRef занят JSON-сайдбаром, §3.2
  разрешает; макет показывает моноширинный блок), бейдж «хеш источников: захвачен».
  Захват при открытии: projectionYaml/facetSourceMap из
  `buildEditorEntityYamlProjection`, sourceHashes через `hashEditorText` по всем
  файлам-источникам сущности. «Применить как намерение»: пересчёт fresh
  currentSourceHashes из живого стора → `interpretReturnedIntent` → stale→плашка
  (не применять); deterministic+changeSet → СУЩЕСТВУЮЩАЯ единая точка
  `applyPlannedAiChangeSet` (classify→approval dangerous→dry-run→validation→undo→
  apply, инкремент 2.1b); agent → реальный форвард в существующий
  `/api/editor/ai/patch` (без нового LLM-инструмента), fallback на ручную
  эскалацию в чат если нет активно-документного таргета. Построчный отчёт трёх
  корзин (применено/распознано-без-изменений/не распознано) на виду. Телеметрия
  §5 (`returnedIntentTelemetry`: доли det/agent/stale, размеры корзин) в
  контроллере. aria-labels новые (e2e-селекторы целы). Отложено: новый LLM-
  инструмент для agent, региональный/мультивыбор текстовый режим, кросс-файловая
  det-правка (блокируется платформенным инвариантом единой точки — активный файл).
  Гейты независимо переподтверждены оркестратором: typecheck, unit 138 (+5 на
  реальном интерпретаторе), сборки обоих приложений в одиночку, e2e 8/8 (53.7с,
  OOM-безопасным путём через готовые серверы — конкурентная сборка editor-web
  под нехваткой памяти хоста убивается, §3 doc блокеров, это средовое).
  **Итог Phase 4: интерпретатор (4.1) + текстовый режим (4.2) — безопасное
  текстовое/агентское редактирование через промт-проекцию реализовано.**
- 2026-07-07 (Phase 5.1 — политика применения к предпросмотру, готово): новый
  ортогональный верхнеуровневый режим `editorMode: "design"|"preview"` (зона 1
  переключатель, aria «Editor mode» — не пересекается с Play/Inspect «Preview
  mode» и кнопкой «Preview»; default design). Ключевая находка/фикс: раньше
  ЛЮБАЯ правка звала `clearPreparedPreview()` → previewUrl=null (правка
  «выдёргивала» preview — нарушение §4.8/§9.2); теперь 5 edit-путей зовут
  `softenPreviewForEdit()` (сохраняет previewUrl+сессию+трассу, гасит только
  выбор/prompt), Save/загрузка — без изменений. «Дизайн»: debounce 800мс по оси
  свежести → авто-применение (persist буфера в session-worktree → компиляция+
  preview). «Превью»: плашка «Предпросмотр отстаёт от правок — Применить»
  (когда freshness=stale и пайплайн свободен) → ЛЕСТНИЦА восстановления
  (`planPreviewRecoveryLadder`, чистая): current-step → nearest-snapshot+replay →
  step-start → restart, каждая ступень простыми словами (совместимость — по
  форме трассы + ok/ошибка существующего restore-endpoint; runtime-контракт НЕ
  менялся). Индикатор свежести зона 7: актуален/отстаёт(`preview-stale`)/
  заблокирован(`preview-blocked`), цветной маркер, коды в data-diagnostic-code.
  Словарь осей не смешан (undo=документ, restore=прохождение). Гейты независимо
  переподтверждены: typecheck, unit 153 (+15), сборки обоих в одиночку, e2e 8/8
  (36.6с, OOM-безопасно). Приглушение старых событий трассы (`.step.old`
  макета) — follow-up 5.2 (нужен per-event хеш манифеста + сохранение/replay
  трассы через apply). Следующий срез 5.2 — фикстуры.
- 2026-07-07 (Phase 5.2 — фикстуры состояния, готово; Phase 5 закрыта): серверный
  `editor-fixture-store.ts` (хеш+id-множества из worktree-манифестов, Ajv через
  registry + `validateStateFixtureSemantics`, запись `games/<id>/authoring/
  fixtures/<id>.json`, листинг с verdict stale; `computeManifestContentHash` из
  node-only subpath — без утечки в браузер) + маршрут `/api/editor/fixtures`
  (GET список / POST закрепление в session worktree → коммит на Save, ADR-052).
  «Закрепить как фикстуру» (timeline зона 6): диалог `_label`, снимок текущего
  состояния preview, server стампует manifestHash и валидирует до записи. Селектор
  «Состояние: …» (модбар зона 3, только Дизайн): закреплённые + синтетика; выбор →
  `applyFixtureToPreview` → состояние в preview через СУЩЕСТВУЮЩИЙ
  `/api/editor/preview/rollback` (тот же путь, что рестор чекпоинта; runtime-
  контракт не менялся). Порядок §9.3: фикстура активного экрана → первая
  закреплённая → синтетика. `fixture-stale`: сервер сверяет хеш (list+pin),
  селектор помечает «устарела». Удержание авто-чекпоинтов `retainPreviewCheckpoints`
  (последние N/сессия, env дефолт 20) подключено в `garbageCollectEditorSessions`
  (ADR-042, тот же GC-цикл, что кэш 2.2a). runtime/player файлы фикстур не читают
  (инвариант §5). Гейты независимо переподтверждены: typecheck, unit 164 (+11),
  сборки в одиночку, e2e 8/8 (44.5с). Отсрочки: приглушение старых событий трассы
  (нужен per-event хеш + non-resetting трасса — вне среза), `screenRef`/`stepRef`
  при закреплении (нет надёжного маппинга trace→step/screen; полный state
  авторитетен), «обновить снимок» (пока — ручное пере-закрепление).
  **Итог Phase 5: оси времени разделены, фикстуры — проверяемый authoring-
  артефакт с preview-only restore и GC.**
- 2026-07-07 (Phase 6.1 — строители операций сущностей в ядре, готово):
  `entity-operations.ts` — 4 чистых детерминированных строителя EditorChangeSet
  (§2.8 дословно): `buildCreateEntityChangeSet` (атомарный мультифайловый ChangeSet:
  game-фасет `add /root/content/<id>` + для визуальных типов UI-узел
  `{id,_type,_label,gameEntityId:<id>}` в UI-документ активного канала, контейнер
  по `containerPointer` или дефолт `/root/children`; визуальность по декларативному
  `_requiresView` из 1.5, не по хардкод-типу; невизуальный → только game),
  `buildCreatePrototypeChangeSet` (baseType → `_definitions`; fromEntityId →
  существующий prototype-extraction, ADR-050), `buildDeleteEntityChangeSet`
  (referencePolicy abort/clean/retarget; входящие ссылки — тот же индекс, что
  change-risk; удаление фасетов deepest-first), `buildRenameEntityIdChangeSet`
  (replace id + всех входящих ссылок UI→game по всем документам; risk через
  существующую classifyChangeSet = dangerous). id-слаг: инлайн кириллица→ASCII
  (без зависимости), уникальность по проекции. Связи ТОЛЬКО из
  EditorEntityProjection (ADR-052). 15 тестов, engine 164, editor-web typecheck.
  (2 первично упавших теста были багами тестов — билдеры корректны, исправлены на
  верной стороне.) Документированное допущение: game-фасет по умолчанию в
  `/root/content/<id>` (§2.8 задаёт containerPointer только для UI). НЕ применяет
  ChangeSet — мультидок-применение + UI это срез 6.2.
- 2026-07-07 (Phase 6.2a — мультидок-применение + «+»-создание, готово): заполнен
  пробел применения принятого мультифайлового контракта EditorChangeSet.
  `multi-document-apply.ts` (`dryRunMultiDocumentChangeSet`): dry-run/валидация ВСЕХ
  затронутых документов через существующий движковый dryRun (срез-на-файл, чтобы не
  сработал отказ ядра); атомарно — ошибка в любом → не применяется ничего; объединённый
  inverse + changedPointersByFile. Модель атомарности 1: dry-run/validate все in-memory
  → durable серверная запись siblings в session worktree (`/api/editor/apply` →
  `applyAuthoringFilesToWorktree`, all-or-nothing с откатом, коммит на Save, по образцу
  5.2) → только после успеха применение активного in-memory + зеркалирование в проекцию
  (единственная async-граница ДО изменения активного фасета → нет наблюдаемого расщепления
  фасетов). Undo/redo мультидок: `reapplyMultiDocumentStep` переигрывает commit с
  inverse/forward (siblings на диске + активный в памяти вместе). Инкремент 2.1b —
  указатели всех файлов. «+»-создание в дереве (§3.1): кнопка + компактное меню типов/
  прототипов с поиском и `_label` (невизуальные помечены; пустые секции — приглашение);
  «По экранам» контейнер=выбранная сущность/верхний уровень, «По типам» новый прототип;
  через единую точку `commitMultiDocumentChangeSet`; auto-select новой сущности. Гейты
  независимо переподтверждены: typecheck, unit 173 (+9, включая атомарность мультидок и
  create на реальных манифестах), сборки в одиночку, e2e 8/8 (29.5с). **СТОП-вопрос
  владельцу (не изобретал): apply-гейт валидирует ВЕСЬ after-документ, поэтому создание
  блокируется, если в целевом документе есть ПРЕД-существующие blocking-ошибки (напр.
  antarctica: 71 `cards` без `_label`) — это консистентно со всем текущим apply, не
  регресс; смягчение (гейт «нет НОВЫХ ошибок») — платформенная политика, затрагивает все
  операции.** Отложено 6.2b: delete-диалог, rename-UI, «создать вид», drag прототипа;
  мультидок для agent/returned-intent путей; недавние/частые в меню.
- 2026-07-07 (Phase 6.2b — UI удаления/переименования/«создать вид», готово):
  ядро аддитивно получило `buildAddViewFacetChangeSet({entityId, channel,
  containerPointer?})` (UI-узел `{id,_type,_label,gameEntityId:id}` для
  существующей сущности; game-фасет не трогает; structural). editor-web:
  `entity-refactor-dialog.tsx` — `DeleteEntityDialog` (фасеты + входящие ссылки
  из `buildDeleteEntityChangeSet(abort)` + 3 варианта отменить/вычистить/
  перенацелить с выбором цели) и `RenameEntityIdDialog` (новый id, отказ при
  занятом). Кнопки «Удалить»/«Переименовать» + активный чип «создать вид» в
  инспекторе. Общий `applyEntityOperationChangeSet`: classify → для dangerous
  (rename всегда; удаление со входящими) approval envelope через ТОТ ЖЕ
  `buildEditorApprovalEnvelope`/`validateEditorAgentApproval` (ADR-047, второй
  механизм не вводился) → `commitMultiDocumentChangeSet` (6.2a) → журнал.
  «Создать вид» structural, без approval. Отчёты видимы (status+diff summary).
  Гейты независимо переподтверждены: verify:editor-engine 167 (+3),
  editor-web typecheck + unit 185 (+12), сборки в одиночку, e2e 8/8 (30.9с).
  Отложено (follow-up): перетаскивание прототипа на канвас (hit-test контейнера),
  прицельный контейнер экрана для «создать вид», мультидок для agent/returned-
  intent путей. **Итог Phase 6 (core): создание/удаление/переименование/создание
  вида — атомарные кросс-манифестные операции через единый мультидок-конвейер с
  approval для опасных; drag остаётся follow-up.**
- 2026-07-07 (Phase 7 — очередь интентов, готово): ядро `intent-queue.ts`
  (контракт `QueuedIntent` §2.4 дословно; неизменяемый reducer `IntentQueueEntry`
  + `createIntentQueue()` со stateful-обёрткой, выдающей объекты с `cancel()`;
  `detectIntentConflict` — запись журнала с seq≥baseJournalSeq тронула указатель
  из readPointers∪writePointers через `pointersOverlap`, file-scoped;
  `promoteNextRunnableIntent` — MVP один running; guarded-переходы статусов).
  Интеграция: агентские пути через очередь (промт сущности/региона preview,
  агентский под-путь текстового режима, панельный/сессионный чат — теперь
  «queued», diff/stale в журнале); ручные правки (property/create/delete/rename)
  и ДЕТЕРМИНИРОВАННЫЙ быстрый путь returned-intent — мимо очереди (§9.5
  «детерминированно и дёшево»). Захват baseJournalSeq + read/write указателей при
  submit; writePointers уточняются реальными указателями planned ChangeSet при
  применении; конфликт → `stale` + выбор автора (применить/показать/отменить),
  `intent-stale` info. Очередь ОБОРАЧИВАЕТ единую точку applyPlannedAiChangeSet
  (classify→approval→dry-run→validation→undo), не заменяет. Отмена в полёте на
  уровне очереди (provider-abort — follow-up, нужен AbortSignal). UI-панель
  `intent-queue-panel.tsx` (статусы ожидает/выполняется/применяется/готово/
  ошибка/отменён/устарел + отмена + stale-выбор) в сессионном журнале левого
  сайдбара (правой вкладки «Журнал» ещё нет — mockup right-tabs не реализованы).
  Гейты независимо переподтверждены: verify:editor-engine 187 (+20), editor-web
  typecheck + 197 unit (+12), сборки в одиночку, e2e 8/8 (29.8с). Follow-ups:
  provider-abort (AbortSignal), «применить всё равно» для dangerous stale
  (сейчас fails-closed на approval — безопасно, re-approval future), append-only
  журнал для baseJournalSeq при undo mid-flight.
