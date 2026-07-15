# ADR-054: Game/UI Manifest Boundary And Metric Projection

- **Дата**: 2026-06-16
- **Статус**: Accepted
- **Авторы**: Codex, владелец продукта
- **Компоненты**: game manifests, UI manifests, player-facing content API, Presenter, `games/*/plugins/*`, manifest schemas, authoring compiler
- **Связанные решения**: ADR-001, ADR-013, ADR-019, ADR-024, ADR-025, ADR-030, ADR-041, ADR-050, ADR-053, ADR-084

## Оглавление

- [1. Понимание решения](#1-понимание-решения)
- [2. Контекст](#2-контекст)
- [3. Термины](#3-термины)
- [4. Принятое решение](#4-принятое-решение)
- [5. Граница ответственности](#5-граница-ответственности)
- [6. Метрики и вычисляемые значения](#6-метрики-и-вычисляемые-значения)
- [7. Тексты карточек и UI-подписи](#7-тексты-карточек-и-ui-подписи)
- [8. Schema and runtime constraints](#8-schema-and-runtime-constraints)
- [9. Архитектурные инварианты](#9-архитектурные-инварианты)
- [10. Отклоненные альтернативы](#10-отклоненные-альтернативы)
- [11. Последствия](#11-последствия)

## 1. Понимание решения

Решение понято так: Cubica фиксирует устойчивую границу между `game`-манифестом и `ui`-манифестом.

`game`-манифест владеет игровым смыслом: предметными сущностями, их текстами, правилами, состоянием, действиями и словарями игровых понятий. `ui`-манифест владеет тем, как эти данные показываются в конкретном канале: экранными вариантами, панелями, расположением, иконками, CSS-классами и UI-only подписями. Presenter строит player-facing projection - подготовленную для игрока модель отображения из игрового контента и session state.

Для `Antarctica` отдельно согласовано:

- `time` - авторитетная игровая метрика "прошло дней";
- `remainingDays` - вычисляемая player-facing метрика "осталось дней";
- `remainingDays` не должен храниться как отдельное изменяемое session state рядом с `time`;
- историческое использование `score` для "остатка дней" не является целевым контрактом.

## 2. Контекст

После нормализации UI-манифеста `Antarctica` и переноса журнала ходов в `ui.panels.history` осталось несколько разрывов границы:

- игровые карточки хранят `title`, `summary` and result text в game manifest, что соответствует предметной модели;
- игровые метрики хранят числовые значения в `state.public.metrics`, но их человекочитаемые подписи и часть семантики находятся в UI manifest;
- topbar/sidebar UI вынужден знать, что `pro` означает "Знания", `rep` означает "Доверие", `lid` означает "Энергия";
- `score` местами используется как отображаемый "остаток дней", хотя фактическая игровая метрика времени должна быть `time`;
- если эти правила не зафиксировать, будущие UI-каналы будут дублировать или по-разному интерпретировать игровые понятия.

Существующие ADR уже задают направление:

- ADR-001 требует разделять Model, View and Presenter;
- ADR-013 отделяет логический манифест от UI-манифестов;
- ADR-019 требует отдавать player-facing content через backend boundary, а не через прямое чтение файлов в player;
- ADR-041 требует, чтобы Presenter строил UI-ready object views, а React-компоненты не решали gameplay rules;
- ADR-053 требует выносить UI-only behavior, например открытие панели журнала, из game manifest.

Это решение уточняет границу для игровых текстов, метрик и вычисляемых display values.

## 3. Термины

- **Игровой смысл** - значение сущности в правилах и методике игры: что такое карточка, метрика, персонаж, этап, действие или событие.
- **UI-only подпись** - текст, который обслуживает интерфейс конкретного канала и не меняет игровой смысл: "Далее", "Назад", "Закрыть", "Журнал ходов", "Нет записей".
- **Player-facing projection** - подготовленная для игрока модель отображения, которую Presenter или игровой plugin строит из game content и session state.
- **Авторитетное состояние** - состояние, которое runtime хранит и изменяет как источник истины игровой сессии.
- **Вычисляемая метрика** - значение, полученное из авторитетного состояния и declarative formula или projection rule. Оно может показываться как метрика, но не хранится как независимое изменяемое state.

## 4. Принятое решение

Принять правило смыслового владения:

```text
game manifest owns meaning
ui manifest owns presentation
Presenter owns player-facing projection
```

Практически это означает:

1. `game`-манифест хранит игровые сущности и человекочитаемые поля, которые описывают их смысл: названия карточек, результаты карточек, описания этапов, названия и описания игровых метрик, методические пояснения.
2. `ui`-манифест хранит channel-specific отображение: экранные варианты, панели, расположение блоков, CSS-классы, channel-specific assets, иконки, фоновые изображения, текст кнопок и локальные подписи элементов управления.
3. Presenter или игровой plugin строит player-facing projection: `currentBoard`, `visibleCards`, `journalEntries`, `metricViews`, `remainingDays` and similar renderer-ready values.
4. UI-компоненты не должны выводить игровой смысл из сырых ключей state вроде `pro`, `rep`, `lid`.
5. UI-манифест может ссылаться на `metricId`, `cardId`, `collection`, `panelId` and projection paths, но не должен быть единственным местом, где хранится смысл игрового объекта.
6. Game manifest не должен хранить UI-only commands or panel-open actions; это уже закреплено ADR-053 и распространяется на новые локальные UI interactions.
7. На пути записи UI manifest публикует точную привязку элемента или жеста к
   `actionId` и параметрам. Presenter исполняет эту привязку, но не выводит
   `actionId` из карточки, фазы или иного предметного состояния.
8. Presenter сохраняет стабильный `commandId` до получения квитанции. Игровые
   правила, server-side authorization и сборка Mechanics IR не принадлежат
   Presenter или UI plugin.

## 5. Граница ответственности

| Данные или поведение | Владелец | Причина |
| --- | --- | --- |
| Карточка, этап, персонаж, ресурс, игровая метрика | `game`-манифест | Это предметная модель игры. |
| `title`, `summary`, `body`, результат карточки | `game`-манифест | Это смысл выбора и последствия действия. |
| Название метрики "Знания", "Доверие", "Энергия" | `game`-манифест | Это игровые понятия, общие для всех каналов. |
| Описание того, как метрика влияет на игру | `game`-манифест or methodology asset | Это методическая и игровая семантика. |
| Topbar, sidebar, overlay, grid, panel layout | `ui`-манифест | Это channel-specific presentation. |
| Иконка метрики для Web topbar/sidebar | `ui`-манифест or UI asset registry | Это визуальное оформление канала. |
| Текст кнопки "Далее", "Назад", "Закрыть" | `ui`-манифест | Это интерфейсная подпись. |
| `journalEntries`, `metricViews`, `visibleCards` | Presenter/player-facing projection | Это готовая модель для View. |
| Открытая локальная панель | Presenter/View state | Это transient UI state, а не gameplay state. |

Если поле одновременно выглядит и игровым, и UI-полем, применяется тест:

```text
Если значение должно быть одинаково понятно в Web, Telegram, Mobile and facilitator reports,
оно принадлежит game manifest или player-facing projection из game manifest.
Если значение можно заменить при смене канала без изменения игры,
оно принадлежит UI manifest.
```

## 6. Метрики и вычисляемые значения

Игровые метрики должны иметь канонический словарь в game manifest. Целевой shape может отличаться по деталям схемы, но смысловая модель такая:

```json
{
  "content": {
    "data": {
      "metrics": [
        {
          "metricId": "time",
          "label": "Прошло дней",
          "description": "Количество игровых дней, потраченных командой.",
          "kind": "state",
          "statePath": "public.metrics.time"
        },
        {
          "metricId": "remainingDays",
          "label": "Осталось дней",
          "description": "Сколько дней осталось до предельного срока.",
          "kind": "computed",
          "computed": {
            "expression": {
              "-": [
                { "var": "content.rules.dayLimit" },
                { "var": "public.metrics.time" }
              ]
            }
          }
        }
      ]
    }
  }
}
```

Для `Antarctica` принять следующие правила:

- `state.public.metrics.time` хранит прошедшие дни;
- `remainingDays` вычисляется из `time` and declared game limit;
- если нужен настоящий счет игры, он должен получить отдельный смысл и не называться остатком дней;
- `score` не должен использоваться как новое имя для `remainingDays`;
- UI должен рендерить `remainingDays` через player-facing projection, например `metricViews.remainingDays`, а не через скрытую формулу в React-компоненте.

Вычисляемая метрика может отображаться рядом с обычными метриками. Отличие только в источнике значения: обычная метрика читается из authoritative session state, вычисляемая метрика выводится из него.

## 7. Тексты карточек и UI-подписи

Карточки являются предметными игровыми сущностями. Поэтому:

- текст выбора карточки хранится в game manifest;
- результат выбора карточки хранится в game manifest or generated content projection;
- состояние карточки хранится в session object state по ADR-041;
- UI-манифест выбирает, показывать ли карточку как сетку, запись журнала, список, Telegram-кнопку or another channel view.

UI-манифест может хранить подписи структуры журнала, например "Выбор", "Результат", "Пока нет записей", потому что это способ представить уже существующие игровые события.

UI-манифест не должен хранить уникальный текст самой игровой карточки, если этот текст нужен правилам, журналу, отчету, фасилитатору or another channel.

## 8. Schema and runtime constraints

JSON Schema остается single source of truth for manifest structures по ADR-025.

Следствия:

1. Новый словарь метрик должен быть описан в JSON Schema, not TypeScript-only guards.
2. Authoring compiler may add authoring-friendly sugar, but generated runtime manifest must validate against runtime schema.
3. Runtime and player must not infer game semantics from UI captions.
4. Presenter projection contracts should be typed and validated where they cross package or service boundaries.
5. Game-specific projection can live in a game plugin, but platform renderer should consume projection data declaratively and avoid hardcoded game IDs.
6. Runtime state should not store both `time` and `remainingDays` as independently mutable values.

Schema reuse should follow the existing project rule: reusable fragments belong in schema definitions, and instance data should remain clear and validated by Ajv or equivalent standard validator.

## 9. Архитектурные инварианты

- Game manifest owns game meaning.
- UI manifest owns channel presentation.
- Presenter owns renderer-ready projection.
- UI manifest owns declarative `actionId + parameter bindings`; Presenter не
  является скрытым каталогом команд.
- `commandId` принадлежит протоколу доставки логической команды, а не правилам
  игры или локальному UI state.
- UI-only labels are allowed in UI manifest.
- Gameplay labels are not UI-only labels.
- Metric labels and descriptions are gameplay metadata.
- Computed metrics are not independent authoritative state.
- `time` means elapsed game days in `Antarctica`.
- `remainingDays` means computed days left in `Antarctica`.
- `score` must not remain an implicit alias for remaining days.
- Platform code must not introduce game-specific branches to fix this boundary.
- JSON Schema remains the source of truth for new manifest structures.

## 10. Отклоненные альтернативы

### Хранить все подписи метрик в UI manifest

Отклонено. Это заставляет каждый канал заново определять игровые понятия and risks drift between Web, Telegram, reports and facilitator views.

### Хранить все UI-тексты в game manifest

Отклонено. Тексты кнопок, пустые состояния панелей and layout labels are presentation details. Их перенос в game manifest привел бы к обратной проблеме: game manifest начал бы владеть каналом отображения.

### Хранить `remainingDays` в session state рядом с `time`

Отклонено. Это создает два изменяемых источника истины для одного значения. Runtime может вычислить остаток дней из elapsed days and declared limit.

### Продолжать использовать `score` как остаток дней

Отклонено. `score` имеет другое привычное значение: счет или баллы. Для "осталось дней" нужен явный `remainingDays`, чтобы не смешивать score and time semantics.

### Дать UI вычислять все производные значения самостоятельно

Отклонено. Простые visual transforms допустимы, но игровые производные значения должны быть частью Presenter/player-facing projection, иначе разные клиенты начнут вычислять их по-разному.

## 11. Последствия

- Будущая миграция `Antarctica` должна перенести словарь игровых метрик из UI authoring manifest в game authoring/runtime manifests.
- `time` becomes elapsed days; `remainingDays` becomes computed projection value.
- Topbar/sidebar UI should reference metric identifiers or `metricViews`, not own gameplay captions.
- Existing card text placement in game manifest remains the correct direction.
- UI manifests keep layout, panels, buttons, icons and channel-specific assets.
- Player-facing projection becomes the explicit place for joining game content, session state and computed display values.
- Schema and compiler changes are required before enforcing this rule in CI.
