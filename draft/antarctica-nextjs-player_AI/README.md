# Antarctica Next.js Player (games/antarctica-nextjs-player)

## Оглавление
- [Назначение](#назначение)
- [Архитектура](#архитектура)
- [Конфигурация](#конфигурация)
- [Режимы данных и фикстуры](#режимы-данных-и-фикстуры)
- [Команды разработки](#команды-разработки)
- [Тестирование](#тестирование)
- [Заглушки и технический долг](#заглушки-и-технический-долг)

## Назначение
Next.js-плеер сценария «Antarctica». Клиент рендерит Abstract View, описанный в JSON-манифесте, и работает как тонкий слой поверх SDK:
- UI-компоненты берутся из `@cubica/sdk-shared`.
- Управление состоянием и командный протокол — через `useViewState` из `@cubica/react-sdk`.
- Источники данных (локальные фикстуры или Router) инкапсулированы в `src/app/sdk/dataSources.js`.

## Архитектура
- `src/app/page.js` вычисляет параметры запуска (локальные фикстуры или Router) и монтирует `GameScreenRenderer`.
- `GameScreenRenderer` использует `useViewState` с гибридным data source, строит entrypoint через `findEntryPoint` и рендерит дерево через `src/app/utils/renderer.js`.
- `renderer.js` маппит типы Abstract View на компоненты из `@cubica/sdk-shared` (`GameScreen`, `GameArea`, `GameButton`, `GameCard`, `GameVariable`, `JournalVariable`, `HelperComponent`) и пробрасывает `onAction`.
- `src/app/sdk/presenter.js` принимает action descriptors (`command`, `payload`) и диспатчит команды: локальные действия переключают фикстуры, `requestServer` отправляется в Router.
- `src/app/api/submit/route.js` — dev-заглушка Router, отдающая стартовое состояние и патч метрик (Merge Patch по умолчанию; JSON Patch опционально).

## Конфигурация
- `src/app/config/runtime.js` — базовая конфигурация Router.
  - `NEXT_PUBLIC_ROUTER_BASE_URL` — базовый URL Router (по умолчанию `/api` для локальной заглушки).
  - `NEXT_PUBLIC_ROUTER_TOKEN` — токен авторизации, пробрасывается в заголовок `Authorization`.
  - `NEXT_PUBLIC_ROUTER_TIMEOUT_MS` — таймаут запросов (мс).
  - `NEXT_PUBLIC_USE_LOCAL_DATA` — дефолтное значение режима локальных данных (`true`/`false`).
- Параметры запроса:
  - `?local=true|false` (`localData`/`localDevelopment` аналогично) — переключение фикстур/Router.
  - `?screen=main|leftsidebar|hint|journal|antarctica` (`fixture`/`view` аналоги) — выбор фикстуры/пакета.

## Режимы данных и фикстуры
- Локальные файлы: `src/app/data/screen_s1.json`, `screen_leftsidebar.json`, `screen_hint.json`, `screen_j.json`.
- `src/app/utils/localDataLoader.js` возвращает клонированный манифест по ключу (`main` по умолчанию); `antarctica` загружается как “view model” `{ game, ui }` из `games/antarctica/*`.
- В режиме Router data source обращается к `createRouterClient` из `@cubica/react-sdk` и ожидает payload вида `{ state?, mergePatch?, jsonPatch? }` (поле `updates` поддерживается как исторический алиас Merge Patch).

## Команды разработки
```bash
# генерация package-lock без установки зависимостей
npm install --package-lock-only
# запуск dev-сервера
npm run dev
# сборка/старт
npm run build && npm start
```
Пакет использует локальные зависимости-workspace: `@cubica/sdk-core`, `@cubica/react-sdk`, `@cubica/sdk-shared` (`file:../../SDK/*`). Для корректной сборки Next.js включает `transpilePackages` и `externalDir`.

## Тестирование
- Автотестов пока нет, но есть smoke-проверка (короткая автоматическая проверка основного сценария) entry point и поведения presenter:
  - `npm run smoke`
- Рекомендуется добавить проверки рендера (fixtures) и тесты presenter/команд Router после интеграции с реальным backend.

## Заглушки и технический долг
- Dev-стаб Router: `src/app/api/submit/route.js` — отдаёт стартовое состояние из фикстур и пример патча `game.state.public.metrics.score` (Merge Patch; JSON Patch включается через `patchMode=jsonPatch`). Зарегистрировать в `docs/legacy/debt-log.csv` и `docs/legacy/stubs-register.md` (id `LEGACY-0002`).
- Источник данных Router пока ожидает HTTP `/submit`; WebSocket и реальные токены должны добавиться после появления Router.
