---
id: F_00024
title: Рефакторинг game-player-nextjs под SDK и целевую архитектуру
status: in_progress
owner: @todo
epic: E_0020
area: game-player
tags: [priority:P0, type:feature]
links:
  - games/antarctica-nextjs-player/README.md
  - SDK/react-sdk/DEV_GUIDE.md
  - SDK/shared/README.md
  - docs/architecture/PROJECT_ARCHITECTURE.md
  - docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md
  - docs/architecture/adrs/002-abstract-view-protocol.md
---

# FEATURE: Рефакторинг game-player-nextjs под SDK и целевую архитектуру

## Оглавление
- [Контекст-и-цели](#контекст-и-цели)
- [Термины](#термины)
- [Scope](#scope)
- [User-Stories--Задачи](#user-stories--задачи)
- [Acceptance-Criteria](#acceptance-criteria)
- [Definition-of-Done](#definition-of-done)
- [Артефакты-и-зависимости](#артефакты-и-зависимости)

## Контекст-и-цели
- [ ] Привести Next.js-плеер (изначально расположенный в `draft/game-player-nextjs`, теперь — `games/antarctica-nextjs-player/`) в соответствие с целевой архитектурой MVP и LLM-first: разделение ролей Model/View/Presenter, отсутствие бизнес-логики в React-компонентах, использование протокола ViewCommand/ViewResponse.
- [ ] Перенести переиспользуемые UI-компоненты и логику презентера в целевые пакеты `SDK/shared` и `SDK/react-sdk`, чтобы Next.js-плеер стал тонким адаптером над SDK, а не самостоятельным «мини-SDK».
- [ ] Устранить хардкод сетевых параметров, прямые обращения к Game Engine в обход Router и dev-заглушек, привести конфигурацию к требованиям `PROJECT_ARCHITECTURE.md` (Router, Session, Env).
- [ ] Подготовить плеер к дальнейшим фичам эпика (F_00021/00022/00023), чтобы они опирались на стабильный SDK-слой, а не на временный прототип.
 - [ ] Перенести файлы плеера из зоны черновиков (`draft/game-player-nextjs`) в целевой каталог `games/` (например, `games/antarctica-nextjs-player/`), чтобы структура репозитория соответствовала целевой архитектуре (шаблоны и реализации игр живут в `games/*`, а не в `draft/*`).

## Термины
- **Router** — API-шлюз и менеджер игровых сессий, который принимает запросы от клиентов (через SDK), создаёт/поддерживает игровые сессии и делегирует логику Game Engine.
- **Game Engine** — сервис-движок, который на основе манифеста и состояния (часто с использованием LLM — Large Language Model, большая языковая модель) рассчитывает новые состояния и события.
- **ViewCommand/ViewResponse** — абстрактный протокол взаимодействия между View (UI) и Presenter/Router, где View отправляет команды (нажатия, выборы и т.п.), а получает обратно описания состояний/патчей без знания о реализации сервера.
- **SDK/react-sdk** — React-SDK платформы Cubica (набор хуков и компонентов), который инкапсулирует работу с Router, сессиями и протоколом ViewCommand/ViewResponse.

## Scope
- In scope:
  - Выделение переиспользуемых UI-компонентов плеера в `SDK/shared` (например, аналоги `GameButton`, `GameCard`, `GameVariable`), согласование их пропсов с Abstract View.
  - Интеграция Next.js-приложения плеера с `SDK/react-sdk` (хуки наподобие `useCubicaSession`), отказ от прямых вызовов `fetch` к Game Engine и dev API.
  - Введение Presenter-слоя (в SDK/core или react-sdk) для обработки ViewCommand и применения ViewResponse/патчей вместо «толстых» UI-компонентов.
  - Удаление или перевод в зарегистрированные заглушки dev-логики: `src/app/api/route.js`, хардкод IP/токенов в `serverDataLoader.js`, прямые манипуляции DOM.
  - Минимальная миграция на TypeScript там, где это требуется SDK (по результатам ревью SDK), либо явное ограничение области на JS с чёткими типовыми контрактами.
  - Обновление документации плеера и SDK в части использования React-плеера для игр типа «Antarctica».
  - Перенос Next.js-проекта из `draft/game-player-nextjs` в новый каталог `games/antarctica-nextjs-player/` (или аналогичный, согласованный в рамках ExecPlan), обновление всех относительных путей, импортов и ссылок в документации.
- Out of scope:
  - Полная переработка backend Router/Game Engine (используются существующие контракты/заглушки).
  - Расширение протокола ViewCommand/ViewResponse сверх зафиксированного в ADR-002 (если потребуется — отдельный ADR/фича).
  - Непрофильные улучшения UX/дизайна плеера, не влияющие на архитектуру.

## User-Stories--Задачи
- [x] Как разработчик платформы, я могу подключить `SDK/react-sdk` к Next.js-приложению `draft/game-player-nextjs` и получить доступ к сессии игры через хук (например, `useCubicaSession`), не пиша собственный сетевой слой.
  - [x] Подключён пакет `SDK/react-sdk` в `draft/game-player-nextjs`, настроены алиасы/импорты.
  - [x] Состояние игры в плеере читается из SDK (hook/контекст), а не из самописного `serverDataLoader`.
- [x] Как разработчик UI, я могу использовать компоненты из `SDK/shared` (GameButton, GameCard, GameVariable и т.п.) вместо локальных реализаций, чтобы переиспользовать их в других плеерах.
  - [x] Выделены и перенесены компоненты из `draft/game-player-nextjs/src/app/components/gameComponents` в `SDK/shared/src`.
  - [x] В Next.js-плеере заменены импорты на компоненты из `SDK/shared`.
- [x] Как разработчик, я могу описывать действия UI через ViewCommand/ViewResponse, а не напрямую дергать сетевые функции и мутировать состояние в компонентах.
  - [x] Введён Presenter-слой/адаптер в SDK, принимающий команды от View и возвращающий ViewResponse.
  - [x] Компоненты плеера генерируют команды (например, `onClick` → ViewCommand), а логика обработки живёт вне React-компонентов.
- [x] Как DevOps/инженер эксплуатации, я могу настраивать адрес Router/Game Engine и токены только через переменные окружения и конфиги, без правки исходников плеера.
  - [x] Все сетевые параметры вынесены в конфиг/ENV, отсутствует хардкод URL/токенов.
  - [x] Dev-заглушки и локальные API зарегистрированы в `docs/legacy/stubs-register.md` или удалены.
- [x] Как разработчик, я вижу, что актуальная реализация плеера для «Antarctica» живёт в каталоге `games/antarctica-nextjs-player/` (или другом целевом подкаталоге `games/` по результатам ExecPlan), а в `draft/` остаются только архивные/черновые материалы.
  - [x] Структура каталогов приведена в соответствие с `PROJECT_STRUCTURE.md` и правилами для `games/`.
  - [ ] Все ссылки в задачах и архитектурных документах обновлены с `draft/game-player-nextjs` на новый путь в `games/`.

## Acceptance-Criteria
- [ ] Next.js-плеер (после переезда в подкаталог `games/`) больше не содержит прямых вызовов к Game Engine или Router вне SDK/react-sdk: сетевые запросы проходят через SDK и протокол ViewCommand/ViewResponse.
- [ ] Переиспользуемые UI-компоненты плеера (кнопки, карточки, переменные, панели) вынесены в `SDK/shared` и импортируются из SDK, а не из локальных файлов плеера.
- [ ] В плеере реализован MVP-паттерн: React-компоненты не содержат бизнес-логики и сетевых вызовов, состояние и применение патчей инкапсулированы в Presenter/SDK-слое.
- [ ] Конфигурация Router/Game Engine (URL, токены, режимы dev/prod) задаётся через `.env`/конфиг, README содержит актуальные инструкции по настройке.
- [ ] Удалены или формально зарегистрированы все dev-заглушки и обходные решения (локальный API-роут, прямые `<link>` вставки и пр.) в соответствии с `docs/legacy/` и ADR-правилами.
- [ ] Обновлён эпик E_0020: фича F_00024 указана как первый шаг эпика перед F_00021/00022/00023, отражены зависимости.
 - [ ] Структура репозитория отражает, что рабочий плеер для сценария «Antarctica» размещён под `games/`, а не под `draft/`, и это зафиксировано в `PROJECT_STRUCTURE.md` и `PROJECT_OVERVIEW.md`.

## Definition-of-Done
- [ ] Создан и выполнен ExecPlan для рефакторинга (CP_00024_antarctica_nextjs_refactor.yaml) в соответствии с `docs/tasks/content-packs/PLAN.md`.
- [ ] Обновлены `docs/tasks/ROADMAP.md`, эпик E_0020 и связанные фичи (F_00021/00022/00023) с учётом нового порядка работ и зависимостей.
- [x] Обновлены документация плеера (README в новом каталоге `games/` вместо `draft/game-player-nextjs/README.md`) и, при необходимости, документы SDK (`SDK/react-sdk/DEV_GUIDE.md`, `SDK/shared/README.md`) под новую архитектуру.
- [ ] Актуализированы `PROJECT_ARCHITECTURE.md`, `PROJECT_STRUCTURE.md` и `PROJECT_OVERVIEW.md` при изменениях структуры SDK/плеера и его расположения (переезд из `draft/` в `games/`).
- [ ] Добавлены базовые автотесты (smoke-тесты рендера и тесты Presenter/SDK-слоя) для предотвращения регрессий.
- [ ] CI и локальные проверки (если настроены для SDK и плеера) проходят успешно.

## Артефакты-и-зависимости
- `draft/game-player-nextjs/src/app/page.js`, `src/app/components/GameScreenRenderer.js`, `src/app/utils/*.js` — исходный прототип плеера до рефакторинга и переезда.
- `games/antarctica-nextjs-player/**` — целевой каталог Next.js-плеера для сценария «Antarctica» после рефакторинга и переноса из `draft/`.
- `SDK/core/src/**`, `SDK/react-sdk/src/**`, `SDK/shared/src/**` — целевые слои SDK для контрактов, Presenter-логики и UI-компонентов.
- `docs/architecture/PROJECT_ARCHITECTURE.md`, `docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md`, `docs/architecture/adrs/002-abstract-view-protocol.md` — источники архитектурных требований.
- Связанные фичи эпика: F_00021, F_00022, F_00023 (реализация которых должна базироваться на результатах данного рефакторинга).
