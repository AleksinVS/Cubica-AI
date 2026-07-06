/**
 * Locale strings for game UI text (framework-free).
 *
 * This module only exports the locale data and its types so that the
 * lib/ layer stays inside the future player-core seam (ADR-064: no
 * React/Next imports in presenter/ and lib/). The React context and the
 * useLocale hook live in the components layer:
 * apps/player-web/src/components/locale-context.ts.
 *
 * Manifest-driven screens carry their own text (via component props),
 * so these strings only affect convention-based fallback rendering
 * and panel labels.
 */

export { ru } from "./ru";
export type { LocaleStrings, LocaleKey } from "./ru";
