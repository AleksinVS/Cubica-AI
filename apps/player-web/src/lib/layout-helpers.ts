import { appendClassName } from "@/lib/classname-utils";

/**
 * Дополняет CSS-класс area-контейнера объявленными в манифесте topbar-модификаторами.
 *
 * ADR-055 (renderer purity): раньше эта функция знала конкретные структурные
 * CSS-классы одной игры и по ним навешивала topbar-модификаторы — то есть
 * generic-рендерер знал одну конкретную игру. Теперь какие модификаторы нужны в
 * topbar-режиме объявляет сам UI-манифест в `props.topbarCssClass`; рендерер лишь
 * применяет их в topbar-режиме, не зная значений. `cssClass` не модифицируется.
 * `appendClassName` дедуплицирует, поэтому если модификатор уже присутствует в
 * `cssClass`, повтора не будет.
 */
export function resolveAreaCssClass(
  cssClass: string | undefined,
  layoutMode?: "leftsidebar" | "topbar",
  topbarCssClass?: string
): string {
  let next = cssClass ?? "";
  if (layoutMode === "topbar" && topbarCssClass) {
    for (const modifier of topbarCssClass.split(/\s+/).filter(Boolean)) {
      next = appendClassName(next, modifier);
    }
  }
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
