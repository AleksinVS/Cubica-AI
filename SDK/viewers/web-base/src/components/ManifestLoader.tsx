'use client';

/**
 * @fileoverview ManifestLoader — компонент для загрузки игровых манифестов.
 *
 * ManifestLoader отвечает за:
 * - Загрузку GameManifest (манифест игры — описание логики и метаданных)
 * - Загрузку UIManifest (UI манифест — описание пользовательского интерфейса)
 * - Кеширование загруженных манифестов
 * - Обработку ошибок загрузки
 *
 * @example
 * ```tsx
 * <ManifestLoader config={{ gameManifestUrl: '/games/my-game/manifest.json' }}>
 *   {({ gameManifest, uiManifest, status }) => (
 *     status === 'ready' ? <GameRenderer manifest={gameManifest} /> : <Loading />
 *   )}
 * </ManifestLoader>
 * ```
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

import type {
  GameManifest,
  UIManifest,
  ViewerConfig,
  ManifestLoadResult,
  ManifestLoaderOptions,
} from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Types (Типы)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Статус загрузки манифестов.
 */
export type ManifestLoaderStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Результат работы ManifestLoader, передаваемый в render prop.
 */
export interface ManifestLoaderResult {
  /** Загруженный game manifest */
  gameManifest: GameManifest | null;

  /** Загруженный UI manifest */
  uiManifest: UIManifest | null;

  /** Текущий статус загрузки */
  status: ManifestLoaderStatus;

  /** Ошибка загрузки (если есть) */
  error: string | null;

  /** Перезагрузить манифесты */
  reload: () => Promise<void>;
}

/**
 * Props для компонента ManifestLoader.
 */
export interface ManifestLoaderProps {
  /** Конфигурация viewer с путями к манифестам */
  config: ViewerConfig;

  /** Дополнительные опции загрузки */
  options?: ManifestLoaderOptions;

  /** Render prop для рендеринга содержимого */
  children: (result: ManifestLoaderResult) => ReactNode;

  /** Callback при успешной загрузке */
  onLoad?: (gameManifest: GameManifest, uiManifest: UIManifest | null) => void;

  /** Callback при ошибке */
  onError?: (error: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context (Контекст для доступа к манифестам в дочерних компонентах)
// ─────────────────────────────────────────────────────────────────────────────

const ManifestContext = createContext<ManifestLoaderResult | null>(null);

/**
 * Hook для получения загруженных манифестов из контекста.
 *
 * @throws Ошибка если используется вне ManifestLoader.
 */
export function useManifestContext(): ManifestLoaderResult {
  const context = useContext(ManifestContext);
  if (!context) {
    throw new Error(
      'useManifestContext must be used within a ManifestLoader. ' +
      'Wrap your component tree with <ManifestLoader> first.'
    );
  }
  return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities (Утилиты для загрузки)
// ─────────────────────────────────────────────────────────────────────────────

/** Простой кеш для манифестов */
const manifestCache = new Map<string, unknown>();

/**
 * Загрузить JSON по URL с обработкой ошибок.
 *
 * @param url - URL для загрузки
 * @param options - Опции загрузки
 * @returns Результат загрузки
 */
async function fetchManifest<T>(
  url: string,
  options?: ManifestLoaderOptions
): Promise<ManifestLoadResult<T>> {
  // Проверка кеша
  const cacheKey = url;
  if (options?.useCache && manifestCache.has(cacheKey)) {
    return {
      success: true,
      data: manifestCache.get(cacheKey) as T,
      source: 'cache',
    };
  }

  try {
    // Формирование полного URL
    const fullUrl = options?.baseUrl
      ? new URL(url, options.baseUrl).href
      : url;

    // Создание AbortController для таймаута
    const controller = new AbortController();
    const timeoutId = options?.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;

    const response = await fetch(fullUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      return {
        success: false,
        error: {
          code: `HTTP_${response.status}`,
          message: `Failed to fetch manifest: ${response.statusText}`,
        },
      };
    }

    const data = (await response.json()) as T;

    // Валидация если предоставлена функция
    if (options?.validate && !options.validate(data)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Manifest validation failed',
        },
      };
    }

    // Сохранение в кеш
    if (options?.useCache) {
      manifestCache.set(cacheKey, data);
    }

    return {
      success: true,
      data,
      source: 'url',
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Request timeout'
          : error.message
        : 'Unknown error occurred';

    return {
      success: false,
      error: {
        code: 'FETCH_ERROR',
        message,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook: useManifestLoader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook для загрузки манифестов.
 *
 * Позволяет использовать логику ManifestLoader без React-компонента.
 *
 * @param config - Конфигурация viewer
 * @param options - Опции загрузки
 * @returns Результат загрузки манифестов
 */
export function useManifestLoader(
  config: ViewerConfig,
  options?: ManifestLoaderOptions
): ManifestLoaderResult {
  const [gameManifest, setGameManifest] = useState<GameManifest | null>(null);
  const [uiManifest, setUIManifest] = useState<UIManifest | null>(null);
  const [status, setStatus] = useState<ManifestLoaderStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  /**
   * Основная функция загрузки манифестов.
   */
  const loadManifests = useCallback(async () => {
    setStatus('loading');
    setError(null);

    try {
      // Загрузка GameManifest
      let loadedGameManifest: GameManifest | null = null;

      if (config.gameManifest) {
        // Использовать inline манифест
        loadedGameManifest = config.gameManifest;
      } else if (config.gameManifestUrl) {
        // Загрузить по URL
        const result = await fetchManifest<GameManifest>(
          config.gameManifestUrl,
          options
        );
        if (!result.success) {
          throw new Error(result.error?.message || 'Failed to load game manifest');
        }
        loadedGameManifest = result.data!;
      }

      if (!loadedGameManifest) {
        throw new Error(
          'No game manifest provided. Set either gameManifest or gameManifestUrl in config.'
        );
      }

      // Загрузка UIManifest
      let loadedUIManifest: UIManifest | null = null;

      if (config.uiManifest) {
        // Использовать inline манифест
        loadedUIManifest = config.uiManifest;
      } else if (config.uiManifestUrl) {
        // Загрузить по URL
        const result = await fetchManifest<UIManifest>(
          config.uiManifestUrl,
          options
        );
        if (result.success) {
          loadedUIManifest = result.data!;
        }
        // UI манифест не обязателен, поэтому не бросаем ошибку
      }

      setGameManifest(loadedGameManifest);
      setUIManifest(loadedUIManifest);
      setStatus('ready');
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      setStatus('error');
    }
  }, [config, options]);

  // Загрузка при монтировании и изменении конфигурации
  useEffect(() => {
    loadManifests();
  }, [loadManifests]);

  // Мемоизация результата
  const result = useMemo<ManifestLoaderResult>(
    () => ({
      gameManifest,
      uiManifest,
      status,
      error,
      reload: loadManifests,
    }),
    [gameManifest, uiManifest, status, error, loadManifests]
  );

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component: ManifestLoader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ManifestLoader — React-компонент для загрузки игровых манифестов.
 *
 * Загружает GameManifest и UIManifest, предоставляет их через render prop
 * и контекст для дочерних компонентов.
 *
 * @example
 * ```tsx
 * <ManifestLoader
 *   config={{ gameManifestUrl: '/api/games/my-game/manifest' }}
 *   onLoad={(game, ui) => console.log('Loaded:', game.meta.title)}
 *   onError={(err) => console.error('Error:', err)}
 * >
 *   {({ gameManifest, uiManifest, status }) => {
 *     if (status === 'loading') return <LoadingSpinner />;
 *     if (status === 'error') return <ErrorMessage />;
 *     return <GameView manifest={gameManifest} />;
 *   }}
 * </ManifestLoader>
 * ```
 */
export function ManifestLoader({
  config,
  options,
  children,
  onLoad,
  onError,
}: ManifestLoaderProps): React.ReactElement {
  const result = useManifestLoader(config, options);

  // Вызов callbacks при изменении статуса
  useEffect(() => {
    if (result.status === 'ready' && result.gameManifest && onLoad) {
      onLoad(result.gameManifest, result.uiManifest);
    }
  }, [result.status, result.gameManifest, result.uiManifest, onLoad]);

  useEffect(() => {
    if (result.status === 'error' && result.error && onError) {
      onError(result.error);
    }
  }, [result.status, result.error, onError]);

  return (
    <ManifestContext.Provider value={result}>
      {children(result)}
    </ManifestContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities export (Экспорт утилит)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Очистить кеш манифестов.
 * Полезно для принудительной перезагрузки.
 */
export function clearManifestCache(): void {
  manifestCache.clear();
}

/**
 * Удалить конкретный манифест из кеша.
 *
 * @param url - URL манифеста для удаления
 */
export function invalidateManifest(url: string): void {
  manifestCache.delete(url);
}

export default ManifestLoader;
