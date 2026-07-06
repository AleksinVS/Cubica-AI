/**
 * React adapter for locale strings.
 *
 * Provides localized strings via React context so components can display
 * user-facing text without hardcoded string literals. The strings themselves
 * are framework-free and live in @/lib/locale (inside the player-core seam,
 * ADR-064); this file is the React-specific edge of that data.
 *
 * Usage:
 *   import { useLocale } from "@/components/locale-context";
 *   const t = useLocale();
 *   <span>{t.continue}</span>
 */

import { createContext, useContext } from "react";
import { ru, type LocaleStrings } from "@/lib/locale";

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
