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
