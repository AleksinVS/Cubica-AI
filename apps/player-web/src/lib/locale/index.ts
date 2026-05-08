/**
 * Locale context for game UI strings.
 *
 * Provides localized strings via React context so components
 * can display user-facing text without hardcoded string literals.
 * Manifest-driven screens carry their own text (via component props),
 * so this context only affects convention-based fallback rendering
 * and panel labels.
 *
 * Usage:
 *   import { useLocale } from "@/lib/locale";
 *   const t = useLocale();
 *   <span>{t.continue}</span>
 */

import { createContext, useContext } from "react";
import { ru, type LocaleStrings, type LocaleKey } from "./ru";

const LocaleContext = createContext<LocaleStrings>(ru);

/**
 * Provider that makes locale strings available to child components.
 * Defaults to Russian. Pass a different locale object for other languages.
 */
export const LocaleProvider = LocaleContext.Provider;

/**
 * Hook to access the current locale strings.
 * Returns the locale object with all user-facing text keys.
 */
export function useLocale(): LocaleStrings {
  return useContext(LocaleContext);
}

export { ru };
export type { LocaleStrings, LocaleKey };