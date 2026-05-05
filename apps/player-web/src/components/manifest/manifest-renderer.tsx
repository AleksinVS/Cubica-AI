import type { GameUiScreenDefinition } from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";
import { UiComponentNode } from "./ui-component-node";

/**
 * Ограниченный рендерер, управляемый манифестом.
 * Рендерит экран из данных UI-манифеста,
 * связывая значения метрик из снимка сессии и направляя
 * действия кнопок/карточек в стандартный путь dispatch.
 *
 * Раскладка по умолчанию (mockup left-sidebar-6-cards):
 * - Левый сайдбар (260px): метрики
 * - Основная область: сетка карточек (3x2) + нижние элементы управления
 * - Правая декорация (370px): иллюстрация
 */
export function ManifestRenderer({
  screenDefinition,
  metrics,
  onAction,
  screenKey,
  layoutMode = "leftsidebar",
  metricBackgroundImages
}: {
  screenDefinition: GameUiScreenDefinition;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  layoutMode?: "leftsidebar" | "topbar";
  metricBackgroundImages?: Record<string, string>;
}) {
  return (
    <div className={`game-renderer game-renderer--${layoutMode}`}>
      <UiComponentNode
        component={screenDefinition.root}
        metrics={metrics}
        onAction={onAction}
        screenKey={screenKey}
        layoutMode={layoutMode}
        metricBackgroundImages={metricBackgroundImages}
      />
    </div>
  );
}
