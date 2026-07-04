import { appendClassName } from "@/lib/classname-utils";

/**
 * Дополняет CSS-класс area-контейнера классами для topbar-режима.
 */
export function resolveAreaCssClass(
  cssClass: string | undefined,
  _screenKey?: string,
  layoutMode?: "leftsidebar" | "topbar"
): string {
  const isTopbarMode = layoutMode === "topbar";
  if (!isTopbarMode) {
    return cssClass ?? "";
  }

  let next = cssClass ?? "";
  if (next.includes("game-variables-container")) next = appendClassName(next, "topbar-variables-container");
  if (next.includes("main-content-area")) next = appendClassName(next, "topbar-main-content");
  if (next.includes("cards-container")) next = appendClassName(next, "topbar-cards-container");
  if (next.includes("board-header")) next = appendClassName(next, "topbar-board-header");
  if (next.includes("board-title")) next = appendClassName(next, "topbar-board-title");
  if (next.includes("sidebar-decoration")) next = appendClassName(next, "topbar-decoration");
  return next;
}

/**
 * Выбирает фоновое изображение метрики в зависимости от режима раскладки.
 *
 * Если layoutMode === "topbar" и для данного id есть override
 * в metricBackgroundImages, использует его вместо backgroundImage.
 */
export function resolveMetricBackgroundImage(
  id: string | undefined,
  backgroundImage: string | undefined,
  layoutMode?: "leftsidebar" | "topbar",
  metricBackgroundImages?: Record<string, string>
): string | undefined {
  if (layoutMode === "topbar" && id && metricBackgroundImages) {
    return metricBackgroundImages[id] ?? backgroundImage;
  }
  return backgroundImage;
}
