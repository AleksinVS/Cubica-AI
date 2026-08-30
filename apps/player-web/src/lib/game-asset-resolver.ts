/**
 * Client-side resolver for ADR-063 game asset indexes.
 *
 * Player-web fetches an index at most once per runtime/game pair. Scenes and
 * manifest components receive stable ids rather than repository file paths;
 * an unknown id fails closed and never becomes a guessed URL.
 */

export interface GameAssetResolver {
  url(assetId: string): string;
  ids(): ReadonlyArray<string>;
}

export interface GameAssetIndex {
  readonly gameId: string;
  readonly assets: Readonly<Record<string, {
    readonly url: string;
    // Images (ADR-063) and game-owned stylesheets (ADR-091) share one asset-id
    // namespace resolved by asset:<id>. The resolver only reads `url`, so the
    // additional `css` kind is purely informational for consumers that care.
    readonly kind: "image" | "css";
  }>>;
}

const resolverCache = new Map<string, Promise<GameAssetResolver>>();
const ASSET_REFERENCE_PATTERN = /^asset:([a-z0-9][a-z0-9-]{0,63})$/u;

export function createGameAssetResolver(
  index: GameAssetIndex,
  runtimeApiUrl: string
): GameAssetResolver {
  const baseUrl = runtimeApiUrl.endsWith("/") ? runtimeApiUrl : `${runtimeApiUrl}/`;
  const urls = new Map(
    Object.entries(index.assets).map(([assetId, entry]) => [
      assetId,
      new URL(entry.url, baseUrl).toString()
    ])
  );
  const ids = [...urls.keys()].sort();

  return Object.freeze({
    url(assetId: string): string {
      const url = urls.get(assetId);
      if (url === undefined) {
        throw new Error(`Game asset "${assetId}" is not available.`);
      }
      return url;
    },
    ids(): ReadonlyArray<string> {
      return ids;
    }
  });
}

export function createEmptyGameAssetResolver(): GameAssetResolver {
  return createGameAssetResolver({ gameId: "", assets: {} }, "http://runtime-api.invalid/");
}

export function loadGameAssetResolver(input: {
  readonly runtimeApiUrl: string;
  readonly gameId: string;
}): Promise<GameAssetResolver> {
  const cacheKey = `${input.runtimeApiUrl}:${input.gameId}`;
  const cached = resolverCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  // The index URL is passed to fetch as a plain string and the call is made
  // inside a promise chain: a missing index — or a fetch that throws
  // synchronously — must fail closed to an empty resolver, never crash the
  // player shell from inside a React effect.
  const indexUrl = new URL(
    `/game-assets/${encodeURIComponent(input.gameId)}/index.json`,
    input.runtimeApiUrl
  ).toString();
  const pending = Promise.resolve()
    .then(() => fetch(indexUrl))
    .then(async (response) => {
      if (!response.ok) {
        return createEmptyGameAssetResolver();
      }
      return createGameAssetResolver(await response.json() as GameAssetIndex, input.runtimeApiUrl);
    })
    .catch(() => createEmptyGameAssetResolver());
  resolverCache.set(cacheKey, pending);
  return pending;
}

/** Resolves one documented image property while preserving ordinary URLs. */
export function resolveGameAssetReference(
  value: string | undefined,
  resolver: GameAssetResolver | null | undefined,
  warn: (message: string) => void = defaultAssetWarning
): string | undefined {
  if (value === undefined || !value.startsWith("asset:")) {
    return value;
  }

  const match = value.match(ASSET_REFERENCE_PATTERN);
  if (match === null || resolver === null || resolver === undefined) {
    warn(`Game asset reference "${value}" could not be resolved.`);
    return undefined;
  }
  try {
    return resolver.url(match[1]);
  } catch {
    warn(`Game asset reference "${value}" is not present in the game asset index.`);
    return undefined;
  }
}

/**
 * Builds the `--game-background-image` CSS custom property from a game
 * plugin's declared theme background (`GameConfigData.themeBackgroundImage`).
 *
 * TSK-20260719 R4b: generalizes the same `asset:<id>` contract already used
 * for UI-manifest image properties (see `resolveGameAssetReference` above) to
 * this one config-level image reference, so a game plugin can opt into the
 * content-addressable asset channel (ADR-063) instead of a baked-in path.
 * Kept here (not in game-player.tsx) so the CSS-variable construction stays a
 * pure, framework-agnostic function that is directly unit-testable without
 * rendering a React tree.
 *
 * Returns `undefined` when there is no configured background, or when an
 * `asset:` reference cannot be resolved yet (fail closed — never a broken
 * `url()`); shared layouts already treat a missing custom property as "no
 * image" via their `var(--game-background-image, none)` fallback.
 */
export function resolveThemeBackgroundStyle(
  themeBackgroundImage: string | undefined,
  resolver: GameAssetResolver | null | undefined,
  warn: (message: string) => void = defaultAssetWarning
): Readonly<Record<string, string>> | undefined {
  const resolvedUrl = resolveGameAssetReference(themeBackgroundImage, resolver, warn);
  return resolvedUrl === undefined
    ? undefined
    : { "--game-background-image": `url(${JSON.stringify(resolvedUrl)})` };
}

/** True when a UI projection needs the optional asset index request. */
export function uiUsesGameAssets(value: unknown): boolean {
  if (typeof value === "string") {
    return value.startsWith("asset:");
  }
  if (Array.isArray(value)) {
    return value.some(uiUsesGameAssets);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "interactiveBoardSurface") {
      return true;
    }
    return Object.values(record).some(uiUsesGameAssets);
  }
  return false;
}

/** Test-only cache reset; production content-addressed indexes remain cached. */
export function clearGameAssetResolverCache(): void {
  resolverCache.clear();
}

function defaultAssetWarning(message: string): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}
