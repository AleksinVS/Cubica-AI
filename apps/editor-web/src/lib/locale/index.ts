/**
 * Editor chrome locale entry point (framework-free).
 *
 * Re-exports the Russian chrome strings and their type. Components import the
 * strings directly as `t`:
 *
 *   import { editorRu as t } from "@/lib/locale";
 *   <button>{t.toolbar.save}</button>
 *
 * The editor is single-locale (Russian) by owner decision 2026-07-08
 * (TSK-20260708); adding another locale later means adding a sibling file and a
 * selector, without touching component call sites.
 */

export { editorRu } from "./ru";
export type { EditorStrings } from "./ru";
