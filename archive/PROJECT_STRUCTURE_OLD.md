# Структура монорепозитория Cubica

Этот документ — краткий справочник по каталогам и ключевым артефактам репозитория. Используйте его как точку входа для навигации по коду, инфраструктуре и документации.

> Важно:
> - Любое добавление, переименование или удаление каталогов верхнего уровня и ключевых артефактов (README, чек‑листы, планы) должно сопровождаться обновлением `PROJECT_STRUCTURE.md` в том же PR.

## Дерево каталогов (сокращенно)

```
Cubica/
├── .github/
│   └── workflows/                               # CI: проверки и сборки (agent-checks, ci)
├── .vscode/                                     # Локальные настройки IDE
├── archive/                                     # Архивные материалы
├── data/
│   ├── fixtures/                                # Фикстуры для разработки/тестов
│   │   └── games/
│   │       └── antarctica.json
│   └── mocks/                                   # Моки внешних систем
│       ├── llm/
│       │   └── default-response.json
│       └── router/
│           └── starter-session.json
├── docs/
│   ├── agents/                                  # Контекст, шаблоны и инструменты для агентов
│   ├── architecture/                            # ADR, схемы, SQL, спецификации
│   ├── processes/                               # Политики и регламенты
│   └── legacy/                                  # Исторические документы и технический долг
├── draft/                                       # Черновики
├── games/
│   └── templates/
│       └── assets/
├── scripts/
│   ├── ci/                                      # CI-валидаторы, сборка контекста
│   ├── dev/                                     # Bootstrap-скрипты окружения
│   └── indexing/                                # Индексация (например, Qdrant)
├── SDK/                                         # Экосистема клиентских SDK
│   ├── core/                                    # Контракты, сетевой слой, типы
│   ├── shared/                                  # Общие UI/утилиты
│   ├── react-sdk/                               # Клиент на React/Next.js
│   ├── simulators/                              # Локальные симуляторы
│   └── custom-examples/                         # Примеры интеграции
├── services/                                    # Микросервисы платформы
│   ├── router/                                  # API-шлюз и оркестрация сессий
│   ├── game-engine/                             # Игровой движок и LLM‑интеграции
│   ├── game-catalog/                            # Каталог игр
│   ├── game-editor/                             # Инструменты для авторов
│   ├── game-repository/                         # CRUD над манифестами игр
│   └── metadata-db/                             # Метаданные и аналитика
├── .gitignore
├── GAME_PLATFORM_IMPLEMENTATION_PLAN.md
├── game_platform_architecture.md
├── PHASE0_STAGE2_CHECKLIST.md
├── PROJECT_STRUCTURE.md
└── README.md
```

## Пояснения по ключевым каталогам

- `.github/workflows` — CI-пайплайны (`agent-checks.yml`, `ci.yml`).
- `docs/architecture` — ADR, схемы (`schemas/manifest.v1.schema.json`), SQL, открытые спецификации.
- `docs/processes` — регламенты (review‑policy, release‑playbook, incident‑response).
- `docs/legacy` — реестр техдолга (`debt-log.csv`), исторические заметки.
- `scripts/ci` — валидаторы и утилиты CI (python/ps1/js).
- `scripts/dev` — bootstrap скрипты для локальной разработки (PowerShell/bash).
- `scripts/indexing` — индексаторы (например, `qdrant_indexer.py`).
- `data/fixtures` — тестовые/демо‑данные (например, `games/antarctica.json`).
- `data/mocks` — моки ответов (LLM/Router) для быстрой отладки.
- `games/templates` — базовые шаблоны и ассеты для игр.
- `SDK/core` — общие контракты, сети и типы данных; есть `docs/`, `src/`, `tests/`.
- `SDK/react-sdk` — клиентская библиотека React; `docs/`, `src/`, `tests/`.
- `SDK/shared` — общие UI/утилиты; `docs/`, `src/`, `tests/`.
- `SDK/simulators`, `SDK/custom-examples` — вспомогательные пакеты/примеры (набор пополняется).
- `services/*` — каждый сервис имеет типовую структуру: `docs/`, `src/`, `tests/`.

## Навигация и точки входа

- `game_platform_architecture.md` - обзор архитектуры
- `GAME_PLATFORM_IMPLEMENTATION_PLAN.md` — roadmap и план реализации.
- `PROJECT_STRUCTURE.md` — актуальная структура репозитория.
- `docs/legacy/debt-log.csv` — реестр техдолга и заглушек.
- `PHASE0_STAGE1_CHECKLIST.md` — выполнение задач подготовки репозитория и инфраструктуры.
- `docs/architecture/README.md` — карта архитектурных артефактов и инструкция по обновлениям.
- `docs/architecture/adrs/000-template.md` — шаблон для фиксации архитектурных решений.
- `docs/architecture/adrs/` — архив утверждённых ADR.

Если структура изменилась — обновите это описание и при необходимости добавьте краткие README/AGENTS-файлы в новые каталоги.