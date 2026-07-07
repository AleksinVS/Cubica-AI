import { createStaticPreviewRendererAdapter, type PreviewRect, type PreviewRegionSnapshot, type PreviewRendererAdapter } from "@cubica/editor-engine";
import { describe, expect, it } from "vitest";

import { captureRegionSnapshotForAgent } from "./preview-region-snapshot";

const rect: PreviewRect = { x: 0, y: 0, width: 10, height: 10 };

const sampleSnapshot: PreviewRegionSnapshot = {
  mediaType: "image/png",
  width: 10,
  height: 10,
  rect,
  dataUrl: "data:image/png;base64,AAAA",
  capturedAt: "2026-07-07T00:00:00.000Z"
};

describe("captureRegionSnapshotForAgent (optional region snapshot capability)", () => {
  it("degrades to null when there is no adapter", async () => {
    await expect(captureRegionSnapshotForAgent(null, rect)).resolves.toBeNull();
    await expect(captureRegionSnapshotForAgent(undefined, rect)).resolves.toBeNull();
  });

  it("degrades to null when the adapter has no captureRegionSnapshot method", async () => {
    // The engine static adapter deliberately omits the optional capability, so it
    // stands in for any renderer that does not support region snapshots.
    const adapter = createStaticPreviewRendererAdapter();
    expect(adapter.captureRegionSnapshot).toBeUndefined();
    await expect(captureRegionSnapshotForAgent(adapter, rect)).resolves.toBeNull();
  });

  it("returns the snapshot when the adapter supports the capability", async () => {
    const adapter: PreviewRendererAdapter = {
      ...createStaticPreviewRendererAdapter(),
      captureRegionSnapshot: async () => sampleSnapshot
    };
    await expect(captureRegionSnapshotForAgent(adapter, rect)).resolves.toEqual(sampleSnapshot);
  });

  it("degrades to null when the adapter's capture rejects (tainted/cross-origin)", async () => {
    const adapter: PreviewRendererAdapter = {
      ...createStaticPreviewRendererAdapter(),
      captureRegionSnapshot: async () => {
        throw new Error("SecurityError: tainted canvas");
      }
    };
    await expect(captureRegionSnapshotForAgent(adapter, rect)).resolves.toBeNull();
  });
});
