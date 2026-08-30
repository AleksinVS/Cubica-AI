# Проекция текущей логики Antarctica (блок 2.2)

Часть задачи TSK-20260719-antarctica-alignment
(`docs/tasks/active/TSK-20260719-antarctica-alignment.md`). Машиночитаемый
результат — `current-logic-projection.json` рядом с этим файлом, строго по
схеме v1 (`.tmp/agent-workflow/TSK-20260719-antarctica-alignment/logic-projection-schema.md`).
Этот файл — короткое пояснение "как построено" и "чем считали полноту", на
русском, без сверки с эталоном (сверка — блок 2.3).

## Как построена проекция

Одноразовый Node-скрипт
`.tmp/agent-workflow/TSK-20260719-antarctica-alignment/2.2/project-manifest.mjs`
читает `games/antarctica/game.manifest.json` (только чтение, ничего в игровых
файлах не меняется) и детерминированно раскладывает его по категориям схемы:

- **metrics** — из `content.data.metrics`; начальное значение берётся из
  `state.public` по указанному `statePath` (для `kind: state`) либо
  помечается как вычисляемое (`kind: computed`) с формулой в `notes`.
- **characters** — из `content.data.teamSelections[].members`; эффекты выбора
  персонажа (изменения метрик, флаги, запись в журнал) взяты из
  `mechanics.plans["opening.team.select.<id>"]`.
- **cards** — из `content.data.cards`, по одной на каждую из 71 карточки.
  `alternatives[0]` — безусловные эффекты выбора карточки (шаги плана без
  `when`); каждый следующий элемент `alternatives` — один шаг плана с
  условием `when` (единственный встреченный в манифесте механизм ветвления).
  `appearsOn` находится через `content.data.boards[].cardIds`.
- **flow** — `entry`/`steps` собраны из `content.data.infos` + `boards` +
  `teamSelections`, сгруппированных по `stepIndex` основной ветки ("main").
  `transitions` — по одной строке на каждое действие, которое двигает
  `public.timeline` (`game.timeline.advance`, `game.info.advance`,
  `game.collection.threshold`, `game.team.confirm`): precondition + безусловный
  эффект + список conditional-веток (`[branch when ... => ...]`).
- **random** — пустой список: полнотекстовый поиск `random|dice|shuffle|roll`
  по всему манифесту дал 0 совпадений, случайности в этой версии игры нет.
- **endings** — реконструированы из шагов с `when`, которые переключают
  `public.timeline.line` в `"loss"`, и из единственного self-loop-перехода
  (`opening.info.i21.advance`, `stepIndex` 38 → 38).
- **unmapped** — всё, что осталось за пределами шести категорий выше,
  перечислено дословно с указанием места в манифесте (12 пунктов).

Псевдоязык условий/эффектов манифеста (`predicate.*`, `core.*` из
`docs/architecture/runtime-mechanics-language.md`) нормализован в короткие
строки вида `set <endpoint> = <value>` / `<left> <op> <right>` — см. функции
`predicateToStr`/`stepToStr`/`valueToStr` в скрипте. Тексты карточек и
инфо-экранов нормализованы (HTML `<p>`/`</p>` → разрыв абзаца, остальные теги
вырезаны) функцией `normalizeText`.

## Чем считали полноту

Скрипт печатает в stdout числовые счётчики "узлов манифеста по типам" и
сколько из них попало в проекцию. Итог прогона на неизменном манифесте:

| Источник в манифесте | Всего | Учтено | % |
|---|---|---|---|
| `content.data.metrics` → `metrics` | 9 | 9 | 100% |
| `teamSelections[].members` → `characters` | 10 | 10 | 100% |
| `content.data.cards` → `cards` | 71 | 71 | 100% |
| `content.data.infos` → `flow.steps` | 26 | 26 | 100% |
| `content.data.boards` → `flow.steps` | 13 | 13 | 100% |
| `content.data.teamSelections` → `flow.steps` | 1 | 1 | 100% |
| `actions` (140) → cards/characters/flow.transitions | 140 | 140 | 100% |
| `mechanics.plans` (140) → cards/characters/flow.transitions | 140 | 140 | 100% |
| command-шагов во всех планах (`assert`+`command`) | 934 | 934 | 100% |
| из них conditional (`when`) шагов | 52 | 52 | 100% |

`actions`/`mechanics.plans` разложены так: 71 `game.card.resolve` → `cards`,
10 `game.team.select` → `characters`, 59 переходов
(30 `game.timeline.advance` + 27 `game.info.advance` +
1 `game.collection.threshold` + 1 `game.team.confirm`) → `flow.transitions`.
71 + 10 + 59 = 140 — без остатка.

Всё, что не относится ни к одной из этих 140 пар action/plan (метаданные
`meta`/`config`, служебная обвязка `mechanics.stateModel`, неиспользуемый
`engine.systemPrompt`, мёртвые поля `state.secret`, висячие ссылки на
несуществующие инфо-экраны) — перечислено в `unmapped` (12 пунктов,
см. JSON).

## Категории `unmapped`

1. `engine.systemPrompt`/`engine.modelConfig` — текст-заглушка, обрывается
   многоточием, ни один action/plan на него не ссылается.
2. `state.secret.stagePicks` и его snake_case-дубликат `stage_picks` —
   объявлены в начальном состоянии, но ни разу не читаются и не пишутся ни
   одним из 140 планов.
3. Висячие ссылки `activeInfoId="i34"` и `activeInfoId="i34_2"` — эти id
   используются в переходах (`opening.card.34`, `opening.card.68.advance`,
   `opening.info.i34.advance`, `opening.info.i34_2.advance`), но
   `content.data.infos` не содержит записей с такими id: текста для этих
   экранов проигрышной ветки в манифесте нет.
4. `mechanics.stateModel.{types,endpoints,events}` (154/42/140 элементов) —
   служебная типовая обвязка, производная от тех же шагов, что уже учтены в
   `cards`/`flow.transitions`; посчитана числом, не продублирована построчно.
5. `content.design.mockups`, `content.methodology.*` — ссылки на UI-макеты и
   методические документы, вне игровой логики.
6. `mechanics.moduleLock`, `mechanics.budgetProfile` — техническая
   метаинформация платформы, не игровая логика.
7. Ветка `opening.card.68.advance` с условием `time < 54` (→ `i19_1`,
   "Быстрый переезд") — отдельно упомянута, чтобы не спутать с loss-ветками:
   это вариативный текст на основной линии, а не концовка.

## Странности манифеста (кратко, без оценки)

- **Манифест реализует только эпизод "opening"**: 100% id действий и планов
  начинаются с `opening.` — это подтверждено и текстом самого манифеста
  (`meta.references[0].note`: "Current factual source for Antarctica
  opening-flow extraction ... not runtime source of truth").
- **Две проигрышные концовки ведут в экраны без текста**: `i34` и `i34_2`
  упоминаются в переходах, но отсутствуют в `content.data.infos`.
- **`state.secret.stagePicks`/`stage_picks`** объявлены, но нигде не
  используются (мёртвое состояние).
- **`engine.systemPrompt`** — нерабочая заглушка, не подключена ни к одному
  action.
- **Дублирование ключей `timeline`**: `stepIndex`/`step_index`,
  `stageId`/`stage_id`, `screenId`/`screen_id` — всегда патчатся парой одним
  шагом (не два разных состояния, а избыточное дублирование имени поля).
- **Рассогласование текста карточек и журнала**: у 59 из 71 карточек
  `content.data.cards[].backText` (текст выбора, показанный игроку) дословно
  отличается от `core.event.emit.summary` того же плана (текста, который
  реально пишется в `public.log`, журнал ходов). У карточек 1–12 тексты
  совпадают дословно, начиная с карточки 13 — расходятся у каждой карточки.
  Проекция берёт `journalEntry` из `core.event.emit.summary` (то, что
  реально происходит в runtime), а исходный `backText` сохранён дословно в
  `cards[].notes`, чтобы не потерять ни один вариант.

## Воспроизводимость

Скрипт не использует `Date.now`/`Math.random`, не зависит от порядка обхода
объектов там, где это могло бы дать разный результат (списки, полученные
через `Object.keys`, явно отсортированы). Проверено двумя прогонами подряд:
`sha256sum` итогового JSON совпадает байт в байт.
