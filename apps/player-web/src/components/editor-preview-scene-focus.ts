/** A scene may target either a compiled UI node or its producer-marked game content. */
export function scrollPreviewSceneFocus(root: HTMLElement | null, runtimePointer: string | undefined): boolean {
  if (root === null || runtimePointer === undefined) return false;
  const selected = [...root.querySelectorAll<HTMLElement>(
    "[data-preview-runtime-pointer], [data-preview-content-runtime-pointer]"
  )].find((element) => element.dataset.previewRuntimePointer === runtimePointer ||
    element.dataset.previewContentRuntimePointer === runtimePointer);
  if (selected === undefined) return false;
  selected.scrollIntoView({ block: "center", inline: "center" });
  return true;
}
