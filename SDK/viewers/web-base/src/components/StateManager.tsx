'use client';

/**
 * @fileoverview StateManager — компонент для управления состоянием игры.
 *
 * StateManager отвечает за:
 * - Хранение текущего состояния игры (GameState)
 * - Применение патчей к состоянию (JSON Merge Patch, RFC 7396)
 * - Уведомление подписчиков об изменениях
 * - Синхронизацию состояния с внешними источниками (Router, localStorage)
 *
 * Использует паттерн "подписка-публикация" для реактивного обновления UI.
 *
 * @example
 * ```tsx
 * <StateManager initialState={{ score: 0, level: 1 }}>
 *   {({ state, dispatch, applyPatch }) => (
 *     <GameView
 *       score={state.score}
 *       onScoreChange={(delta) => applyPatch({ score: state.score + delta })}
 *     />
 *   )}
 * </StateManager>
 * ```
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

import { applyJsonMergePatch, type JsonValue } from '@cubica/sdk-core';

import type {
  GameState,
  IStateManager,
  StateSubscriber,
  ViewCommand,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types (Типы)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Результат работы StateManager, передаваемый в render prop.
 */
export interface StateManagerResult<T = GameState> {
  /** Текущее состояние */
  state: T;

  /** Установить новое состояние полностью */
  setState: (state: T) => void;

  /** Применить патч к состоянию (JSON Merge Patch) */
  applyPatch: (patch: Partial<T>) => void;

  /** Сбросить состояние к начальному */
  reset: () => void;

  /** Отправить команду (dispatch) */
  dispatch: (command: ViewCommand) => void;

  /** Получить значение переменной по пути */
  getVariable: <V = unknown>(path: string) => V | undefined;

  /** Установить значение переменной по пути */
  setVariable: (path: string, value: unknown) => void;
}

/**
 * Props для компонента StateManager.
 */
export interface StateManagerProps<T = GameState> {
  /** Начальное состояние */
  initialState: T;

  /** Render prop для рендеринга содержимого */
  children: (result: StateManagerResult<T>) => ReactNode;

  /** Callback при изменении состояния */
  onChange?: (state: T, previousState: T) => void;

  /** Callback при dispatch команды */
  onDispatch?: (command: ViewCommand) => void | Promise<void>;

  /** Включить синхронизацию с localStorage */
  persistKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context (Контекст для доступа к состоянию в дочерних компонентах)
// ─────────────────────────────────────────────────────────────────────────────

const StateContext = createContext<StateManagerResult | null>(null);

/**
 * Hook для получения состояния из контекста.
 *
 * @throws Ошибка если используется вне StateManager.
 */
export function useStateContext<T = GameState>(): StateManagerResult<T> {
  const context = useContext(StateContext);
  if (!context) {
    throw new Error(
      'useStateContext must be used within a StateManager. ' +
      'Wrap your component tree with <StateManager> first.'
    );
  }
  return context as StateManagerResult<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities (Утилиты)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Получить значение по пути в объекте.
 * Путь в формате "a.b.c" или "a.b[0].c".
 *
 * @param obj - Объект для поиска
 * @param path - Путь к значению
 * @returns Найденное значение или undefined
 */
function getByPath<T>(obj: unknown, path: string): T | undefined {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }

  const segments = path.split('.').flatMap((segment) => {
    // Обработка индексов массивов: "items[0]" -> ["items", "0"]
    const match = segment.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      return [match[1], match[2]];
    }
    return segment;
  });

  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current as T;
}

/**
 * Установить значение по пути в объекте (иммутабельно).
 *
 * @param obj - Исходный объект
 * @param path - Путь к значению
 * @param value - Новое значение
 * @returns Новый объект с установленным значением
 */
function setByPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown
): T {
  const segments = path.split('.');

  if (segments.length === 0) {
    return obj;
  }

  const [first, ...rest] = segments;

  if (rest.length === 0) {
    return { ...obj, [first]: value };
  }

  const nested = obj[first];
  const nestedObj =
    nested && typeof nested === 'object' ? nested : {};

  return {
    ...obj,
    [first]: setByPath(nestedObj as Record<string, unknown>, rest.join('.'), value),
  };
}

/**
 * Загрузить состояние из localStorage.
 */
function loadFromStorage<T>(key: string): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as T;
    }
  } catch {
    console.warn(`Failed to load state from localStorage key "${key}"`);
  }

  return null;
}

/**
 * Сохранить состояние в localStorage.
 */
function saveToStorage<T>(key: string, state: T): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    console.warn(`Failed to save state to localStorage key "${key}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Class: StateManager (для использования вне React)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Создать экземпляр StateManager для использования вне React.
 *
 * @param initialState - Начальное состояние
 * @returns Интерфейс IStateManager
 *
 * @example
 * ```ts
 * const manager = createStateManager({ score: 0 });
 *
 * const unsubscribe = manager.subscribe((state, prev) => {
 *   console.log('State changed:', prev, '->', state);
 * });
 *
 * manager.applyPatch({ score: 10 });
 * // Output: State changed: { score: 0 } -> { score: 10 }
 *
 * unsubscribe();
 * ```
 */
export function createStateManager<T extends Record<string, unknown>>(
  initialState: T
): IStateManager<T> {
  let currentState = { ...initialState };
  const subscribers = new Set<StateSubscriber<T>>();

  const notify = (previousState: T) => {
    subscribers.forEach((subscriber) => {
      try {
        subscriber(currentState, previousState);
      } catch (error) {
        console.error('StateManager subscriber error:', error);
      }
    });
  };

  return {
    getState: () => currentState,

    setState: (state: T) => {
      const previousState = currentState;
      currentState = { ...state };
      notify(previousState);
    },

    applyPatch: (patch: Partial<T>) => {
      const previousState = currentState;
      currentState = applyJsonMergePatch(
        currentState as JsonValue,
        patch as JsonValue
      ) as T;
      notify(previousState);
    },

    subscribe: (subscriber: StateSubscriber<T>) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },

    reset: () => {
      const previousState = currentState;
      currentState = { ...initialState };
      notify(previousState);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useStateManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook для управления состоянием.
 *
 * @param initialState - Начальное состояние
 * @param options - Опции (onChange, onDispatch, persistKey)
 * @returns Интерфейс управления состоянием
 */
export function useStateManager<T extends Record<string, unknown>>(
  initialState: T,
  options?: {
    onChange?: (state: T, previousState: T) => void;
    onDispatch?: (command: ViewCommand) => void | Promise<void>;
    persistKey?: string;
  }
): StateManagerResult<T> {
  // Загрузка из localStorage при инициализации
  const resolvedInitialState = useMemo(() => {
    if (options?.persistKey) {
      const stored = loadFromStorage<T>(options.persistKey);
      if (stored) {
        return stored;
      }
    }
    return initialState;
  }, [initialState, options?.persistKey]);

  const [state, setStateInternal] = useState<T>(resolvedInitialState);
  const previousStateRef = useRef<T>(resolvedInitialState);
  const initialStateRef = useRef<T>(initialState);

  // Сохранение в localStorage при изменении
  useEffect(() => {
    if (options?.persistKey) {
      saveToStorage(options.persistKey, state);
    }
  }, [state, options?.persistKey]);

  // Callback при изменении состояния
  useEffect(() => {
    if (options?.onChange && state !== previousStateRef.current) {
      options.onChange(state, previousStateRef.current);
    }
    previousStateRef.current = state;
  }, [state, options?.onChange]);

  const setState = useCallback((newState: T) => {
    setStateInternal(newState);
  }, []);

  const applyPatch = useCallback((patch: Partial<T>) => {
    setStateInternal((prev) =>
      applyJsonMergePatch(prev as JsonValue, patch as JsonValue) as T
    );
  }, []);

  const reset = useCallback(() => {
    setStateInternal(initialStateRef.current);
  }, []);

  const dispatch = useCallback(
    (command: ViewCommand) => {
      if (options?.onDispatch) {
        options.onDispatch(command);
      }
    },
    [options?.onDispatch]
  );

  const getVariable = useCallback(
    <V = unknown>(path: string): V | undefined => {
      // Сначала ищем в variables, затем в корне
      const fromVariables = getByPath<V>(
        (state as Record<string, unknown>).variables,
        path
      );
      if (fromVariables !== undefined) {
        return fromVariables;
      }
      return getByPath<V>(state, path);
    },
    [state]
  );

  const setVariable = useCallback(
    (path: string, value: unknown) => {
      // Устанавливаем в variables
      setStateInternal((prev) => {
        const variables = (prev as Record<string, unknown>).variables as
          | Record<string, unknown>
          | undefined;

        const newVariables = setByPath(variables || {}, path, value);

        return {
          ...prev,
          variables: newVariables,
        } as T;
      });
    },
    []
  );

  const result = useMemo<StateManagerResult<T>>(
    () => ({
      state,
      setState,
      applyPatch,
      reset,
      dispatch,
      getVariable,
      setVariable,
    }),
    [state, setState, applyPatch, reset, dispatch, getVariable, setVariable]
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component: StateManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * StateManager — React-компонент для управления состоянием игры.
 *
 * Предоставляет методы для чтения, изменения и сброса состояния
 * через render prop и контекст.
 *
 * @example
 * ```tsx
 * <StateManager
 *   initialState={{ score: 0, health: 100 }}
 *   onChange={(state, prev) => console.log('Changed:', state)}
 *   persistKey="my-game-state"
 * >
 *   {({ state, applyPatch }) => (
 *     <div>
 *       <p>Score: {state.score}</p>
 *       <button onClick={() => applyPatch({ score: state.score + 10 })}>
 *         Add 10 points
 *       </button>
 *     </div>
 *   )}
 * </StateManager>
 * ```
 */
export function StateManager<T extends Record<string, unknown> = GameState>({
  initialState,
  children,
  onChange,
  onDispatch,
  persistKey,
}: StateManagerProps<T>): React.ReactElement {
  const result = useStateManager(initialState, {
    onChange,
    onDispatch,
    persistKey,
  });

  return (
    <StateContext.Provider value={result as unknown as StateManagerResult}>
      {children(result)}
    </StateContext.Provider>
  );
}

export default StateManager;
