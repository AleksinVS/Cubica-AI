import { createContext, useContext, type ReactNode } from "react";
import type { GameUiComponent } from "@cubica/contracts-manifest";
import type { EditorTemporaryPreviewLayerRequest } from "@cubica/contracts-session";

export type TemporaryPreviewPatch = EditorTemporaryPreviewLayerRequest["patches"][number];

const TemporaryPreviewLayerContext = createContext<readonly TemporaryPreviewPatch[]>([]);

export function TemporaryPreviewLayerProvider({ patches, children }: {
  readonly patches: readonly TemporaryPreviewPatch[];
  readonly children: ReactNode;
}) {
  return <TemporaryPreviewLayerContext.Provider value={patches}>{children}</TemporaryPreviewLayerContext.Provider>;
}

export function useTemporaryPreviewComponent(
  component: GameUiComponent,
  runtimePointer: string | undefined,
  ownerFor: (patch: TemporaryPreviewPatch) => string | undefined
): GameUiComponent {
  const patches = useContext(TemporaryPreviewLayerContext);
  if (runtimePointer === undefined || patches.length === 0) return component;
  let result = component;
  for (const patch of patches) {
    if (patch.runtimePointer !== runtimePointer || patch.ownerRuntimePointer !== ownerFor(patch)) continue;
    if (patch.property === "width" || patch.property === "height" || patch.property === "transform") {
      const style = (result as GameUiComponent & { style?: Record<string, unknown> }).style;
      result = { ...result, style: { ...(style ?? {}), [patch.property]: patch.value } } as GameUiComponent;
    } else {
      result = { ...result, props: { ...(result.props ?? {}), [patch.property]: patch.value } } as GameUiComponent;
    }
  }
  return result;
}
