/**
 * Serializable player configuration for Antarctica.
 *
 * The data contains only JSON-compatible values, so Next.js can pass it through
 * the Server Component to Client Component boundary. Functional resolvers are
 * registered separately through the plugin API.
 */

import type { FallbackMetricSpec, GameConfigData } from "@cubica/player-web/plugin-api";

export const ANTARCTICA_GAME_CONFIG_DATA: GameConfigData = {
  gameId: "antarctica",
  playerId: "player-web",
  storageKey: "cubica-antarctica-session-id",
  themeBackgroundImage: "/images/arctic-background.png",

  fallbackMetrics: [
    { id: "remainingDays", caption: "Осталось дней", aliases: ["remainingDays", "days"], sidebarImage: "/images/left-sidebar/days.png", topbarImage: "/images/top-sidebar/days-top.png" },
    { id: "pro", caption: "Знания", aliases: ["pro", "knowledge"], sidebarImage: "/images/left-sidebar/znania.png", topbarImage: "/images/top-sidebar/znaniya.png" },
    { id: "rep", caption: "Доверие", aliases: ["rep", "trust"], sidebarImage: "/images/left-sidebar/doverie.png", topbarImage: "/images/top-sidebar/doverie.png" },
    { id: "lid", caption: "Энергия", aliases: ["lid", "energy"], sidebarImage: "/images/left-sidebar/energia.png", topbarImage: "/images/top-sidebar/energia.png" },
    { id: "man", caption: "Контроль", aliases: ["man", "control"], sidebarImage: "/images/left-sidebar/kontrol.png", topbarImage: "/images/top-sidebar/kontrol.png" },
    { id: "stat", caption: "Статус", aliases: ["stat", "status"], sidebarImage: "/images/left-sidebar/status.png", topbarImage: "/images/top-sidebar/status.png" },
    { id: "cont", caption: "Контакт", aliases: ["cont", "contact"], sidebarImage: "/images/left-sidebar/kontakt.png", topbarImage: "/images/top-sidebar/kontakt.png" },
    { id: "constr", caption: "Конструктив", aliases: ["constr", "constructive"], sidebarImage: "/images/left-sidebar/konstruktiv.png", topbarImage: "/images/top-sidebar/konstruktiv.png" }
  ] satisfies ReadonlyArray<FallbackMetricSpec>,

  topbarScreenKeys: [
    "board-topbar",
    "info-topbar"
  ],

  metricBackgroundImages: {
    remainingDays: "/images/top-sidebar/days-top.png",
    pro: "/images/top-sidebar/znaniya.png",
    rep: "/images/top-sidebar/doverie.png",
    energy: "/images/top-sidebar/energia.png",
    lid: "/images/top-sidebar/energia.png",
    control: "/images/top-sidebar/kontrol.png",
    man: "/images/top-sidebar/kontrol.png",
    status: "/images/top-sidebar/status.png",
    stat: "/images/top-sidebar/status.png",
    contact: "/images/top-sidebar/kontakt.png",
    cont: "/images/top-sidebar/kontakt.png",
    constructive: "/images/top-sidebar/konstruktiv.png",
    constr: "/images/top-sidebar/konstruktiv.png"
  }
};
