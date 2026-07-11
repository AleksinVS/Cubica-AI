# Strategic Planning

Документ задает стратегический слой планирования Cubica. Он не заменяет `NEXT_STEPS.md` и активные `TSK-*` задачи: здесь фиксируются долгосрочные направления, правила выбора работы и критерии, по которым команда понимает, что проект движется в правильную сторону.

## Оглавление

- [1. Назначение](#1-назначение)
- [2. Горизонты планирования](#2-горизонты-планирования)
- [3. North Star](#3-north-star)
- [4. Стратегические темы](#4-стратегические-темы)
- [5. Правила приоритизации](#5-правила-приоритизации)
- [6. Связь с другими документами](#6-связь-с-другими-документами)
- [7. Ритм обновления](#7-ритм-обновления)

## 1. Назначение

Стратегическое планирование отвечает на три вопроса:

- куда движется проект в горизонте нескольких месяцев;
- какие направления важнее других;
- какие решения нельзя принимать локально, потому что они меняют траекторию платформы.

Термины:

- **Стратегическая тема** — долгосрочное направление работ, например runtime hardening или универсализация манифестов.
- **Текущая доска** — короткий список ближайших работ в `NEXT_STEPS.md`.
- **Рабочая задача** — исполняемый план в `docs/tasks/active/TSK-*`.

## 2. Горизонты планирования

Проект использует три горизонта:

1. **Strategy** — этот документ. Горизонт: месяцы. Описывает направления и правила выбора.
2. **Board** — `NEXT_STEPS.md`. Горизонт: ближайшие дни или недели. Описывает `Now / Next / Later / Blocked`.
3. **Task** — `docs/tasks/active/TSK-*`. Горизонт: один проверяемый кусок работы. Описывает план, приемку, проверки, артефакты и передачу.

Если информация описывает конкретные команды, файлы и критерии приемки, она должна быть в `TSK-*`, а не в стратегии.

## 3. North Star

Cubica должна стать платформой, где:

- игру можно описать как данные в `games/<id>/game.manifest.json`;
- runtime стабильно исполняет игру через `services/runtime-api`;
- игра может выбрать deterministic, hybrid или AI-driven runtime mode без game-specific hacks в платформенном ядре;
- игрок получает интерфейс через `apps/player-web` и будущие каналы доставки;
- новые игры добавляются без game-specific hacks в платформенном ядре;
- архитектурные разрывы фиксируются явно и закрываются раньше, чем поверх них строится новая функциональность.

## 4. Стратегические темы

### 4.1. Canonical Slice First

Канонический срез `games/antarctica` + `runtime-api` + `player-web` + `packages/contracts` должен оставаться зеленым. Новая работа не должна расширять архитектуру, если базовые проверки текущего среза красные.

### 4.2. Manifest as Source of Truth

Исполнимая логика игры должна жить в JSON manifest и валидироваться декларативно через JSON Schema. Ручные проверки допустимы только как отдельный compiler/semantic validation layer, а не как замена схеме.

### 4.3. Platform Purity

Платформенные слои не должны содержать hardcoded game IDs или условия для конкретной игры. Игра-специфичная логика должна жить в game package, manifest, plugin layer или bounded gameplay slice records.

### 4.4. Runtime Hardening

`runtime-api` должен постепенно перейти от scaffold-ready состояния к production-ready состоянию: честный readiness, понятная persistence-модель, проверяемые contracts, контролируемый repository boundary.

### 4.5. Planning Hygiene

Планирование должно быть коротким и исполняемым. `NEXT_STEPS.md` показывает очередь, `TSK-*` хранит план и передачу, `docs/tasks/artifacts/` хранит постоянные результаты. Старые planning layers остаются архивом.

### 4.6. Portal Test Launch

Это готовое стратегическое направление, но не безусловный следующий шаг. Оно активируется, если выбранный игровой срез требует публичного запуска, покупки или удаленного доступа, либо если PM отдельно задал такой приоритет. `Antarctica` остается готовым кандидатом для этого сценария.

Цель темы:

- развернуть портал на тестовом VPS;
- создать ссылки запуска для купленной `Antarctica`;
- проверить создание и продолжение игровых сессий;
- контролировать сроки действия, количество запусков, архивирование и административный просмотр сессий.

Портал в этой теме рассматривается как launch surface: он управляет покупками, ссылками и доступом к игровым сессиям. Игровая логика остается в `games/antarctica`, `services/runtime-api`, `apps/player-web` и `packages/contracts/*`.

### 4.7. Agent UI Foundation

CopilotKit/AG-UI is the MVP-stage Agent UI foundation for Cubica assistants, while the target direction is a custom compatible Cubica Agent UI owned by the platform.

Цель темы:

- дать редактору полноценный AI assistant UI without replacing `editor-engine`;
- обеспечить единый protocol and UI pattern for future portal, facilitator, player and admin assistants;
- сохранить Cubica contracts, JSON Schema validation and runtime/session ownership as the only durable state boundaries;
- require human-in-the-loop approval for risky or mutating assistant tools;
- develop Cubica Surface Protocol as the internal declarative Generative UI contract inspired by A2UI but owned by Cubica.

This theme is strategic because one-off assistant integrations would quickly create duplicate state, duplicate tool policies and inconsistent safety behavior across apps.

### 4.8. AI-Driven Game Runtime

Cubica must support AI-driven games as a first-class runtime mode, not only AI helpers around deterministic games.

Цель темы:

- allow game manifests to declare `deterministic`, `hybrid` or `ai-driven` execution mode;
- let Agent Runtime drive game flow and primary `CubicaSurface` UI for declared AI-driven games;
- keep deterministic games playable without Agent Runtime;
- validate all agent effects before state persistence;
- require readiness, failure policy, replay and evaluation gates for production AI-driven games.

This theme is strategic because it determines whether Cubica can host games where the agent is the game engine instead of only an assistant.

### 4.9. Развитие через конкретные игры

До отдельного решения о смене режима платформа развивается от потребностей конкретной игры, а не через предварительную реализацию всех запланированных возможностей.

PM предоставляет продуктовые вводные. Агент выбирает один ограниченный **вертикальный срез** — полностью работающий сценарий от правил и состояния до интерфейса и проверок. Затем агент готовит и реализует единый план.

План одновременно:

- использует уже готовые возможности платформы;
- разделяет общие механики и содержимое конкретной игры;
- выявляет архитектурные пробелы, необходимые именно выбранному срезу;
- включает только минимальные общие доработки, позволяющие реализовать срез без игровых исключений в общем ядре;
- доказывает общность новых возможностей сценарием игры и нейтральным контрактным тестом;
- обновляет ADR и общую архитектуру для принятых архитектурных решений, Gameplay Slice Record для деталей игры, TSK для исполнения и журнал долга для временных ограничений.

PM согласует существенные архитектурные решения. Выбор библиотек, внутреннее устройство кода, техническая декомпозиция и распределение работы между субагентами остаются ответственностью агента.

Этот режим является обычным способом развития проекта и сам по себе не включает `$cubica`. `$cubica` применяется только по прямому указанию пользователя.

## 5. Правила приоритизации

Работа получает более высокий приоритет, если она:

- завершает наблюдаемый сценарий выбранной игры или закрывает архитектурный пробел, без которого этот сценарий нельзя реализовать чисто;
- восстанавливает зеленые проверки canonical slice;
- продвигает test VPS launch через портал без нарушения runtime/player boundaries;
- устраняет unplanned architecture drift;
- защищает manifest SSOT и JSON Schema validation;
- уменьшает зависимость от legacy/draft артефактов;
- улучшает передачу контекста между агентами и разработчиками;
- развивает общий Agent UI foundation без нарушения canonical state boundaries;
- развивает AI-driven runtime mode through manifest/contracts instead of game-specific runtime branches;
- нужна для безопасного добавления следующей игры или канала доставки.

Работа получает более низкий приоритет, если она:

- расширяет target architecture без текущего потребителя;
- добавляет новый слой абстракции без повторного use case;
- улучшает архивные или draft-области без влияния на canonical slice;
- создает документацию, не связанную с кодом, проверками или активной задачей.

## 6. Связь с другими документами

- `NEXT_STEPS.md` — текущая доска проекта. Должна ссылаться на активные `TSK-*`.
- `docs/tasks/active/` — исполняемые планы и журналы передачи.
- `docs/tasks/artifacts/` — постоянные артефакты задач.
- `docs/tasks/archive/` — история старой системы планирования.
- `docs/architecture/adrs/` — архитектурные решения.
- `docs/architecture/gameplay-slices/` — delivery-specific gameplay details.
- `docs/reviews/2026-07-10-autonomous-development-readiness-review.md` — исходное ревью и обоснование текущего режима; нормативное правило хранится в этом стратегическом документе.
- `PROJECT_STRUCTURE.yaml` — машинно-читаемая карта структуры.

## 7. Ритм обновления

Стратегию нужно обновлять только когда меняется направление проекта, набор стратегических тем или правила приоритизации.

Обычные изменения задач не требуют правки стратегии. Для них достаточно обновить `NEXT_STEPS.md` и соответствующий `TSK-*`.

Минимальная проверка после изменения стратегии:

```text
rg -n "STRATEGY|NEXT_STEPS|docs/tasks/active" README.md docs/tasks/README.md NEXT_STEPS.md
node scripts/dev/generate-structure.js
```
