import { games as staticGames } from "@/data/games";

const SERVER_API_URL =
  process.env.PORTAL_API_URL || process.env.NEXT_PUBLIC_PORTAL_API_URL || "";
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_PORTAL_API_URL || SERVER_API_URL;

function catalogSource() {
  return (process.env.PORTAL_CATALOG_SOURCE || "static").toLowerCase();
}

function staticFallbackEnabled() {
  return process.env.PORTAL_CATALOG_FALLBACK_TO_STATIC === "true";
}

function apiUrl(path) {
  if (!SERVER_API_URL) {
    throw new Error("Portal API URL is not configured");
  }

  return `${SERVER_API_URL.replace(/\/$/, "")}${path}`;
}

function unwrapRecord(record) {
  if (!record?.attributes) {
    return record;
  }

  return {
    id: record.id,
    documentId: record.documentId,
    ...record.attributes,
  };
}

function unwrapMedia(media) {
  const value = media?.data ?? media;

  if (!value) {
    return null;
  }

  return unwrapRecord(value);
}

function unwrapMediaList(media) {
  const value = media?.data ?? media;

  return Array.isArray(value) ? value.map(unwrapRecord) : [];
}

function mediaUrl(media) {
  const url = unwrapMedia(media)?.url;

  if (!url) {
    return "";
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${PUBLIC_API_URL.replace(/\/$/, "")}${url}`;
}

function durationLabel(duration) {
  const labels = {
    d30_min: "30 минут",
    d1_hr: "1 час",
    d2_hr: "2 часа",
    d3_hr: "3 часа",
    d4_hr: "4 часа",
    d5_hr: "5 часов",
    d6_hr: "6 часов",
    d8_hr: "8 часов",
  };

  return labels[duration] || duration || "";
}

function mapStrapiGame(record) {
  const game = unwrapRecord(record);

  return {
    id: game.documentId || game.id,
    documentId: game.documentId,
    title: game.title || "Игра",
    slug: game.slug,
    image: mediaUrl(game.image),
    pricePerLaunch: Number(game.price_per_launch || 0),
    pricePerDay: Number(game.price_per_day || 0),
    pricePerMonth: Number(game.price_per_month || 0),
    description: game.description || "",
    rating: Number(game.rating || 0),
    reviews: Number(game.rating_count || 0),
    genre: game.genre || "",
    format: game.format || "",
    duration: durationLabel(game.duration),
    author: game.author || "",
    gameType: game.game_type,
    images: unwrapMediaList(game.images).map(mediaUrl).filter(Boolean),
  };
}

async function requestStrapi(path) {
  const response = await fetch(apiUrl(path), {
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Strapi catalogue returned ${response.status}`);
  }

  return response.json();
}

async function fetchStrapiGames() {
  const query = new URLSearchParams({
    "filters[is_published][$eq]": "true",
    "populate[0]": "image",
    "populate[1]": "images",
    "pagination[pageSize]": "100",
  });
  const payload = await requestStrapi(`/api/games?${query}`);

  return Array.isArray(payload?.data) ? payload.data.map(mapStrapiGame) : [];
}

async function fetchStrapiGame(slug) {
  const payload = await requestStrapi(`/api/games/${encodeURIComponent(slug)}`);
  return payload?.data ? mapStrapiGame(payload.data) : null;
}

async function withStaticFallback(load, fallbackValue) {
  try {
    return await load();
  } catch (error) {
    if (!staticFallbackEnabled()) {
      throw error;
    }

    console.warn(
      `[catalog] Strapi is unavailable; using static data: ${error.message}`
    );
    return fallbackValue;
  }
}

export async function getCatalogGames() {
  if (catalogSource() === "static") {
    return staticGames;
  }

  return withStaticFallback(fetchStrapiGames, staticGames);
}

export async function getCatalogGame(slug) {
  const staticGame = staticGames.find((game) => game.slug === slug) || null;

  if (catalogSource() === "static") {
    return staticGame;
  }

  return withStaticFallback(() => fetchStrapiGame(slug), staticGame);
}
