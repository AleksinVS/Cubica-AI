/**
 * Optional region-snapshot capture seam for the preview-first editor.
 *
 * Region prompts (ADR-057 §4.7; editor-preview-first-ux §4/§8; design-spec §2.7)
 * may carry a screenshot of the selected preview area IN ADDITION to the captured
 * entity list — but only when the active renderer adapter advertises the OPTIONAL
 * `captureRegionSnapshot` capability. This helper is the single place the region
 * wiring asks for that snapshot, so the "capability present → snapshot, absent →
 * entity list only" degradation is testable without the large workspace hook.
 */
import type { PreviewRect, PreviewRegionSnapshot, PreviewRendererAdapter } from "@cubica/editor-engine";

/**
 * Captures the region snapshot for `rect` when the adapter supports it.
 *
 * Returns `null` — degrading the region prompt to the entity list, which is the
 * CORRECT behaviour per §8 — when:
 *  - no adapter is available (for example the cross-origin iframe preview, which
 *    cannot expose a snapshot-capable renderer across the frame boundary);
 *  - the adapter omits the optional `captureRegionSnapshot` method;
 *  - the capture itself returns `null` or throws (tainted/cross-origin canvas).
 */
export async function captureRegionSnapshotForAgent(
  adapter: PreviewRendererAdapter | null | undefined,
  rect: PreviewRect
): Promise<PreviewRegionSnapshot | null> {
  if (adapter?.captureRegionSnapshot === undefined) {
    return null;
  }

  try {
    return await adapter.captureRegionSnapshot(rect);
  } catch {
    return null;
  }
}
