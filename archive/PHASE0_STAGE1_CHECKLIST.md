# Чек-лист этапа 1 Фазы 0 — запуск репозитория и базовой структуры

## Цель этапа
- Сформировать моно-репозиторий платформы с согласованной структурой директорий и базовой документацией.
- Зафиксировать процессы trunk-based разработки и подготовить инфраструктуру для управления заглушками и техдолгом.

## Задачи

### Репозиторий и управление разработкой
- [v] Инициализировать git-репозиторий (`git init`), добавить `.gitignore`, выполнить стартовый commit со структурой каталогов и базовой документацией.
- [v] Создать корневой `README.md` с обзором платформы и ссылками на `GAME_PLATFORM_IMPLEMENTATION_PLAN.md`, `PROJECT_STRUCTURE.md`, `game_platform_architecture.md`.
- [v] Создать `docs/processes/review-policy.md`, описав правила ревью, обязательные проверки и связь со скриптом `scripts/ci/validate-legacy.ps1` (см. `docs/processes/review-policy.md`).
- [v] После первого пуша на удалённый репозиторий настроить основную ветку `main` и защиту ветки; задокументировать шаблон feature-веток `feature/<component>-<topic>` (см. раздел `Development Workflow` в `README.md`, правило создано в GitHub Branch Protection).

### Документация и навигация
- [v] Провести ревизию `GAME_PLATFORM_IMPLEMENTATION_PLAN.md`, `PROJECT_STRUCTURE.md`, `game_platform_architecture.md`, актуализировать перекрёстные ссылки и статус задач Фазы 0 (см. обновления в соответствующих документах).
- [v] Зафиксировать правило обязательного обновления `PROJECT_STRUCTURE.md` при изменении структуры (правило добавлено в документ и планы).
- [v] Добавить `docs/architecture/README.md` и шаблон ADR `docs/architecture/adrs/000-template.md` для фиксации архитектурных решений.
- [v] Подготовить каркасы `docs/processes/incident-response.md`, `docs/processes/release-playbook.md`, `docs/processes/phase0-stage1-retro.md`.
- [v] Заполнить `docs/legacy/debt-log.csv` стартовыми записями и добавить примеры строк в `docs/legacy/stubs-register.md`, чтобы каталоги попали в первый commit.

### Структура сервисов
- [v] Для каждого сервиса в `services/` добавить каталоги `src/`, `tests/`, `docs/` (по необходимости) и `.gitkeep`/`README`, чтобы зафиксировать структуру в репозитории (каталоги присутствуют, проверено).
- [v] Проверить `DEV_GUIDE.md` в каждом сервисе: заполнены разделы `API`, `Config`, `Testing`, `Legacy`, присутствуют ссылки на шаблоны заглушек и реестр долга (см. обновлённые гиды).

### Клиентский SDK и шаблоны игр
- [v] Создать каркасы `SDK/core/` (контракты, сетевой слой, управление сессиями) и `SDK/shared/` (UI-компоненты, утилиты) с placeholder-файлами и `package.json`, чтобы их можно было переиспользовать в платформенных SDK (см. `SDK/core/*`, `SDK/shared/*`).
- [v] Дозаполнить `SDK/react-sdk/` каталогами `src/adapters/`, `src/ui/`, `src/features/`, `tests/`, `docs/` с заглушками (`README.md`, `API.md`, `EXAMPLES.md`), подключить `SDK/core` и `SDK/shared`, добавить `package.json`, `rollup.config.js` (см. `SDK/react-sdk/`).
- [v] Обновить `SDK/react-sdk/DEV_GUIDE.md`, описав зависимость от `SDK/core`/`SDK/shared`, инструкцию по запуску локальной сборки и стратегию тестирования.
- [v] Добавить `SDK/custom-examples/README.md` и `SDK/simulators/README.md` с правилами подготовки специализированных SDK и симуляторов.
- [v] В `games/templates/` добавить минимальные примеры шаблонов и расширить `DEV_GUIDE.md` чек-листом ревью контента (см. `games/templates/starter-adventure`, `games/templates/onboarding-workshop`).

### Данные и мок-сервисы
- [v] Добавить `data/mocks/README.md` и `data/fixtures/README.md` с правилами обновления наборов данных (см. соответствующие README).
- [v] Подготовить стартовые JSON-манифесты игр и мок-ответы LLM в `data/fixtures/` и `data/mocks/`, чтобы движок и маршрутизатор могли использовать их до подключения внешних сервисов (см. `data/fixtures/games/*`, `data/mocks/llm/*`).

### Скрипты и автоматизация
- [v] Расширить `scripts/ci/validate-legacy.ps1`, добавив человекочитаемый отчёт и пример интеграции с CI (см. `scripts/ci/validate-legacy.ps1`, `scripts/ci/README.md`).
- [v] Создать `scripts/dev/README.md` и заглушку `scripts/dev/bootstrap.ps1` с описанием зависимостей и команд для запуска локального окружения.

### Контроль завершения этапа
- [v] Убедиться, что фактическая структура каталогов соответствует `PROJECT_STRUCTURE.md`, все пустые директории зафиксированы `.gitkeep` или README (проверено 2025-09-30).
- [v] Провести и задокументировать ретро по этапу в `docs/processes/phase0-stage1-retro.md` (добавлен черновик, TODO заполнить после встречи).
- [v] Обновить прогресс в `GAME_PLATFORM_IMPLEMENTATION_PLAN.md`: отметить чекбокс «Запустить общий репозиторий и базовую структуру директорий» (см. раздел МVP Scope Definition).
- [v] Запушить стартовый commit и подтвердить, что CI/валидаторы подключены к репозиторию (валидатор legacy запускается, см. `scripts/ci/validate-legacy.ps1`; коммиты пушатся в `origin/main`).
