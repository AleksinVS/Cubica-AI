# Руководство по разработке: React SDK

## Назначение
- Предоставляет инструменты для встраивания платформенных игр Cubica в React-приложения.
- Инкапсулирует работу с Router, управляет жизненным циклом сессий и переиспользует компоненты `@cubica/sdk-shared`.

## Объем MVP
- Реализовать хуки для подключения к сессии (`useCubicaSession`) и отправки действий.
- Добавить хук `useViewState` для Abstract View: плугинный data source (локальные фикстуры/Router) + presenter, применяющий патчи состояния через `applyStateUpdates` из `@cubica/sdk-core`.
- Сгенерировать или описать TypeScript контракты Router на базе `@cubica/sdk-core`.
- Подготовить пример интеграции (Next.js) и smoke-проект для CI.

## Интеграции
- Зависит от пакетов `@cubica/sdk-core` и `@cubica/sdk-shared` (подключаются через локальные `file:`-ссылки внутри монорепозитория).
- Потребляет REST-эндпоинты Router; планируется поддержка WebSocket во Фазе 2 (`docs/architecture/router-ws-protocol.md`).
- Отправляет телеметрию согласно требованиям аналитики (описать в будущем ADR).

## Конфигурация
- Основные параметры передаются через `<CubicaProvider>` (routerBaseUrl, стратегия транспорта, темing) или напрямую в хуки через `SessionOptions` (`routerBaseUrl`, `authToken`, `timeoutMs`, `retryCount`).
- Настройки сборки/бандла — `rollup.config.js` (заглушка до выбора финального тулчейна).
- В окружениях храните ключи и секреты вне `package.json` (используйте `.env` или секреты CI).

## Тестирование
- Unit: хуки и адаптеры (Jest/Vitest + msw) — стартовый шаблон `tests/session.test.ts`.
- Интеграция: e2e smoke на примере (Next.js), Router мокается через docker-compose.
- Визуальные: взаимодействие компонентов из `@cubica/sdk-shared` (Storybook/Loki, TODO).

## Legacy и заглушки
- Все временные решения фиксируйте в `docs/legacy/sdk-stubs.md` и `docs/legacy/debt-log.csv`.
- Запланированные фичи: WebSocket транспорт, аналитические хуки, темизация — указывайте фазу и владельца.
- Матрица совместимости React/TypeScript хранится здесь до запуска автоматических проверок.

## Рабочий процесс
1. Импортируйте контракты из `@cubica/sdk-core` вместо дублирования типов.
2. Переиспользуйте темы/компоненты `@cubica/sdk-shared`.
3. Перед PR убедитесь, что обновлены docs (`docs/API.md`, `docs/EXAMPLES.md`) и записи в чек-листах.
4. Добавляйте новые примеры в `docs/EXAMPLES.md` и каталог `examples/` (создать после выбора тулчейна).
5. При интеграции с Next.js используйте `transpilePackages` и `externalDir` для локальных workspace пакетов (`@cubica/sdk-core`, `@cubica/react-sdk`, `@cubica/sdk-shared`); для Router запросов используйте `createRouterClient` (HTTP `/submit`, опциональный `authToken`).

## Документация
- Основные материалы лежат в `docs/` (`README.md`, `API.md`, `EXAMPLES.md`).
- Changelog — `CHANGELOG.md` (создать перед первым релизом).
- Все архитектурные решения фиксируйте ADR в `docs/architecture/adrs/`.
