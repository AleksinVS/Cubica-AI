/**
 * Game-agnostic injection of game-owned stylesheets (ADR-091).
 *
 * A game's UI manifest may declare a top-level `stylesheets` array of
 * `asset:<id>` references. This helper resolves each reference through the same
 * game asset index used for images (game-asset-resolver) and injects one
 * `<link rel="stylesheet">` per resolved URL into `<head>`.
 *
 * Design rules (ADR-091 / ADR-055 renderer purity):
 * - The player renderer never hardcodes a game id; it only applies whatever the
 *   manifest declares.
 * - Links are appended at the END of `<head>`, i.e. AFTER platform styles, so a
 *   game stylesheet can override platform values without `!important`.
 * - Fail closed: an unknown id (or a null resolver) injects nothing for that
 *   reference and logs a warning; it never throws and never guesses a URL.
 * - The returned disposer removes exactly the links this call created, so a
 *   React effect can inject on mount and remove on unmount/reload.
 */

import { resolveGameAssetReference, type GameAssetResolver } from "@/lib/game-asset-resolver";

/**
 * Marker attribute stamped on every injected link. Lets tests (and defensive
 * cleanup) find exactly the elements this module owns without touching platform
 * stylesheet links.
 */
export const GAME_STYLESHEET_LINK_ATTRIBUTE = "data-cubica-game-stylesheet";

export interface ApplyGameStylesheetLinksInput {
  /** `asset:<id>` references declared by the UI manifest. */
  readonly references: readonly string[];
  /** Resolves `asset:<id>` to a content-addressable URL; null until loaded. */
  readonly resolver: GameAssetResolver | null | undefined;
  /** Test seam. Defaults to the ambient `document`. */
  readonly doc?: Document;
  /** Test seam. Defaults to a dev-only console warning. */
  readonly warn?: (message: string) => void;
}

/**
 * Injects the resolved stylesheet links and returns a disposer that removes
 * them. In a non-DOM environment (or without a `<head>`) it is a safe no-op.
 */
export function applyGameStylesheetLinks(input: ApplyGameStylesheetLinksInput): () => void {
  const doc = input.doc ?? (typeof document !== "undefined" ? document : undefined);
  const warn = input.warn ?? defaultStylesheetWarning;
  const head = doc?.head ?? doc?.getElementsByTagName("head")[0];
  if (doc === undefined || head === undefined || head === null) {
    return () => {};
  }

  const created: HTMLLinkElement[] = [];
  for (const reference of input.references) {
    if (typeof reference !== "string" || !reference.startsWith("asset:")) {
      warn(`Game stylesheet reference "${String(reference)}" must use the asset:<id> form.`);
      continue;
    }

    // Reuse the image resolver's fail-closed contract: unknown id or missing
    // resolver returns undefined (and warns), so nothing is injected for it.
    const url = resolveGameAssetReference(reference, input.resolver, warn);
    if (url === undefined) {
      continue;
    }

    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.setAttribute(GAME_STYLESHEET_LINK_ATTRIBUTE, reference);
    head.appendChild(link);
    created.push(link);
  }

  return () => {
    for (const link of created) {
      link.parentNode?.removeChild(link);
    }
  };
}

function defaultStylesheetWarning(message: string): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}
