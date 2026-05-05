# План декомпозиции `antarctica-player.tsx` (целевая архитектура MVP)

**Дата:** 2026-05-03 (редакция 2)
**Статус:** На согласовании
**Автор:** Claude (по результатам ревью 2026-05-02)

## Контекст

Текущий `antarctica-player.tsx` (1673 строки) смешивает три архитектурных слоя в одном React-компоненте:
- **Model** — обращения к `runtime-api` через `fetch`
- **Presenter** — логика выбора экрана, разрешения метрик, преобразования состояния
- **View** — JSX-рендеринг кнопок, карточек, панелей

Это нарушает целевую архитектуру, зафиксированную в:
- `ADR-002`: Abstract View Protocol (`IViewGateway`, `ViewCommand`, `ViewResponse`)
- `MVP Interaction Protocol`: Presenter отделяется от View через `dispatch(command)`
- `SDK/core/src/view-protocol.ts`: контракты уже существуют и должны использоваться

## Цель

Не просто разбить файл на модули, а выделить **Presenter** как отдельный слой, который:
1. Получает `ClientRequest` от View (клики, системные события).
2. Обращается к Model (`runtime-api`) и получает `RuntimeActionResult`.
3. Применяет `JSON Merge Patch` (RFC 7396) через `SDK/core` (`applyJsonMergePatch`).
4. Генерирует `ViewCommand` (`SYNC_STATE`, `NAVIGATE`, `DISPLAY_MESSAGE`, `PLAY_FX`).
5. Передаёт команды View через `IViewGateway.dispatch()`.

View становится чистым: только отрисовка и отправка `ClientRequest` обратно в Presenter.

---

## Что уже есть в архитектуре (будем использовать)

| Ресурс | Где | Что используем |
|--------|-----|---------------|
| `ViewCommand`, `ViewResponse`, `IViewGateway` | `SDK/core/src/view-protocol.ts` | Контракт Presenter -> View |
| `applyJsonMergePatch` | `SDK/core/src/state.ts` | Применение патча состояния |
| `RuntimeActionResult`, `RuntimeStateDelta` | `packages/contracts/runtime/src/index.ts` | Ответ от Model |
| `SessionSnapshot`, `ActionSnapshot` | `apps/player-web/src/lib/antarctica.ts` | Текущее состояние сессии |

---

## Phase 1. Подготовка инфраструктуры

**Задача:** Подключить `@cubica/sdk-core` к `apps/player-web` и убедиться, что типы доступны.

**Действия:**
1. Добавить `"@cubica/sdk-core": "file:../../SDK/core"` в `apps/player-web/package.json` `dependencies`.
2. Убедиться, что `tsconfig.json` разрешает путь `@cubica/sdk-core`.
3. Удалить из `apps/player-web` дублирующие определения `ViewCommand`/`IViewGateway`, если они есть (их нет, но проверить).

**Критерий:** `import { IViewGateway, ViewCommand, ViewResponse, applyJsonMergePatch } from "@cubica/sdk-core"` работает.

---

## Phase 2. Model client (обёртка над HTTP)

**Задача:** Изолировать все `fetch`-вызовы к `runtime-api` в один модуль.

**Куда:** `apps/player-web/src/presenter/runtime-client.ts`

**Интерфейс:**
```typescript
interface RuntimeClient {
  createSession(gameId: string, playerId: string): Promise<SessionSnapshot>;
  resumeSession(sessionId: string): Promise<SessionSnapshot>;
  dispatchAction(sessionId: string, playerId: string, actionId: string, payload?: Record<string, unknown>): Promise<ActionSnapshot>;
}
```

**Что делает:**
- Все `fetch`-запросы к `/api/runtime/sessions` и `/api/runtime/actions`.
- Обработка HTTP-ошибок и JSON-парсинга.
- Никакой React-логики. Чистый Model client.

**Критерий:** `antarctica-player.tsx` больше не содержит inline `fetch`.

---

## Phase 3. Логика Presenter (ядро)

**Задача:** Создать Presenter — модуль, который превращает ответ сервера в команды для View.

**Куда:** `apps/player-web/src/presenter/antarctica-presenter.ts`

**Что делает Presenter:**
1. Хранит текущее состояние сессии (`SessionSnapshot`).
2. Хранит ссылку на `IViewGateway`.
3. Метод `handleEvent(request: ClientRequest): Promise<void>`:
   - Если событие — пользовательский клик: вызвать `runtimeClient.dispatchAction()`.
   - Если событие — загрузка страницы: вызвать `runtimeClient.createSession()` / `resumeSession()`.
   - Получить `ActionSnapshot` (новое состояние от сервера).
   - Обновить внутреннее состояние.
   - Сгенерировать `ViewCommand[]`:
     - `SYNC_STATE` — новое состояние для View.
     - `NAVIGATE` — ключ экрана и layoutMode.
     - `DISPLAY_METRICS` — вычисленные метрики.
     - `SHOW_PANEL` / `HIDE_PANEL` — для journal/hint.
   - Отправить каждую команду через `this.gateway.dispatch()`.

**Зависимости Presenter:**
- `runtime-client.ts` (Model)
- `lib/antarctica-screen-resolvers.ts` (логика выбора экрана)
- `lib/antarctica-metric-resolvers.ts` (разрешение метрик)
- `lib/antarctica-constants.ts` (константы)
- `@cubica/sdk-core` (`applyJsonMergePatch`, `ViewCommand`)

**Критерий:** Presenter не импортирует React.

---

## Phase 4. React View Gateway (мост Presenter -> React)

**Задача:** Реализовать `IViewGateway` так, чтобы React-компоненты получали данные.

**Куда:** `apps/player-web/src/presenter/react-view-gateway.ts`

**Подход:** Gateway не рисует сам. Он хранит callback-регистрацию (подписку) и вызывает `setState` в React-дереве.

```typescript
class ReactViewGateway implements IViewGateway {
  private listeners: Array<(command: ViewCommand) => void> = [];

  subscribe(listener: (command: ViewCommand) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  async dispatch(command: ViewCommand): Promise<ViewResponse> {
    this.listeners.forEach((l) => l(command));
    return { status: "COMPLETED" };
  }
}
```

**Критерий:** Gateway позволяет Presenter управлять React-состоянием без прямого import React.

---

## Phase 5. Утилиты и резолверы (часть Presenter)

**Задача:** Вынести чистые функции, которые Presenter использует для принятия решений.

**Куда:** `apps/player-web/src/lib/` (существующий каталог)

**Файлы:**
- `antarctica-constants.ts` — `storageKey`, `TOPBAR_SCREEN_KEYS`, `ANTARCTICA_FALLBACK_METRICS`
- `antarctica-metric-resolvers.ts` — `resolveMetricBinding`, `resolveMetricValueByAliases`, `formatValue`
- `antarctica-screen-resolvers.ts` — `resolveScreenKey`, `resolveBoardScreenKey`, `resolveAntarcticaLayoutMode`
- `antarctica-layout-helpers.ts` — `resolveAreaCssClass`, `resolveButtonId`, `resolveMetricBackgroundImage`
- `antarctica-s1-action-adapter.ts` — преобразование S1 команд в action IDs (используется Presenter при генерации `ClientRequest`)

**Критерий:** Никакой React-зависимости. Тестируемы unit-тестами.

---

## Phase 6. View-компоненты (чистые)

**Задача:** Превратить существующие renderers в чистые View-компоненты, которые только рисуют.

**Принцип:** View не знает про `fetch`, `session`, `screenKey`. Она получает:
- `state: PlayerState` (синхронизированное Presenter-ом состояние)
- `onAction: (actionId: string, payload?: Record<string, unknown>) => void` — callback для кликов

**Куда:**
- `apps/player-web/src/components/s1/`
  - `rich-text.tsx`
  - `game-variable-component.tsx`
  - `card-component.tsx`
  - `button-component.tsx`
  - `ui-component-node.tsx`
  - `antarctica-s1-renderer.tsx`
- `apps/player-web/src/components/panels/`
  - `antarctica-panel-button-row.tsx`
  - `antarctica-hint-renderer.tsx`
  - `antarctica-journal-renderer.tsx`
  - `antarctica-metric-cluster.tsx`
  - `journal-metric-cluster.tsx`
- `apps/player-web/src/components/antarctica-fallback-renderer.tsx`

**Критерий:** Компоненты не содержат `fetch`, `useEffect` с boot, `resolveScreenKey`. Только props -> JSX.

---

## Phase 7. Root orchestrator (AntarcticaPlayer)

**Задача:** Сделать `antarctica-player.tsx` тонким слоем-связкой.

**Что делает:**
1. Создаёт `ReactViewGateway`.
2. Создаёт `AntarcticaPresenter` (передаёт gateway и runtimeClient).
3. Подписывается на gateway: `gateway.subscribe(handleViewCommand)`.
4. `handleViewCommand` обновляет React state (`useState`) на основе `ViewCommand`:
   - `SYNC_STATE` -> обновить `playerState`
   - `NAVIGATE` -> обновить `screenKey`, `layoutMode`
   - `SHOW_PANEL` -> показать hint/journal
5. Передаёт `playerState`, `screenKey`, `layoutMode`, `onAction` в View-компоненты.
6. `onAction` вызывает `presenter.handleEvent({ source: "user", type: "play_card", payload: { cardId }, timestamp })`.

**Целевой размер:** ~120-150 строк.

**Критерий:** Root не содержит бизнес-логики. Вся логика — в Presenter и lib.

---

## Phase 8. Barrel exports и cleanup

**Задача:** Добавить `index.ts` для удобства импорта.

**Куда:**
- `apps/player-web/src/presenter/index.ts`
- `apps/player-web/src/components/index.ts`
- `apps/player-web/src/components/s1/index.ts`
- `apps/player-web/src/components/panels/index.ts`
- `apps/player-web/src/lib/index.ts`
- `apps/player-web/src/types/index.ts`

**Критерий:** Корректные barrel exports, нет circular dependencies.

---

## Итоговая структура `apps/player-web/src/`

```text
src/
├── types/
│   ├── index.ts
│   └── antarctica-player.ts          # Локальные типы (PlayerState, ClientRequest)
├── lib/
│   ├── index.ts
│   ├── antarctica.ts                 # Pure content resolvers (уже есть)
│   ├── antarctica-constants.ts       # Константы
│   ├── antarctica-metric-resolvers.ts # Разрешение метрик
│   ├── antarctica-screen-resolvers.ts # Выбор экрана / layout
│   ├── antarctica-layout-helpers.ts  # CSS-классы, button IDs
│   ├── antarctica-s1-action-adapter.ts # S1 command -> action ID
│   ├── classname-utils.ts            # appendClassName
│   └── formatting.ts                 # formatValue
├── presenter/
│   ├── index.ts
│   ├── types.ts                      # ClientRequest, PresenterState
│   ├── runtime-client.ts             # HTTP client для runtime-api (Model)
│   ├── antarctica-presenter.ts       # Ядро Presenter (логика + IViewGateway)
│   └── react-view-gateway.ts         # React bridge: IViewGateway implementation
├── components/
│   ├── index.ts
│   ├── antarctica-player.tsx         # Root orchestrator (~150 строк)
│   ├── antarctica-fallback-renderer.tsx # Fallback UI (чистый View)
│   ├── s1/
│   │   ├── index.ts
│   │   ├── rich-text.tsx
│   │   ├── game-variable-component.tsx
│   │   ├── card-component.tsx
│   │   ├── button-component.tsx
│   │   ├── ui-component-node.tsx
│   │   └── antarctica-s1-renderer.tsx
│   └── panels/
│       ├── index.ts
│       ├── antarctica-panel-button-row.tsx
│       ├── antarctica-hint-renderer.tsx
│       ├── antarctica-journal-renderer.tsx
│       ├── antarctica-metric-cluster.tsx
│       └── journal-metric-cluster.tsx
├── test/
│   └── antarctica-opening-tail-fixtures.ts
```

---

## Архитектурный поток после декомпозиции

```
Игрок кликнул карточку
       │
       ▼
┌─────────────────────────────┐
│  View (React компонент)     │
│  onClick -> onAction("card", │
│  { cardId: "3" })           │
└─────────────┬───────────────┘
              │ ClientRequest
              ▼
┌─────────────────────────────┐
│  Root (AntarcticaPlayer)    │
│  presenter.handleEvent(req) │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Presenter                  │
│  • Запрашивает Model        │
│    (runtimeClient.dispatch) │
│  • Получает новое состояние │
│  • Применяет merge patch    │
│  • Выбирает экран           │
│  • Генерирует ViewCommand[] │
└─────────────┬───────────────┘
              │ dispatch(command)
              ▼
┌─────────────────────────────┐
│  ReactViewGateway           │
│  (IViewGateway impl)        │
│  • callback -> setState      │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  View (React перерисовывает)│
│  • Получает новый state     │
│  • Рисует экран             │
└─────────────────────────────┘
```

---

## Приоритет и порядок

| Phase | Приоритет | Риск ломки тестов | Почему такой порядок |
|-------|-----------|-------------------|----------------------|
| 1. Инфраструктура | Высокий | Низкий | Без SDK/core типов нельзя строить Presenter |
| 5. Утилиты | Высокий | Низкий | Чистые функции, безопасно вынести первыми |
| 2. Model client | Высокий | Средний | Изолирует fetch; остальные части начинают зависеть от него |
| 4. View Gateway | Средний | Средний | Мост; нужен после client, до Presenter |
| 3. Presenter | Высокий | Высокий | Ядро архитектуры; собирает client + gateway + утилиты |
| 6. View-компоненты | Средний | Средний | Чистые компоненты; можно делать параллельно с Presenter |
| 7. Root | Высокий | Высокий | Замена сердца компонента; делается последним |
| 8. Barrel exports | Низкий | Низкий | Финальная косметика |

**Рекомендуемый порядок:**
1 → 5 → 2 → 4 → 3 → 6 → 7 → 8

После каждого шага — `npm run typecheck` и `npm run test`.
