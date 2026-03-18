'use client';

/**
 * @fileoverview ActionRouter — компонент для маршрутизации и обработки действий.
 *
 * ActionRouter отвечает за:
 * - Приём действий от UI-компонентов (ViewAction)
 * - Маршрутизацию действий к соответствующим обработчикам
 * - Выполнение встроенных команд (navigate, updateState, playEffect)
 * - Делегирование внешних команд на Router/Engine
 *
 * Действие (ViewAction) — это команда, описанная в UI manifest,
 * которая выполняется при взаимодействии пользователя с интерфейсом.
 *
 * @example
 * ```tsx
 * <ActionRouter
 *   state={gameState}
 *   onNavigate={(sceneId) => console.log('Navigate to:', sceneId)}
 *   onStateChange={(patch) => applyPatch(patch)}
 * >
 *   {({ dispatchAction }) => (
 *     <GameButton onClick={() => dispatchAction({ command: 'navigate', payload: { scene: 'level2' } })}>
 *       Next Level
 *     </GameButton>
 *   )}
 * </ActionRouter>
 * ```
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import type {
  ViewAction,
  ActionContext,
  ActionResult,
  ActionHandler,
  ActionHandlerRegistry,
  GameState,
  ViewCommand,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types (Типы)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Результат работы ActionRouter, передаваемый в render prop.
 */
export interface ActionRouterResult {
  /** Отправить действие на обработку */
  dispatchAction: (action: ViewAction, context?: Partial<ActionContext>) => Promise<ActionResult>;

  /** Зарегистрировать обработчик для команды */
  registerHandler: (command: string, handler: ActionHandler) => void;

  /** Удалить обработчик команды */
  unregisterHandler: (command: string) => void;

  /** Проверить, есть ли обработчик для команды */
  hasHandler: (command: string) => boolean;
}

/**
 * Props для компонента ActionRouter.
 */
export interface ActionRouterProps {
  /** Текущее состояние игры (для передачи в контекст обработчиков) */
  state?: GameState;

  /** Render prop для рендеринга содержимого */
  children: (result: ActionRouterResult) => ReactNode;

  /** Callback при навигации между сценами */
  onNavigate?: (sceneId: string) => void;

  /** Callback при изменении состояния */
  onStateChange?: (patch: Record<string, unknown>) => void;

  /** Callback при отправке команды на Router */
  onSendCommand?: (command: ViewCommand) => Promise<void>;

  /** Callback при ошибке выполнения действия */
  onError?: (error: string, action: ViewAction) => void;

  /** Пользовательские обработчики команд */
  customHandlers?: Record<string, ActionHandler>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context (Контекст для доступа к ActionRouter в дочерних компонентах)
// ─────────────────────────────────────────────────────────────────────────────

const ActionRouterContext = createContext<ActionRouterResult | null>(null);

/**
 * Hook для получения ActionRouter из контекста.
 *
 * @throws Ошибка если используется вне ActionRouter.
 */
export function useActionRouterContext(): ActionRouterResult {
  const context = useContext(ActionRouterContext);
  if (!context) {
    throw new Error(
      'useActionRouterContext must be used within an ActionRouter. ' +
      'Wrap your component tree with <ActionRouter> first.'
    );
  }
  return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in Action Handlers (Встроенные обработчики действий)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Встроенные команды, обрабатываемые ActionRouter:
 *
 * - navigate: переход между сценами
 * - updateState: обновление состояния игры
 * - setVariable: установка значения переменной
 * - playEffect: воспроизведение эффекта (звук, анимация)
 * - sendCommand: отправка команды на Router/Engine
 * - noop: пустое действие (для отладки)
 */
const BUILTIN_COMMANDS = [
  'navigate',
  'updateState',
  'setVariable',
  'playEffect',
  'sendCommand',
  'noop',
] as const;

type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number];

/**
 * Проверить, является ли команда встроенной.
 */
function isBuiltinCommand(command: string): command is BuiltinCommand {
  return BUILTIN_COMMANDS.includes(command as BuiltinCommand);
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: createActionRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Опции для создания ActionRouter.
 */
export interface CreateActionRouterOptions {
  /** Callback при навигации */
  onNavigate?: (sceneId: string) => void;

  /** Callback при изменении состояния */
  onStateChange?: (patch: Record<string, unknown>) => void;

  /** Callback при отправке команды */
  onSendCommand?: (command: ViewCommand) => Promise<void>;

  /** Callback при ошибке */
  onError?: (error: string, action: ViewAction) => void;

  /** Функция получения текущего состояния */
  getState?: () => GameState | undefined;
}

/**
 * Создать экземпляр ActionRouter для использования вне React.
 *
 * @param options - Опции создания
 * @returns Интерфейс ActionRouter
 *
 * @example
 * ```ts
 * const router = createActionRouter({
 *   onNavigate: (sceneId) => console.log('Navigate to:', sceneId),
 *   onStateChange: (patch) => stateManager.applyPatch(patch),
 * });
 *
 * router.registerHandler('customAction', async (action, ctx) => {
 *   console.log('Custom action:', action);
 *   return { success: true };
 * });
 *
 * await router.dispatchAction({ command: 'navigate', payload: { scene: 'menu' } });
 * ```
 */
export function createActionRouter(
  options: CreateActionRouterOptions = {}
): ActionRouterResult {
  const handlers: ActionHandlerRegistry = new Map();

  /**
   * Обработать встроенную команду.
   */
  const handleBuiltinCommand = async (
    action: ViewAction,
    context: ActionContext
  ): Promise<ActionResult> => {
    const { command, payload = {} } = action;

    switch (command as BuiltinCommand) {
      case 'navigate': {
        const sceneId = payload.scene as string | undefined;
        if (!sceneId) {
          return {
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Missing scene in navigate payload' },
          };
        }
        if (options.onNavigate) {
          options.onNavigate(sceneId);
        }
        return { success: true, nextScene: sceneId };
      }

      case 'updateState': {
        const patch = payload.patch as Record<string, unknown> | undefined;
        if (!patch) {
          return {
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Missing patch in updateState payload' },
          };
        }
        if (options.onStateChange) {
          options.onStateChange(patch);
        }
        return { success: true, statePatch: patch };
      }

      case 'setVariable': {
        const { name, value } = payload as { name?: string; value?: unknown };
        if (!name) {
          return {
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Missing name in setVariable payload' },
          };
        }
        if (options.onStateChange) {
          options.onStateChange({ variables: { [name]: value } });
        }
        return { success: true, statePatch: { variables: { [name]: value } } };
      }

      case 'playEffect': {
        // Эффекты обрабатываются на уровне View, здесь просто подтверждаем
        const effectType = payload.type as string | undefined;
        console.debug(`[ActionRouter] Play effect: ${effectType}`, payload);
        return { success: true };
      }

      case 'sendCommand': {
        const cmd = payload.command as ViewCommand | undefined;
        if (!cmd) {
          return {
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Missing command in sendCommand payload' },
          };
        }
        if (options.onSendCommand) {
          await options.onSendCommand(cmd);
        }
        return { success: true, command: cmd };
      }

      case 'noop':
        return { success: true };

      default:
        return {
          success: false,
          error: { code: 'UNKNOWN_COMMAND', message: `Unknown builtin command: ${command}` },
        };
    }
  };

  /**
   * Основная функция диспетчеризации действий.
   */
  const dispatchAction = async (
    action: ViewAction,
    partialContext?: Partial<ActionContext>
  ): Promise<ActionResult> => {
    const { command } = action;

    if (!command) {
      return {
        success: false,
        error: { code: 'INVALID_ACTION', message: 'Action must have a command' },
      };
    }

    // Формирование полного контекста
    const context: ActionContext = {
      gameState: options.getState?.(),
      ...partialContext,
    };

    try {
      // Проверка пользовательского обработчика
      if (handlers.has(command)) {
        const handler = handlers.get(command)!;
        return await handler(action, context);
      }

      // Проверка встроенной команды
      if (isBuiltinCommand(command)) {
        return await handleBuiltinCommand(action, context);
      }

      // Неизвестная команда — отправляем на Router
      if (options.onSendCommand) {
        const viewCommand: ViewCommand = {
          type: command,
          payload: action.payload || {},
        };
        await options.onSendCommand(viewCommand);
        return { success: true, command: viewCommand };
      }

      return {
        success: false,
        error: { code: 'NO_HANDLER', message: `No handler registered for command: ${command}` },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (options.onError) {
        options.onError(errorMessage, action);
      }
      return {
        success: false,
        error: { code: 'EXECUTION_ERROR', message: errorMessage },
      };
    }
  };

  const registerHandler = (command: string, handler: ActionHandler) => {
    handlers.set(command, handler);
  };

  const unregisterHandler = (command: string) => {
    handlers.delete(command);
  };

  const hasHandler = (command: string) => {
    return handlers.has(command) || isBuiltinCommand(command);
  };

  return {
    dispatchAction,
    registerHandler,
    unregisterHandler,
    hasHandler,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useActionRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook для создания ActionRouter с React-интеграцией.
 *
 * @param options - Опции ActionRouter
 * @returns Интерфейс ActionRouter
 */
export function useActionRouter(
  options: CreateActionRouterOptions & {
    customHandlers?: Record<string, ActionHandler>;
  } = {}
): ActionRouterResult {
  const { customHandlers, ...routerOptions } = options;

  // Стабильная ссылка на роутер
  const routerRef = useRef<ActionRouterResult | null>(null);

  if (!routerRef.current) {
    routerRef.current = createActionRouter(routerOptions);
  }

  // Регистрация пользовательских обработчиков
  useMemo(() => {
    if (customHandlers && routerRef.current) {
      for (const [command, handler] of Object.entries(customHandlers)) {
        routerRef.current.registerHandler(command, handler);
      }
    }
  }, [customHandlers]);

  return routerRef.current;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component: ActionRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ActionRouter — React-компонент для маршрутизации действий.
 *
 * Предоставляет метод dispatchAction для обработки ViewAction
 * и позволяет регистрировать пользовательские обработчики.
 *
 * @example
 * ```tsx
 * <ActionRouter
 *   state={gameState}
 *   onNavigate={(sceneId) => setCurrentScene(sceneId)}
 *   onStateChange={(patch) => applyPatch(patch)}
 *   customHandlers={{
 *     showDialog: async (action) => {
 *       await showModal(action.payload);
 *       return { success: true };
 *     }
 *   }}
 * >
 *   {({ dispatchAction }) => (
 *     <button onClick={() => dispatchAction({ command: 'showDialog', payload: { text: 'Hello!' } })}>
 *       Show Dialog
 *     </button>
 *   )}
 * </ActionRouter>
 * ```
 */
export function ActionRouter({
  state,
  children,
  onNavigate,
  onStateChange,
  onSendCommand,
  onError,
  customHandlers,
}: ActionRouterProps): React.ReactElement {
  // Функция получения текущего состояния
  const getState = useCallback(() => state, [state]);

  const result = useActionRouter({
    onNavigate,
    onStateChange,
    onSendCommand,
    onError,
    getState,
    customHandlers,
  });

  return (
    <ActionRouterContext.Provider value={result}>
      {children(result)}
    </ActionRouterContext.Provider>
  );
}

export default ActionRouter;
