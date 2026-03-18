# @cubica/viewer-web-base

Базовый веб-viewer для платформы Cubica. Предоставляет переиспользуемые компоненты для создания игровых плееров на основе JSON-манифестов.

## Оглавление

- [Обзор](#обзор)
- [Установка](#установка)
- [Быстрый старт](#быстрый-старт)
- [Компоненты](#компоненты)
  - [ManifestLoader](#manifestloader)
  - [StateManager](#statemanager)
  - [ActionRouter](#actionrouter)
- [Типы и интерфейсы](#типы-и-интерфейсы)
- [Архитектура](#архитектура)
- [Примеры использования](#примеры-использования)
- [API Reference](#api-reference)
- [Связанные документы](#связанные-документы)

## Обзор

Viewer (плеер) — это клиентский модуль, который читает JSON-манифесты (описание игры и UI) и отображает их пользователю. Данный пакет реализует базовую функциональность веб-viewer согласно [ADR-014](../../docs/architecture/adrs/014-viewers-library-architecture.md).

**Основные возможности:**

- Загрузка и кеширование манифестов (GameManifest, UIManifest)
- Управление состоянием игры с поддержкой JSON Merge Patch
- Маршрутизация действий от UI к обработчикам
- Поддержка SDUI (Server-Driven UI — интерфейс, управляемый сервером)

## Установка

```bash
# Через npm workspace (внутри монорепозитория)
npm install @cubica/viewer-web-base

# Или добавить в package.json
{
  "dependencies": {
    "@cubica/viewer-web-base": "workspace:*"
  }
}
```

**Зависимости:**

- `@cubica/sdk-core` — базовые типы и утилиты SDK
- `@cubica/shared` — общие UI-компоненты
- `react` >= 18.0.0

## Быстрый старт

```tsx
import { ManifestLoader, StateManager, ActionRouter } from '@cubica/viewer-web-base';
import type { ViewerConfig } from '@cubica/viewer-web-base';

const config: ViewerConfig = {
  gameManifestUrl: '/games/my-game/manifest.json',
  mode: 'online',
};

function GameViewer() {
  return (
    <ManifestLoader config={config}>
      {({ gameManifest, status, error }) => {
        if (status === 'loading') return <div>Загрузка...</div>;
        if (status === 'error') return <div>Ошибка: {error}</div>;
        if (!gameManifest) return null;

        return (
          <StateManager initialState={gameManifest.initialState || { variables: {} }}>
            {({ state, applyPatch }) => (
              <ActionRouter
                state={state}
                onStateChange={applyPatch}
              >
                {({ dispatchAction }) => (
                  <div>
                    <h1>{gameManifest.meta.title}</h1>
                    {/* Рендеринг игры на основе манифеста */}
                  </div>
                )}
              </ActionRouter>
            )}
          </StateManager>
        );
      }}
    </ManifestLoader>
  );
}
```

## Компоненты

### ManifestLoader

Загружает игровые манифесты (GameManifest, UIManifest) и предоставляет их через render prop.

**Props:**

| Prop | Тип | Описание |
|------|-----|----------|
| `config` | `ViewerConfig` | Конфигурация с путями к манифестам |
| `options` | `ManifestLoaderOptions` | Опции загрузки (baseUrl, useCache, timeout) |
| `children` | `(result) => ReactNode` | Render prop |
| `onLoad` | `(game, ui) => void` | Callback при успешной загрузке |
| `onError` | `(error) => void` | Callback при ошибке |

**Пример:**

```tsx
<ManifestLoader
  config={{ gameManifestUrl: '/api/games/123/manifest' }}
  options={{ useCache: true, timeoutMs: 5000 }}
  onLoad={(game) => console.log('Загружена игра:', game.meta.title)}
>
  {({ gameManifest, uiManifest, status, reload }) => (
    // ...
  )}
</ManifestLoader>
```

**Hook:**

```tsx
const { gameManifest, status, reload } = useManifestLoader(config, options);
```

### StateManager

Управляет состоянием игры с поддержкой JSON Merge Patch (RFC 7396).

**Props:**

| Prop | Тип | Описание |
|------|-----|----------|
| `initialState` | `T` | Начальное состояние |
| `children` | `(result) => ReactNode` | Render prop |
| `onChange` | `(state, prev) => void` | Callback при изменении |
| `onDispatch` | `(command) => void` | Callback при dispatch |
| `persistKey` | `string` | Ключ для сохранения в localStorage |

**Пример:**

```tsx
<StateManager
  initialState={{ score: 0, health: 100, variables: {} }}
  persistKey="game-save"
  onChange={(state) => console.log('Состояние изменилось:', state)}
>
  {({ state, applyPatch, reset }) => (
    <div>
      <p>Счёт: {state.score}</p>
      <button onClick={() => applyPatch({ score: state.score + 10 })}>
        +10 очков
      </button>
      <button onClick={reset}>Сбросить</button>
    </div>
  )}
</StateManager>
```

**Hook:**

```tsx
const { state, setState, applyPatch, reset } = useStateManager(initialState, {
  onChange: (state, prev) => console.log('Changed'),
  persistKey: 'my-game',
});
```

**Фабрика (для использования вне React):**

```ts
const manager = createStateManager({ score: 0 });

const unsubscribe = manager.subscribe((state, prev) => {
  console.log('State:', state);
});

manager.applyPatch({ score: 10 });
```

### ActionRouter

Маршрутизирует действия от UI-компонентов к обработчикам.

**Встроенные команды:**

| Команда | Payload | Описание |
|---------|---------|----------|
| `navigate` | `{ scene: string }` | Переход между сценами |
| `updateState` | `{ patch: object }` | Обновление состояния |
| `setVariable` | `{ name, value }` | Установка переменной |
| `playEffect` | `{ type, ... }` | Воспроизведение эффекта |
| `sendCommand` | `{ command: ViewCommand }` | Отправка на Router |
| `noop` | — | Пустое действие |

**Props:**

| Prop | Тип | Описание |
|------|-----|----------|
| `state` | `GameState` | Текущее состояние игры |
| `children` | `(result) => ReactNode` | Render prop |
| `onNavigate` | `(sceneId) => void` | Callback при навигации |
| `onStateChange` | `(patch) => void` | Callback при изменении состояния |
| `onSendCommand` | `(cmd) => Promise` | Callback при отправке команды |
| `onError` | `(error, action) => void` | Callback при ошибке |
| `customHandlers` | `Record<string, ActionHandler>` | Пользовательские обработчики |

**Пример:**

```tsx
<ActionRouter
  state={gameState}
  onNavigate={(sceneId) => setScene(sceneId)}
  onStateChange={(patch) => applyPatch(patch)}
  customHandlers={{
    showDialog: async (action) => {
      await showModal(action.payload.text);
      return { success: true };
    },
  }}
>
  {({ dispatchAction, registerHandler }) => (
    <button
      onClick={() =>
        dispatchAction({
          command: 'navigate',
          payload: { scene: 'level2' },
        })
      }
    >
      Следующий уровень
    </button>
  )}
</ActionRouter>
```

## Типы и интерфейсы

### GameManifest

Описание игры (логика, метаданные, сценарий).

```ts
interface GameManifest {
  meta: GameManifestMeta;       // Метаданные игры
  variables?: GameVariable[];   // Определения переменных
  scenes?: GameScene[];         // Определения сцен
  initialScene?: string;        // Стартовая сцена
  initialState?: object;        // Начальное состояние
}
```

### UIManifest

Описание пользовательского интерфейса (SDUI).

```ts
interface UIManifest {
  screens: UIScreen[];          // Экраны
  theme?: object;               // Глобальные стили
  sharedComponents?: object;    // Общие компоненты
}
```

### ViewerConfig

Конфигурация viewer.

```ts
interface ViewerConfig {
  gameManifestUrl?: string;     // URL game manifest
  gameManifest?: GameManifest;  // Inline manifest
  uiManifestUrl?: string;       // URL UI manifest
  sessionId?: string;           // ID сессии
  mode?: 'online' | 'offline' | 'demo';
  debug?: boolean;
}
```

### GameState

Состояние игры в runtime.

```ts
interface GameState {
  currentScene?: string;        // Текущая сцена
  variables: Record<string, unknown>;  // Переменные
  uiState?: object;             // Данные UI
  history?: string[];           // История переходов
  isCompleted?: boolean;        // Флаг завершения
}
```

## Архитектура

```
SDK/viewers/web-base/
├── package.json          # NPM пакет @cubica/viewer-web-base
├── viewer.json           # Метаданные viewer (по ADR-014)
├── README.md             # Документация (этот файл)
└── src/
    ├── index.ts          # Точка входа, экспорты
    ├── types.ts          # Типы и интерфейсы
    └── components/
        ├── index.ts      # Barrel export компонентов
        ├── ManifestLoader.tsx    # Загрузка манифестов
        ├── StateManager.tsx      # Управление состоянием
        └── ActionRouter.tsx      # Маршрутизация действий
```

**Взаимодействие компонентов:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         ManifestLoader                          │
│  Загружает GameManifest и UIManifest, предоставляет в контекст  │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         StateManager                            │
│  Хранит GameState, применяет патчи, уведомляет подписчиков      │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                         ActionRouter                            │
│  Принимает ViewAction от UI, маршрутизирует к обработчикам      │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
                    ┌──────────┴──────────┐
                    │                     │
              Встроенные            Пользовательские
              обработчики           обработчики
              (navigate,            (customHandlers)
              updateState)
```

## Примеры использования

### Простой плеер

```tsx
import { ManifestLoader, StateManager, ActionRouter } from '@cubica/viewer-web-base';

function SimplePlayer({ gameUrl }) {
  return (
    <ManifestLoader config={{ gameManifestUrl: gameUrl }}>
      {({ gameManifest, status }) => {
        if (status !== 'ready') return <Loading />;

        return (
          <StateManager initialState={{ variables: {}, currentScene: gameManifest.initialScene }}>
            {({ state, applyPatch }) => (
              <ActionRouter
                state={state}
                onNavigate={(scene) => applyPatch({ currentScene: scene })}
                onStateChange={applyPatch}
              >
                {({ dispatchAction }) => (
                  <GameRenderer
                    manifest={gameManifest}
                    currentScene={state.currentScene}
                    dispatchAction={dispatchAction}
                  />
                )}
              </ActionRouter>
            )}
          </StateManager>
        );
      }}
    </ManifestLoader>
  );
}
```

### С кастомными обработчиками

```tsx
const customHandlers = {
  playSound: async (action) => {
    const audio = new Audio(action.payload.url);
    await audio.play();
    return { success: true };
  },

  showAchievement: async (action, context) => {
    toast.success(`Достижение: ${action.payload.title}`);
    return { success: true };
  },
};

<ActionRouter customHandlers={customHandlers}>
  {({ dispatchAction }) => (
    <button onClick={() => dispatchAction({ command: 'playSound', payload: { url: '/sounds/click.mp3' } })}>
      Click me!
    </button>
  )}
</ActionRouter>
```

## API Reference

### Hooks

| Hook | Описание |
|------|----------|
| `useManifestLoader(config, options)` | Загрузка манифестов |
| `useManifestContext()` | Доступ к манифестам из контекста |
| `useStateManager(initial, options)` | Управление состоянием |
| `useStateContext()` | Доступ к состоянию из контекста |
| `useActionRouter(options)` | Создание ActionRouter |
| `useActionRouterContext()` | Доступ к ActionRouter из контекста |

### Утилиты

| Функция | Описание |
|---------|----------|
| `createStateManager(initial)` | Создать StateManager вне React |
| `createActionRouter(options)` | Создать ActionRouter вне React |
| `clearManifestCache()` | Очистить кеш манифестов |
| `invalidateManifest(url)` | Удалить манифест из кеша |

## Связанные документы

- [ADR-014: Архитектура библиотеки viewers](../../docs/architecture/adrs/014-viewers-library-architecture.md)
- [ADR-001: MVP & LLM-first Game Manifests](../../docs/architecture/adrs/001-mvp-and-llm-first-game-manifests.md)
- [ADR-002: Abstract View Protocol](../../docs/architecture/adrs/002-abstract-view-protocol.md)
- [PROJECT_ARCHITECTURE.md](../../docs/architecture/PROJECT_ARCHITECTURE.md)

---

**Версия:** 0.1.0
**Дата создания:** 2026-01-14
**Автор:** Cubica Team
