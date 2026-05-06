import type { FallbackMetricSpec } from "./game-config";
import type { GameConfigData } from "./game-config";

/**
 * Сериализуемые данные конфигурации Антарктиды.
 * Содержит только JSON-совместимые значения — можно безопасно
 * передать через границу Server → Client Component в Next.js.
 *
 * Функциональные резолверы регистрируются отдельно
 * в plugins/antarctica/register.ts и объединяются
 * с данными через buildGameConfig() на клиентской стороне.
 */
export const ANTARCTICA_GAME_CONFIG_DATA: GameConfigData = {
  gameId: "antarctica",
  playerId: "player-web",
  storageKey: "cubica-antarctica-session-id",

  fallbackMetrics: [
    { id: "score", caption: "Остаток дней", aliases: ["score", "days", "time"], sidebarImage: "/images/left-sidebar/days.png", topbarImage: "/images/top-sidebar/days-top.png" },
    { id: "pro", caption: "Знания", aliases: ["pro", "knowledge"], sidebarImage: "/images/left-sidebar/znania.png", topbarImage: "/images/top-sidebar/znaniya.png" },
    { id: "rep", caption: "Доверие", aliases: ["rep", "trust"], sidebarImage: "/images/left-sidebar/doverie.png", topbarImage: "/images/top-sidebar/doverie.png" },
    { id: "energy", caption: "Энергия", aliases: ["energy", "lid"], sidebarImage: "/images/left-sidebar/energia.png", topbarImage: "/images/top-sidebar/energia.png" },
    { id: "control", caption: "Контроль", aliases: ["control", "man"], sidebarImage: "/images/left-sidebar/kontrol.png", topbarImage: "/images/top-sidebar/kontrol.png" },
    { id: "status", caption: "Статус", aliases: ["status", "stat"], sidebarImage: "/images/left-sidebar/status.png", topbarImage: "/images/top-sidebar/status.png" },
    { id: "contact", caption: "Контакт", aliases: ["contact", "cont"], sidebarImage: "/images/left-sidebar/kontakt.png", topbarImage: "/images/top-sidebar/kontakt.png" },
    { id: "constructive", caption: "Конструктив", aliases: ["constructive", "constr"], sidebarImage: "/images/left-sidebar/konstruktiv.png", topbarImage: "/images/top-sidebar/konstruktiv.png" }
  ] satisfies ReadonlyArray<FallbackMetricSpec>,

  topbarScreenKeys: [
    "55..60",
    "61..66",
    "67..68",
    "69..70"
  ],

  metricBackgroundImages: {
    score: "/images/top-sidebar/days-top.png",
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