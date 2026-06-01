# Анализ: Иерархическая архитектура Model-View-Presenter для Cubica

## Содержание

- [1. Резюме](#1-резюме)
- [2. Текущее состояние: проблемы миграции UI](#2-текущее-состояние-проблемы-миграции-ui)
- [3. Критическая оценка предложения](#3-критическая-оценка-предложения)
- [4. Best practices и альтернативные подходы](#4-best-practices-и-альтернативные-подходы)
- [5. Предлагаемая архитектура](#5-предлагаемая-архитектура)
- [6. Сравнение вариантов](#6-сравнение-вариантов)
- [7. План миграции](#7-план-миграции)
- [8. Источники](#8-источники)

---

## 1. Резюме

Документ содержит критический анализ предложения по иерархической архитектуре Model-View-Presenter, сравнение с best practices индустрии, и рекомендации по реализации для платформы Cubica. Главная цель — сделать построение UI игр на основе других игр (со схожей механикой, но другим UI и логикой) максимально простым и предсказуемым.

---

## 2. Текущее состояние: проблемы миграции UI

### 2.1. Выявленные проблемы

На основе анализа кодовой базы `apps/player-web` и `games/antarctica`:

| # | Проблема | Где проявляется | Влияние на миграцию |
|---|----------|-----------------|---------------------|
| 1 | **FallbackRenderer жёстко привязан к Антарктике** | `fallback-renderer.tsx` — на момент анализа импортировал типы из бывшего платформенного плагина и напрямую читал game-specific state | Новая игра не может использовать FallbackRenderer без переписывания |
| 2 | **Два независимых рендеринг-пути** | `GamePlayer` выбирает: ManifestRenderer → FallbackRenderer → "booting" | Дублирование логики, расхождения между путями |
| 3 | **GameState утекает в платформу** | `AntarcticaGameState` в `game-config.ts` (платформный файл) | Новая игра вынуждена модифицировать платформный код |
| 4 | **Манифестный экшен-адаптер минимальный** | `manifest-action-adapter.ts` — всего 4 команды (`requestServer`, `showHistory`, `showHint`, `showScreenWithLeftSideBar`) | Большинство игровых действий не может пройти через манифестный путь |
| 5 | **Ограниченный data binding** | Только `{{game.state.public.metrics.*}}` в `gameVariableComponent.value` | Текст карточек, заголовки, состояния — всё статичное или через FallbackRenderer |
| 6 | **Hard-coded маппинг step → screen** | `resolveBoardScreenKey` в Antarctica plugin | Нельзя описать в манифесте, требует код |
| 7 | **Layout разрешение через эвристики** | `resolveLayoutMode` угадывает topbar/leftsidebar | Хрупкая логика, которую трудно воспроизвести для новой игры |
| 8 | **Design-мокапы не связаны с рендерингом** | `*.design.json` имеют семантическую разметку, но ManifestRenderer их не потребляет | Дизайн и код живут в параллельных мирах |
| 9 | **SDK — мёртвый слой** | `SDK/shared` определяет `GameCard`, `GameVariable`, `GameScreen`, но player-web использует свои локальные компоненты | Нет переиспользования |
| 10 | **Типы контента привязаны к gameId** | `game-content-resolvers.ts` импортирует Antarctica-типы | Новая игра требует модификации платформного файла |

### 2.2. Корневая причина

Все проблемы сводятся к одному: **отсутствует формальный контракт между «что показывает экран» (Model) и «как это выглядит» (View)**. Вместо этого:
- Model (манифест) описывает плоские списки `infos`, `boards`, `cards`
- View (React) содержит игровую логику рендеринга прямо в компонентах
- Presenter (game-config) выполняет роль «костыля», маппя специфичные для Антарктики данные

---

## 3. Критическая оценка предложения

### 3.1. Сильные стороны предложения

| Аспект | Оценка |
|--------|--------|
| **Разделение Model и View** | Отлично. Концептуально верно: Model описывает «что», View — «как». Это основа для повторного использования. |
| **Иерархическая Model (Screen → Area → Element)** | Верно по направлению. Экран уже существует в манифесте (`timeline.screenId`), Area — естественное группирование (метрики, карточки, кнопки). |
| **Иерархическая View (Scene → Layer → Group → Component)** | Хорошая декомпозиция. Layer — важная абстракция (background, content, overlay), Group — логическая группировка. |
| **Presenter как декларативный мост** | Верное направление. Явный маппинг Model↔View лучше неявного, разбросанного по коду. |
| **Path-адресация** | `Model.get("sidebar/metrics/time")` — лучше плоских ID. Позволяет навигацию по иерархии. |

### 3.2. Слабые стороны и риски

| # | Приск | Описание | Серьёзность |
|---|-------|----------|-------------|
| 1 | **Model дублирует манифест** | Предложение описывает Model как «Screen → Area → Element», но в `game.manifest.json` уже есть `infos`, `boards`, `cards`, `metrics`. Создание параллельной иерархии Model приведёт к двум источникам истины. | Высокая |
| 2 | **Ручной маппинг не масштабируется** | `"model": "stats.time", "view": "sidebar.timer_text"` — для экрана с 30+ элементами маппинг становится нечитаемым и хрупким. | Средняя |
| 3 | **Area и Group — не однозначное соответствие** | Предложение говорит «Area группируется по смыслу, Group — по вёрстке», но на практике смысл и вёрстка часто пересекаются. Жёсткое разделение может быть искусственным. | Средняя |
| 4 | **Отсутствие состояний (States) в Model** | Предложение описывает типы элементов (Variable, Action, Content), но не описывает состояния (visible/hidden, enabled/disabled, selected, locked). Для игр это критично. | Высокая |
| 5 | **Mockup→Model маппинг не формализован** | Сказано «изначально мэтчатся мокапы и Model», но нет механизма. Текущие `design.json` уже имеют `regions`, но они не связаны с Model. | Средняя |
| 6 | **Нет стратегии для не-визуальных элементов** | Audio/Video упомянуты, но как они вписываются в иерархию View (которая описывает визуальные примитивы)? | Низкая |
| 7 | **Over-engineering для простых игр** | Само предложение признаёт это. Нужен баланс: иерархия должна быть опционально плоской. | Средняя |

### 3.3. Ключевое наблюдение

Предложение описывает **структуру данных** (иерархию), но не описывает **поведение** (как элементы реагируют на изменения состояния). В индустрии это решается через:

- **Reactive bindings** (Elm/MVU — View = pure function of Model)
- **Component Registry + Data Binding** (SDUI — сервер описывает дерево, клиент рендерит)
- **Passive View + Presenter events** (MVP — Presenter подписан на Model и обновляет View)

Для Cubica нужен гибрид: **декларативное описание** (что на экране) + **реактивное связывание** (как меняется при изменении состояния).

---

## 4. Best practices и альтернативные подходы

### 4.1. SDUI Component Registry Pattern

**Источник:** [Pyramid SDUI Architecture Patterns](https://pyramidui.com/blog/sdui-architecture-patterns), [Weskill SDUI at Scale](https://blog.weskill.org/2026/04/server-driven-ui-sdui-at-scale-json.html)

Ключевая идея: сервер отправляет дерево компонентов, клиент имеет **Component Registry** — реестр, маппящий тип строки → React-компонент.

```typescript
// Component Registry
const registry = new Map<string, React.ComponentType>();
registry.register("gameVariable", GameVariableComponent);
registry.register("card", CardComponent);
registry.register("button", ButtonComponent);

// Recursive renderer
function SDUIRenderer({ node }: { node: SDUINode }) {
  const Component = registry.get(node.type) ?? FallbackComponent;
  return (
    <Component {...node.props}>
      {node.children?.map(child => <SDUIRenderer key={child.id} node={child} />)}
    </Component>
  );
}
```

**Применимость к Cubica:** Высокая. Текущий `UiComponentNode` — это уже зачаток registry (switch по `component.type`). Нужно формализовать и расширить.

**Критика:** Чистый SDUI описывает только структуру View. Не решает проблему Model↔View маппинга. Нужен дополнительный слой связывания.

### 4.2. Elm Architecture / MVU (Model-View-Update)

**Источник:** [Elm Architecture Guide](https://guide.elm-lang.org/architecture/index.html), [Purple Kingdom Games — Deriving the Elm Architecture](https://purplekingdomgames.com/blog/2024/03/05/deriving-the-elm-architecture)

Ключевая идея: View — чистая функция от Model. Нет отдельного маппинга, потому что Model однозначно определяет View.

```
Model → View(Model) → User Action → Update(Model, Action) → New Model → View(New Model)
```

**Применимость к Cubica:** Частичная. Подход идеален для детерминированных UI, но игры часто имеют недетерминированные состояния (AI-ответы, асинхронные события). Кроме того, чистая функция View от Model означает, что Model должен содержать ВСЁ, что влияет на отображение — включая layout-решения, что нарушает разделение ответственности.

**Критика:** В Cubica View должен зависеть от Model, но не быть чистой функцией. Layout (sidebar vs topbar) — это View-решение, не Model-состояние. Также MVU плохо сочетается с сервер-Driven подходом (UI манифест приходит с сервера).

### 4.3. MVP Passive View (текущий подход Cubica)

**Источник:** [Leah Hayes — Separation of Concerns with Unity UI](http://leahayes.co.uk/2016/09/25/separation-of-concerns-with-unity-ui.html), [Unity Learn — MVC/MVP Patterns](https://learn.unity.com/course/design-patterns-unity-6/tutorial/build-a-modular-codebase-with-mvc-and-mvp-programming-patterns?version=6.0)

Ключевая идея: View — пассивен (только отображает). Presenter подписан на Model, извлекает данные, форматирует и передаёт View через интерфейс.

**Применимость к Cubica:** Это уже архитектурный выбор проекта (ADR-001, ADR-002). Проблема не в самом паттерне, а в его **неполной реализации** — FallbackRenderer нарушает пассивность View.

**Рекомендация:** Усилить MVP, а не заменять на MVU. Проблема — в утечке Model в View, а не в самом MVP.

### 4.4. Game UI Hierarchical Manager (Unity pattern)

**Источник:** [Game Developer — UI System Architecture for Unity](https://gamedeveloper.com/programming/a-ui-system-architecture-and-workflow-for-unity)

Ключевая идея: Иерархия **Screen → Panel → Widget** с UI Manager фасадом.

- **Screen**: полный экран (Dialog = модальный, Panel = постоянный)
- **Widget**: переиспользуемый подкомпонент экрана
- **Layer**: контейнер для z-упорядочивания
- **UI Manager**: фасад — единая точка входа для всех UI-команд

**Применимость к Cubica:** Высокая. Это близко к предложению пользователя, но с важным дополнением: **UI Manager (фасад)**. В Cubica роль фасада уже частично выполняет `GamePresenter`, но не формализован.

### 4.5. Convention over Configuration (CoC)

**Источник:** Общепринятая практика в Rails, Django, Spring

Ключевая идея: Вместо явного маппинга каждого Model Element → View Component, использовать **соглашения об именовании**, которые разрешаются автоматически.

```
Model:  screen/S1/area/metrics/variable/score
View:   screen/S1/layer/background/group/metrics/component/score-value
```

При совпадении `variable/score` ↔ `component/score-value` по конвенции — маппинг создается автоматически. Явный маппинг нужен только для исключений.

**Применимость к Cubica:** Высокая. Снижает объём маппинга в 5-10 раз для типичных случаев.

---

## 5. Предлагаемая архитектура

На основе анализа предлагается **усиленный иерархический MVP** — эволюция текущей архитектуры, а не революция.

### 5.1. Принципы

1. **Model — единственный источник истины для «что»** (содержимое экрана, данные, состояния)
2. **View — единственный источник истины для «как»** (раскладка, визуальный стиль, анимации)
3. **Presenter — мост с Convention-over-Configuration** (явный маппинг только для исключений)
4. **Manifest — SSOT** (JSON Schema валидируется, не TypeScript type guards)
5. **Platform purity** (никаких game-specific if/else в платформенном коде)

### 5.2. Hierarchical Model Element Schema

Model расширяет текущий `game.manifest.json`, добавляя иерархическую структуру **поверх** существующих данных. Не дублирует, а **структурирует**.

```jsonc
// В game.manifest.json, секция content.antarctica.model
{
  "model": {
    "screens": {
      "S1": {
        "type": "game-screen",
        "areas": {
          "metrics": {
            "type": "metric-area",
            "elements": [
              { "id": "score", "kind": "variable", "bind": "{{game.state.public.metrics.score}}", "caption": "Остаток дней" },
              { "id": "pro",   "kind": "variable", "bind": "{{game.state.public.metrics.pro}}",   "caption": "Знания" },
              { "id": "rep",   "kind": "variable", "bind": "{{game.state.public.metrics.rep}}",   "caption": "Доверие" },
              { "id": "lid",   "kind": "variable", "bind": "{{game.state.public.metrics.lid}}",   "caption": "Энергия" }
            ]
          },
          "board": {
            "type": "card-area",
            "dataSource": "currentBoard.cards",
            "cardTemplate": { "kind": "card", "bindTitle": "{{card.title}}", "bindSummary": "{{card.summary}}" },
            "states": ["locked", "selected", "resolved"]
          },
          "actions": {
            "type": "action-area",
            "elements": [
              { "id": "advance", "kind": "action", "actionRef": "currentBoard.advanceActionId", "label": "Продолжить", "visibleWhen": "canAdvance" },
              { "id": "journal",  "kind": "action", "command": "showHistory", "label": "Журнал ходов" },
              { "id": "hint",     "kind": "action", "command": "showHint", "label": "Подсказка" }
            ]
          }
        },
        "layout": "left-sidebar"
      },
      "S2": {
        "type": "game-screen",
        "areas": { /* аналогично, с layout: "topbar" */ }
      }
    }
  }
}
```

**Ключевые отличия от текущего состояния:**
- `screens` — не плоский список `infos`/`boards`, а иерархия с `areas` и `elements`
- `bind` — data binding выражения (расширение текущего `{{...}}`)
- `dataSource` — ссылка на коллекцию в состоянии (вместо hard-coded резолверов)
- `states` — объявление возможных состояний элементов
- `visibleWhen` — условная видимость (вместо hard-coded логики в FallbackRenderer)
- `layout` — подсказка для View (но View может игнорировать)

### 5.3. Hierarchical View Component Schema

View описывает **дерево визуальных компонентов** с поддержкой слоёв и групп. Расширяет текущий `ui.manifest.json`.

```jsonc
// В ui/web/ui.manifest.json
{
  "viewLibrary": {
    "components": {
      "metric-tile": {
        "type": "component",
        "slots": ["icon", "caption", "value"],
        "variants": ["sidebar", "topbar"],
        "states": ["default", "highlighted", "warning"]
      },
      "action-card": {
        "type": "component",
        "slots": ["title", "summary", "badge"],
        "states": ["default", "selected", "locked", "resolved"]
      },
      "info-panel": {
        "type": "component",
        "slots": ["title", "body", "illustration"],
        "states": ["default", "expanded", "collapsed"]
      }
    },
    "layouts": {
      "left-sidebar": {
        "type": "layout",
        "regions": ["sidebar", "main", "controls"]
      },
      "topbar": {
        "type": "layout",
        "regions": ["topbar", "main", "controls"]
      }
    }
  },
  "screens": {
    "S1": {
      "type": "screen",
      "layout": "left-sidebar",
      "layers": [
        {
          "id": "background",
          "z": 0,
          "components": [
            { "ref": "image", "props": { "src": "/images/arctic-background.png", "fit": "cover" } }
          ]
        },
        {
          "id": "content",
          "z": 1,
          "regions": {
            "sidebar": {
              "group": "metrics-group",
              "bind": "model.areas.metrics",
              "component": "metric-tile",
              "itemTemplate": { "bindIcon": "{{element.backgroundImage}}", "bindValue": "{{element.bind}}" }
            },
            "main": {
              "group": "board-group",
              "bind": "model.areas.board",
              "component": "action-card",
              "itemTemplate": { "bindTitle": "{{element.bindTitle}}", "bindSummary": "{{element.bindSummary}}" }
            },
            "controls": {
              "group": "action-buttons",
              "bind": "model.areas.actions",
              "component": "action-button"
            }
          }
        }
      ]
    }
  }
}
```

**Ключевые отличия от текущего состояния:**
- `viewLibrary` — реестр переиспользуемых компонентов с `slots`, `variants`, `states`
- `layers` — явная z-упорядоченность (background, content, overlay)
- `regions` — именованные слоты лейаута (sidebar, main, controls)
- `bind` — связывание View-компонента с Model-областью через path-адресацию
- `itemTemplate` — шаблон для повторяющихся элементов (карточки, метрики) вместо перечисления каждой карточки

### 5.4. Presenter: Convention-over-Configuration Mapping

Presenter связывает Model и View, используя **соглашения по умолчанию** с возможностью явного переопределения.

#### Правила конвенции (Convention):

| Model Element Kind | View Component (по умолчанию) | Разрешение |
|--------------------|------------------------------|------------|
| `variable` | `metric-tile` | `model.areas.metrics` → `screen.regions.sidebar` |
| `card` (in card-area) | `action-card` | `model.areas.board` → `screen.regions.main` |
| `action` (in action-area) | `action-button` | `model.areas.actions` → `screen.regions.controls` |
| `content` (in info-area) | `info-panel` | `model.areas.info` → `screen.regions.main` |

#### Явный маппинг (Configuration):

Явный маппинг нужен только когда конвенция не работает — например, для нестандартных лейаутов или когда одна и та же модель рендерится по-разному на разных каналах.

```jsonc
// В ui.manifest.json, опционально
{
  "bindings": {
    // Явные переопределения конвенции
    "model.areas.metrics": { "region": "topbar" },
    "model.areas.board": { "component": "dialog-card", "layout": "grid-3col" }
  }
}
```

#### Разрешение Data Binding:

Data binding (выражения `{{...}}`) разрешается через **контекстный стек**, а не через глобальные пути:

```
Контекст элемента: { game: gameState, card: currentCard, element: modelElement }
Выражение: {{card.title}}
Разрешение: контекст.card.title → "Выбор стратегии"
```

Это позволяет шаблонам `itemTemplate` работать корректно — `card` в контексте карточки ссылается на текущий элемент коллекции, а не на глобальное состояние.

### 5.5. Связь с design-мокапами

Текущие `.design.json` содержат `regions` с семантической разметкой. Предлагается формализовать связь:

```jsonc
// В design.json (существующий формат, расширенный)
{
  "regions": {
    "metrics-area": {
      "type": "region",
      "bounds": { "x": 0, "y": 0, "width": 280, "height": 900 },
      "semanticRole": "metric-area",
      // Новое: привязка к Model
      "modelRef": "model.areas.metrics"
    },
    "board-area": {
      "type": "region",
      "bounds": { "x": 300, "y": 60, "width": 620, "height": 840 },
      "semanticRole": "card-area",
      "modelRef": "model.areas.board"
    }
  }
}
```

Таким образом:
- **Mockup → Model**: `semanticRole` в design.json мэтчится с `type` в Model area
- **Mockup → View**: `bounds` в design.json дают геометрию для View layout
- **Model → View**: `bind` в View мэтчится с Model через path-адресацию

---

## 6. Сравнение вариантов

### 6.1. Вариант A: Предложение пользователя (как есть)

```
Model: Root → Screen → Area → Element (Variable, Action, Content, Audio, Video)
View:  Root → Scene/Layout → Layer → Group → Component (Image, Vector, Text, Area)
Presenter: Явный маппинг model path → view path
```

| Критерий | Оценка |
|----------|--------|
| Простота понимания | ★★★★★ |
| Решает проблему миграции | ★★★☆☆ (явный маппинг хрупок) |
| Совместимость с текущим кодом | ★★☆☆☆ (требует переписывания) |
| Масштабируемость | ★★★☆☆ (N×M маппингов) |

### 6.2. Вариант B: SDUI Component Registry (чистый сервер-Driven)

```
Сервер отправляет полное дерево View с данными
Клиент рендерит через Component Registry
Model встроен в View (как данные в пропсах)
```

| Критерий | Оценка |
|----------|--------|
| Простота понимания | ★★★★☆ |
| Решает проблему миграции | ★★★★☆ (новый UI = новый манифест) |
| Совместимость с текущим кодом | ★★☆☆☆ (полная замена) |
| Масштабируемость | ★★★★★ (registry + fallback) |

### 6.3. Вариант C: Усиленный MVP с Convention-over-Configuration (рекомендуемый)

```
Model: Screen → Area → Element (с dataSource, bind, states)
View:  Screen → Layer → Region → Component (с viewLibrary, bind, itemTemplate)
Presenter: Convention (по умолчанию) + Configuration (для исключений)
Data Binding: контекстный стек ({{card.title}} в itemTemplate)
```

| Критерий | Оценка |
|----------|--------|
| Простота понимания | ★★★★☆ |
| Решает проблемы миграции | ★★★★★ |
| Совместимость с текущим кодом | ★★★★☆ (эволюция, не революция) |
| Масштабируемость | ★★★★★ (convention + явный маппинг) |

### 6.4. Вариант D: Elm/MVU (чистая функция View от Model)

```
Model — единый source of truth
View = pure function(Model) → UI tree
Update = pure function(Model, Msg) → (new Model, Cmd)
```

| Критерий | Оценка |
|----------|--------|
| Простота понимания | ★★★☆☆ (необычен для JS/React) |
| Решает проблемы миграции | ★★☆☆☆ (Model должен содержать layout) |
| Совместимость с текущим кодом | ★☆☆☆☆ (полная замена) |
| Масштабируемость | ★★★★☆ (композиция) |

**Рекомендация: Вариант C.** Он сохраняет MVP-архитектуру проекта, эволюционирует текущие манифесты (не ломает), и решает все 10 выявленных проблем.

---

## 7. План миграции

### Фаза 1: Формализация Model Element Schema (2-3 дня)

1. Определить JSON Schema для `ModelScreen`, `ModelArea`, `ModelElement` в `packages/contracts/manifest`
2. Расширить `GameManifestContent` тип для поддержки `model` секции (опциональной, backward-compatible)
3. Написать валидатор (AJV) для новой схемы
4. Создать Model из существующих Antarctica данных (infos, boards, cards, metrics)

### Фаза 2: Расширение View Component Schema (2-3 дня)

1. Расширить `GameUiComponentType` новыми типами: `layerComponent`, `regionComponent`, `groupComponent`
2. Добавить `viewLibrary` секцию в UI манифест (опциональную, backward-compatible)
3. Добавить `bind` и `itemTemplate` в `GameUiComponentProps`
4. Обновить `UiComponentNode` для поддержки новых типов (с fallback для старых)

### Фаза 3: Data Binding Engine (3-4 дня)

1. Реализовать контекстный стек для выражений `{{...}}`
2. Поддержать `dataSource` для коллекций (board.cards, teamSelection.members)
3. Поддержать условную видимость (`visibleWhen`)
4. Поддержать состояния элементов (`locked`, `selected`, `resolved`)

### Фаза 4: Convention-over-Configuration Presenter (2-3 дня)

1. Определить правила конвенции (Model kind → View component)
2. Реализовать `ConventionPresenter`, который автоматически резолвит маппинги
3. Реализовать механизм явных переопределений через `bindings`
4. Переписать `manifest-action-adapter` на основе Model-описания действий

### Фаза 5: Устранение FallbackRenderer (3-4 дня)

1. Перенести все Antarctica-специфичные рендеринги в манифестный путь
2. Team selection, info screens, board screens — все через Model + View + Convention
3. FallbackRenderer → универсальный `SafeModeRenderer` (минимальный, без game-specific логики)
4. Удалить `AntarcticaGameState` из платформенных файлов

### Фаза 6: Валидация на новой игре (3-5 дней)

1. Создать минимальную новую игру (например, «Квиз») с другим UI
2. Проверить, что Model-View-Presenter позволяет описать её без изменения платформенного кода
3. Зафиксировать ADR с финальной архитектурой

---

## 8. Источники

1. [Pyramid Blog — SDUI Architecture Patterns](https://pyramidui.com/blog/sdui-architecture-patterns) — Component Registry, Schema-First Design, Action System, Versioning
2. [Weskill — SDUI at Scale: The JSON-Ready Architecture of 2026](https://blog.weskill.org/2026/04/server-driven-ui-sdui-at-scale-json.html) — Recursive renderer, cross-platform rendering
3. [Pyramid — SDUI Tutorial: Dynamic Screens with Compose](https://pyramidui.com/blog/sdui-tutorial-compose) — Sealed class hierarchy for UI components
4. [Elm Architecture Guide](https://guide.elm-lang.org/architecture/index.html) — Model-View-Update pattern fundamentals
5. [Purple Kingdom Games — Deriving the Elm Architecture](https://purplekingdomgames.com/blog/2024/03/05/deriving-the-elm-architecture) — First principles for GUI architectures, purity vs practicality trade-offs
6. [DEV Community — MVU Architecture in React](https://dev.to/kino6052/legacy-proof-ui-part-5-mvu-architecture-in-a-react-application-4kgi) — IO-Update pattern as MVU simplification
7. [Thomas Bandt — Model-View-Update](https://thomasbandt.com/model-view-update) — Practical MVU with F#/Fabulous
8. [Leah Hayes — Separation of Concerns with Unity UI](http://leahayes.co.uk/2016/09/25/separation-of-concerns-with-unity-ui.html) — MVP Passive View in game engines, MVVM GC issues
9. [Unity Learn — MVC/MVP Programming Patterns](https://learn.unity.com/course/design-patterns-unity-6/tutorial/build-a-modular-codebase-with-mvc-and-mvp-programming-patterns?version=6.0) — MVP in Unity with events
10. [Game Developer — UI System Architecture for Unity](https://gamedeveloper.com/programming/a-ui-system-architecture-and-workflow-for-unity) — Screen/Panel/Widget hierarchy, UI Manager façade
11. [PlayCanvas — UI System](https://developer.playcanvas.com/user-manual/user-interface/) — Screen Component + Element Component hierarchy
12. [Web Engine Dev — UI Framework](https://docs.web-engine.dev/packages/rendering/ui) — Hierarchical widget system with reactive binding
13. [bevy_lunex — Declarative Layout for Bevy ECS](https://docs.rs/bevy_lunex/latest/bevy_lunex) — ECS-native retained UI with state-per-component
14. [Unity.FUI — Declarative Runtime UI](https://github.com/antilatency/Unity.FUI) — IMGUI-like declarative rebuild from state
15. [Comviva — SDUI Concepts and Building Blocks](https://www.comviva.com/blog/server-driven-ui-concepts-and-building-blocks/) — Evolution from traditional to server-driven UI
16. [Web Engine Dev — Scenes](https://docs.web-engine.dev/concepts/scenes) — ECS Component Registry for scene serialization
