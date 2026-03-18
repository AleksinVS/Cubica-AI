/**
 * @fileoverview Базовые типы и интерфейсы для веб-viewer платформы Cubica.
 *
 * Этот модуль определяет контракты для:
 * - GameManifest — описание игры (логика, метаданные, сценарий)
 * - UIManifest — описание пользовательского интерфейса (экраны, компоненты)
 * - ViewerConfig — конфигурация viewer для конкретной игры
 * - GameState — текущее состояние игры
 *
 * Типы соответствуют ADR-014 (Viewers Library Architecture) и ADR-001 (MVP & LLM-first Game Manifests).
 */

import type { ViewCommand, ViewResponse } from '@cubica/sdk-core';
import type { ViewAction, ActionDispatcher } from '@cubica/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Game Manifest Types (Игровой манифест — описание логики и метаданных игры)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Метаданные игры в game manifest.
 * Содержит информацию о названии, версии, авторе и требуемом viewer.
 */
export interface GameManifestMeta {
  /** Уникальный идентификатор игры */
  id: string;

  /** Название игры */
  title: string;

  /** Версия игры (semver — семантическое версионирование, например "1.0.0") */
  version: string;

  /** Автор или команда разработки */
  author?: string;

  /** Краткое описание игры */
  description?: string;

  /** Требования к viewer для запуска игры */
  viewer?: {
    /** Идентификатор viewer (например "web-base") */
    id: string;
    /** Требуемая версия viewer */
    version?: string;
    /** Канал обновлений: stable, beta, dev */
    channel?: 'stable' | 'beta' | 'dev';
  };

  /** Версия схемы game manifest */
  schemaVersion?: string;
}

/**
 * Определение переменной в игре.
 * Переменные хранят состояние игры (счёт, инвентарь, прогресс).
 */
export interface GameVariable {
  /** Уникальный идентификатор переменной */
  id: string;

  /** Человекочитаемое название */
  name?: string;

  /** Тип данных переменной */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';

  /** Начальное значение */
  defaultValue?: unknown;

  /** Описание назначения переменной */
  description?: string;

  /** Флаг видимости для игрока */
  visible?: boolean;
}

/**
 * Определение сцены (экрана) в игре.
 */
export interface GameScene {
  /** Уникальный идентификатор сцены */
  id: string;

  /** Название сцены */
  name?: string;

  /** Ссылка на UI manifest для рендеринга */
  uiManifestRef?: string;

  /** Встроенный UI manifest (inline) */
  uiManifest?: UIManifest;

  /** Условия входа в сцену */
  entryConditions?: Record<string, unknown>[];

  /** Действия при входе в сцену */
  onEnter?: ViewAction[];

  /** Действия при выходе из сцены */
  onExit?: ViewAction[];
}

/**
 * Game Manifest — полное описание игры.
 *
 * Содержит:
 * - meta: метаданные игры
 * - variables: определения переменных состояния
 * - scenes: определения сцен/экранов
 * - initialScene: стартовая сцена
 */
export interface GameManifest {
  /** Версия схемы манифеста */
  $schema?: string;

  /** Метаданные игры */
  meta: GameManifestMeta;

  /** Определения переменных состояния игры */
  variables?: GameVariable[];

  /** Определения сцен */
  scenes?: GameScene[];

  /** Идентификатор стартовой сцены */
  initialScene?: string;

  /** Начальное состояние игры */
  initialState?: Record<string, unknown>;

  /** Дополнительные поля для расширений */
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Manifest Types (UI манифест — описание пользовательского интерфейса)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Базовый UI-компонент в манифесте.
 * Описывает элемент интерфейса с возможными действиями.
 */
export interface UIComponent {
  /** Уникальный идентификатор компонента */
  id: string;

  /** Тип компонента (например "button", "text", "card", "area") */
  type: string;

  /** Свойства компонента (зависят от типа) */
  props?: Record<string, unknown>;

  /** Дочерние компоненты */
  children?: UIComponent[];

  /** Действия, привязанные к компоненту */
  actions?: {
    onClick?: ViewAction;
    onHover?: ViewAction;
    [key: string]: ViewAction | undefined;
  };

  /** Условие видимости компонента */
  visible?: boolean | string;

  /** CSS-стили или классы */
  style?: Record<string, unknown>;
  className?: string;
}

/**
 * Определение экрана в UI manifest.
 */
export interface UIScreen {
  /** Уникальный идентификатор экрана */
  id: string;

  /** Название экрана */
  name?: string;

  /** Корневые компоненты экрана */
  components: UIComponent[];

  /** Макет экрана (layout) */
  layout?: {
    type: 'stack' | 'grid' | 'flex' | 'absolute';
    props?: Record<string, unknown>;
  };

  /** Фоновые настройки */
  background?: {
    color?: string;
    image?: string;
    gradient?: string;
  };
}

/**
 * UI Manifest — описание пользовательского интерфейса.
 *
 * Следует принципу SDUI (Server-Driven UI — интерфейс, управляемый сервером):
 * структура UI полностью описана в JSON и рендерится viewer.
 */
export interface UIManifest {
  /** Версия схемы манифеста */
  $schema?: string;

  /** Версия UI manifest */
  version?: string;

  /** Идентификатор связанной игры */
  gameId?: string;

  /** Определения экранов */
  screens: UIScreen[];

  /** Глобальные стили */
  theme?: {
    colors?: Record<string, string>;
    fonts?: Record<string, string>;
    spacing?: Record<string, string | number>;
  };

  /** Общие компоненты для переиспользования */
  sharedComponents?: Record<string, UIComponent>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewer Configuration Types (Конфигурация viewer)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Конфигурация viewer для запуска конкретной игры.
 */
export interface ViewerConfig {
  /** URL или путь к game manifest */
  gameManifestUrl?: string;

  /** Inline game manifest (альтернатива URL) */
  gameManifest?: GameManifest;

  /** URL или путь к UI manifest */
  uiManifestUrl?: string;

  /** Inline UI manifest (альтернатива URL) */
  uiManifest?: UIManifest;

  /** Идентификатор сессии для сохранения состояния */
  sessionId?: string;

  /** Базовый URL для загрузки ресурсов */
  baseUrl?: string;

  /** URL Router для отправки команд */
  routerUrl?: string;

  /** Режим работы viewer */
  mode?: 'online' | 'offline' | 'demo';

  /** Включить режим отладки */
  debug?: boolean;

  /** Дополнительные опции */
  options?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Game State Types (Состояние игры)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Состояние игры в runtime.
 * Содержит текущие значения переменных, активную сцену и историю.
 */
export interface GameState {
  /** Текущая активная сцена */
  currentScene?: string;

  /** Значения переменных игры */
  variables: Record<string, unknown>;

  /** Данные для рендеринга UI текущей сцены */
  uiState?: Record<string, unknown>;

  /** История переходов между сценами */
  history?: string[];

  /** Флаг завершения игры */
  isCompleted?: boolean;

  /** Временные метаданные сессии */
  sessionMeta?: {
    startedAt?: string;
    lastUpdatedAt?: string;
    playTime?: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest Loading Types (Типы для загрузки манифестов)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Результат загрузки манифеста.
 */
export interface ManifestLoadResult<T> {
  /** Успешно ли загружен манифест */
  success: boolean;

  /** Загруженные данные */
  data?: T;

  /** Ошибка при загрузке */
  error?: {
    code: string;
    message: string;
  };

  /** Источник данных: url, inline, cache */
  source?: 'url' | 'inline' | 'cache';
}

/**
 * Опции для загрузчика манифестов.
 */
export interface ManifestLoaderOptions {
  /** Базовый URL для относительных путей */
  baseUrl?: string;

  /** Использовать кеш */
  useCache?: boolean;

  /** Таймаут загрузки в миллисекундах */
  timeoutMs?: number;

  /** Функция валидации манифеста */
  validate?: (manifest: unknown) => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Routing Types (Типы для маршрутизации действий)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Контекст выполнения действия.
 */
export interface ActionContext {
  /** Идентификатор компонента-источника */
  componentId?: string;

  /** Идентификатор текущей сцены */
  sceneId?: string;

  /** Тип события (click, hover, etc.) */
  eventType?: string;

  /** Текущее состояние игры */
  gameState?: GameState;

  /** Дополнительные данные контекста */
  extra?: Record<string, unknown>;
}

/**
 * Результат выполнения действия.
 */
export interface ActionResult {
  /** Успешно ли выполнено действие */
  success: boolean;

  /** Команда для обновления UI */
  command?: ViewCommand;

  /** Патч для обновления состояния */
  statePatch?: Record<string, unknown>;

  /** Следующая сцена для перехода */
  nextScene?: string;

  /** Ошибка выполнения */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Обработчик действий (Action Handler).
 * Функция, которая обрабатывает ViewAction и возвращает результат.
 */
export type ActionHandler = (
  action: ViewAction,
  context: ActionContext
) => Promise<ActionResult> | ActionResult;

/**
 * Реестр обработчиков действий.
 * Карта: command -> handler.
 */
export type ActionHandlerRegistry = Map<string, ActionHandler>;

// ─────────────────────────────────────────────────────────────────────────────
// State Manager Types (Типы для управления состоянием)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Подписчик на изменения состояния.
 */
export type StateSubscriber<T> = (state: T, previousState: T) => void;

/**
 * Интерфейс менеджера состояния.
 */
export interface IStateManager<T> {
  /** Получить текущее состояние */
  getState(): T;

  /** Установить новое состояние */
  setState(state: T): void;

  /** Применить патч к состоянию (JSON Merge Patch) */
  applyPatch(patch: Partial<T>): void;

  /** Подписаться на изменения состояния */
  subscribe(subscriber: StateSubscriber<T>): () => void;

  /** Сбросить состояние к начальному */
  reset(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports from SDK packages (Реэкспорт из SDK пакетов)
// ─────────────────────────────────────────────────────────────────────────────

export type { ViewCommand, ViewResponse, ViewAction, ActionDispatcher };
