# Project Review — 2026-06-27

- **Branch**: `codex/ai-driven-surface-migration`
- **Reviewer**: AI agent (Claude / Opus 4.8)
- **Scope**: текущее состояние ветки относительно `main`, с упором на незакоммиченные изменения рабочего дерева (миграция метрик ADR-054 и in-memory projection редактора ADR-052), плюс общая проверка канонических инвариантов.

## Оглавление

- [Резюме](#резюме)
- [Что проверено](#что-проверено)
- [1. Несоответствия целевой архитектуре](#1-несоответствия-целевой-архитектуре)
- [2. Явные ошибки в коде](#2-явные-ошибки-в-коде)
- [3. Неоптимальный и избыточный код](#3-неоптимальный-и-избыточный-код)
- [4. Что можно улучшить](#4-что-можно-улучшить)
- [Приложение: команды проверки](#приложение-команды-проверки)

## Резюме

Состояние ветки **здоровое**: все канонические проверки и тесты зелёные, типы чистые.
Основные изменения рабочего дерева (каталог игровых метрик и player-facing проекция
по ADR-054, in-memory `EditorEntityProjection` по ADR-052) **запланированы и
задокументированы** соответствующими ADR и задачами `TSK-*`. Неконтролируемого
архитектурного дрейфа не обнаружено.

Главная архитектурная находка — **дублирование интерпретатора JsonLogic**: player-web
реализует собственный частичный вычислитель выражений, тогда как runtime использует
библиотеку `json-logic-js`. Это не зафиксировано как осознанный технический долг и
создаёт риск расхождения вычислений между каналами. Остальные находки — локальное
дублирование хелперов, неоптимальная пересборка проекции метрик на каждый рендер и
несколько мелких улучшений.

## Что проверено

| Проверка | Результат |
| --- | --- |
| `typecheck` player-web / editor-engine / runtime-api / antarctica-plugin | чисто |
| тесты player-web | 124 passed |
| тесты editor-engine | 34 passed |
| тесты runtime-api (`node --test`) | 118 passed |
| `verify:game-agnostic` | OK |
| `verify:manifest-authoring` | OK |
| `verify:agent-ui-boundaries` | OK |
| `verify:api-contracts` (OpenAPI drift) | OK |
| JSON Schema как SSOT для каталога метрик | соблюдено (`game-manifest.schema.json`) |

## 1. Несоответствия целевой архитектуре

### 1.1. (Главное) Два независимых интерпретатора JsonLogic — не задокументированный дрейф

- `apps/player-web/src/lib/metric-projection.ts` вручную реализует вычислитель
  выражений `JsonLogicExpression`, поддерживающий только операторы
  `var, +, -, *, /, min, max`.
- `services/runtime-api/src/modules/runtime/deterministicHandlers.ts` использует
  полноценную библиотеку `json-logic-js` (`jsonLogic.apply(...)`) для guards и
  metric deltas.
- Оба читают **одну и ту же** схему `#/definitions/JsonLogicExpression`
  (`docs/architecture/schemas/game-manifest.schema.json`).

**Почему это проблема.** ADR-054 (§6, §8, §9) требует, чтобы вычисляемые метрики
одинаково понимались всеми каналами. Сейчас выражение, валидное по схеме и
исполняемое в runtime (например с `if`, `>`, `<=`, вложенными операциями), в
player-проекции **молча вернёт `undefined`** и метрика просто исчезнет с экрана.
Для текущего `remainingDays` (`{"-": [dayLimit, time]}`) всё работает, но контракт
шире реализации player-web. Это незадокументированное расхождение целевой
архитектуры: его нужно либо устранить (общий вычислитель), либо явно оформить как
legacy/tech-debt с CI-ограничением допустимых операторов.

### 1.2. Каталог метрик: соответствие ADR-054 — в основном выполнено

- Схема описывает `content.data.metrics` (state/computed), `content.data.rules.dayLimit`
  — SSOT соблюдён, императивного дрейфа нет.
- `games/antarctica/game.manifest.json` содержит каталог: `time` (state) и
  `remainingDays` (computed), legacy-`score` удалён, `resolveMetrics`-хак
  (`score = 60 - time`) убран из плагина. Это полностью соответствует ADR-054.
- **Незакрытый хвост границы**: иконки и фоновые картинки метрик всё ещё живут в
  `games/antarctica/plugins/antarctica-player/src/config-data.ts`
  (`fallbackMetrics`, `metricBackgroundImages`) и в config-слое, тогда как ADR-054
  (§5, §11) относит channel-иконки к UI-манифесту / asset registry. Это допустимый
  legacy fallback (помечен `@deprecated`), но ветка оставляет два параллельных
  источника метаданных метрик. Стоит отслеживать как долг.

### 1.3. Editor entity projection (ADR-052) — соответствует

In-memory `EditorEntityProjection` реализован в `packages/editor-engine` и
потребляется `apps/editor-web` (agent-context, view-model), без persisted
`editor.entities.json`, без зависимости runtime/compiler. Соответствует ADR-052.

## 2. Явные ошибки в коде

**Сборочных/тестовых/типовых ошибок не обнаружено.** Ниже — латентные дефекты.

### 2.1. Молчаливый провал вычисляемой метрики (см. 1.1)

В `metric-projection.ts` `evaluateExpression` для неизвестного оператора и для
выражения с числом операндов ≠ 1 возвращает `undefined` без диагностики. Метрика
тихо пропадает — нет ни лога, ни fallback. Нужна хотя бы диагностика/warn.

### 2.2. Несовпадение ключа фоновой картинки метрики `energy` vs `lid` (pre-existing)

`config-data.ts`: `metricBackgroundImages` содержит ключ `energy`, но id метрики
«Энергия» — `lid` (см. `fallbackMetrics`). Lookup фона по id метрики для энергии не
сработает. Дефект существовал до ветки (diff лишь переименовал `score` →
`remainingDays`), но его стоит исправить заодно.

### 2.3. `verify:prototype-audit-status` жёстко падает (exit 1) без артефакта

`scripts/ci/validate-prototype-audit-status.js` завершается с кодом 1, если нет
`.tmp/prototype-audit/status.json`. Файл генерируется только weekly-аудитом; при
локальном/ручном запуске проверка падает с непрозрачной ошибкой. Проверка не входит
в `verify:canonical`, поэтому канонический срез не ломает, но поведение хрупкое —
лучше деградировать в warning либо явно документировать порядок запуска (после
`audit:prototype-candidates:weekly`).

## 3. Неоптимальный и избыточный код

### 3.1. Дублирование `formatMetricValue`

Идентичная функция реализована дважды:
- `apps/player-web/src/lib/metric-projection.ts:198`
- `apps/player-web/src/components/manifest/game-variable-component.tsx:143`

Вынести в общий util.

### 3.2. Дублирование чтения каталога метрик / `isMetricDefinition`

Логика «прочитать `content.data.metrics`, отфильтровать валидные определения»
повторена (с расхождениями) в:
- `apps/player-web/src/lib/metric-projection.ts` (`isMetricDefinition`, `readMetricCatalog`)
- `games/antarctica/plugins/antarctica-player/src/state-resolvers.ts` (`isMetricDefinition`, `resolveJournalMetricSpecs`)

`metric-projection.ts` уже экспортирует `readMetricCatalog` — плагин должен
переиспользовать его, а не повторять type-guard.

### 3.3. Двойной проход по каталогу метрик на каждый рендер

`GamePresenter.playerState` — это getter, вызываемый на каждый `syncView`/рендер.
Внутри он дважды строит проекцию: `projectMetricsFromContent` и
`projectMetricViewsFromContent`. Каждая заново вызывает `readMetricCatalog`, а
`projectMetricViewsFromContent` ещё и создаёт `createContext` **внутри цикла** по
метрикам. Для одной игры дёшево, но это лишняя аллокация на каждый кадр —
проекцию метрик стоит считать один раз (мемоизация по `session`/`content`).

### 3.4. Параллельные системы метаданных метрик

После миграции сосуществуют game-owned каталог метрик (целевой) и legacy
`FallbackMetricSpec` + `metricBackgroundImages` + `resolveMetrics`-hook (помечены
`@deprecated`). Это осознанный временный fallback, но это «мусор в пути» —
запланировать удаление после полного покрытия экранов каталогом.

## 4. Что можно улучшить

1. **Единый вычислитель JsonLogic.** Вынести один интерпретатор в общий пакет
   (например `packages/contracts/manifest` или отдельный shared-пакет) и
   использовать его и в runtime, и в player-web. Либо — если player намеренно
   поддерживает подмножество — задокументировать это в ADR-054 как legacy и
   добавить CI-проверку, запрещающую в `computed.expression` операторы вне
   поддерживаемого подмножества.
2. **Диагностика невычислимых метрик** вместо тихого `undefined` (см. 2.1).
3. **Тесты `metric-projection`.** Сейчас всего 3 теста на нетривиальный
   вычислитель. Добавить кейсы: неподдерживаемый оператор, отсутствующий путь,
   вложенные выражения, `/ min max`, значение `0` (проверка `??` vs falsy),
   computed без `dayLimit`.
4. **Устранить дублирование** `formatMetricValue` и чтения каталога метрик (3.1, 3.2).
5. **Мемоизация проекции метрик** в Presenter (3.3).
6. **Закрыть границу ADR-054 по иконкам**: перенести иконки/фоны метрик в
   UI-манифест / asset registry и снять legacy `metricBackgroundImages`/`fallbackMetrics`.
7. **Починить ключ `energy` → `lid`** (2.2) или вычислять фон по id из каталога.
8. **Сделать `verify:prototype-audit-status` устойчивым** к отсутствию артефакта (2.3).

## Приложение: команды проверки

```bash
npm run typecheck --workspace @cubica/player-web
npm test --workspace @cubica/player-web
npm run verify:editor-engine
( cd services/runtime-api && npm run typecheck && npm test )
( cd games/antarctica/plugins/antarctica-player && npm run typecheck )
npm run verify:game-agnostic
npm run verify:manifest-authoring
npm run verify:agent-ui-boundaries
npm run verify:api-contracts
```
