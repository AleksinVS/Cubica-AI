/**
 * Serializable player configuration for Antarctica.
 *
 * The data contains only JSON-compatible values, so Next.js can pass it through
 * the Server Component to Client Component boundary. Functional resolvers are
 * registered separately through the plugin API.
 */

import type { FallbackMetricSpec, GameConfigData } from "@cubica/player-web/plugin-api";

/**
 * TSK-20260719 R7 (ARC-008): metric captions, aliases and images now live in
 * the game manifest (`games/antarctica/authoring/ui/web.authoring.json`
 * `metric_specs`, compiled into `ui.manifest.json`), not in this file. The
 * manifest is the single source of truth; this file only carries the
 * unavoidable minimum described below.
 *
 * Why a minimum still exists here, instead of zero:
 * - `PlayerPluginApi.registerGameConfigData()` (see
 *   `apps/player-web/src/plugins/player-plugin-api.ts`) receives a plain,
 *   pre-built `GameConfigData` object at plugin activation time. `activate()`
 *   has no access to `PlayerFacingContent`/the compiled manifest, so this
 *   module cannot derive `fallbackMetrics` from `metric_specs` at runtime.
 * - Once registered, `resolveRegisteredGameConfigData()` (see
 *   `apps/player-web/src/presenter/game-config-registry.ts`) *replaces* the
 *   manifest-derived server default wholesale — it does not merge field by
 *   field. So whatever this file omits is simply absent, not backfilled from
 *   the manifest.
 * - The plugin bundler (`scripts/manifest-tools/build-player-web-plugin-bundles.cjs`)
 *   only allows imports from inside the plugin's own root, so this file
 *   cannot import the compiled `ui.manifest.json` to read `metric_specs` back
 *   out at build time either.
 * - `SafeModeRenderer` (`apps/player-web/src/components/safe-mode-renderer.tsx`)
 *   is the one remaining real consumer: it is the generic fallback path used
 *   when the manifest does not describe the current screen, and it renders
 *   metric badges strictly from this array (see R4b finding). Without a
 *   caption here, a safe-mode screen would show zero metric badges instead of
 *   a degraded-but-labeled one.
 *
 * What was cut to reach this minimum:
 * - `sidebarImage`/`topbarImage` are left empty. The normal (non-safe-mode)
 *   path no longer needs them: every `gameVariableComponent` in the manifest
 *   already carries its own `asset:<id>` `backgroundImage` prop (migrated in
 *   R4b), and `resolveMetricBackgroundImage()` only consults this
 *   `metricBackgroundImages` dictionary as a topbar override — with the
 *   dictionary empty, it falls through to the manifest's own value. Safe-mode
 *   badges lose their icon but keep their caption/value, which is an
 *   acceptable degradation for a rarely-hit safety net.
 * - `metricBackgroundImages` is now empty for the same reason: the topbar
 *   override it used to provide is exactly what the manifest's per-component
 *   `asset:<id>` background images already supply.
 */
export const ANTARCTICA_GAME_CONFIG_DATA: GameConfigData = {
  gameId: "antarctica",
  storageKey: "cubica-antarctica-session-id",
  // TSK-20260719 R4b: resolved through the game asset channel (ADR-063) by
  // the platform's resolveThemeBackgroundStyle, not a baked-in path.
  themeBackgroundImage: "asset:arctic-background",

  // Kept in sync by hand with `metric_specs` captions/aliases in
  // games/antarctica/authoring/ui/web.authoring.json (see module comment
  // above for why this cannot be derived automatically).
  fallbackMetrics: [
    { id: "remainingDays", caption: "Остаток дней", aliases: ["remainingDays", "days"], sidebarImage: "", topbarImage: "" },
    { id: "pro", caption: "Знания", aliases: ["pro", "knowledge"], sidebarImage: "", topbarImage: "" },
    { id: "rep", caption: "Доверие", aliases: ["rep", "trust"], sidebarImage: "", topbarImage: "" },
    { id: "lid", caption: "Энергия", aliases: ["lid", "energy"], sidebarImage: "", topbarImage: "" },
    { id: "man", caption: "Контроль", aliases: ["man", "control"], sidebarImage: "", topbarImage: "" },
    { id: "stat", caption: "Статус", aliases: ["stat", "status"], sidebarImage: "", topbarImage: "" },
    { id: "cont", caption: "Контакт", aliases: ["cont", "contact"], sidebarImage: "", topbarImage: "" },
    { id: "constr", caption: "Конструктив", aliases: ["constr", "constructive"], sidebarImage: "", topbarImage: "" }
  ] satisfies ReadonlyArray<FallbackMetricSpec>,

  topbarScreenKeys: [
    "board-topbar",
    "info-topbar"
  ],

  // TSK-20260719 R7: emptied — the topbar override this dictionary used to
  // provide is redundant now that every gameVariableComponent in the
  // manifest declares its own asset:<id> backgroundImage directly (R4b).
  metricBackgroundImages: {}
};
