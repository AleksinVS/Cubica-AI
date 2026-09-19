// @vitest-environment happy-dom
import { UserMessageSchema } from "@ag-ui/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawingAgentMessage, toEditorUserMessage } from "./mvp-agent-message";

afterEach(() => vi.restoreAllMocks());

describe("drawing message transport", () => {
  it("uses canonical AG-UI image parts and keeps image contents out of the prompt", () => {
    const message = toEditorUserMessage({ text: "Move this button", images: [{ name: "sketch.png", dataUrl: "data:image/png;base64,AA==" }] });
    expect(UserMessageSchema.safeParse(message).success).toBe(true);
    expect(message.content).toEqual([
      { type: "text", text: "Move this button" },
      { type: "image", source: { type: "data", mimeType: "image/png", value: "AA==" }, metadata: { filename: "sketch.png" } }
    ]);
    expect(() => toEditorUserMessage({ text: "x", images: [{ name: "x", dataUrl: "https://untrusted.invalid/x" }] })).toThrow();
  });

  it("sends original image and normalized overlay separately with annotations as context", async () => {
    const lineTo = vi.fn(), fillText = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ beginPath: vi.fn(), moveTo: vi.fn(), lineTo, stroke: vi.fn(), fillText } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AA==");
    const message = await drawingAgentMessage({
      prompt: "Увеличить кнопку", strokes: [{ points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.5 }] }],
      annotations: [{ x: 0.25, y: 0.25, text: "Играть" }],
      background: { dataUrl: "data:image/jpeg;base64,AQ==", width: 1200, height: 600 },
      region: { x: 0, y: 0, width: 0.5, height: 0.5 }
    });
    expect(message.images?.map(item => item.dataUrl)).toEqual(["data:image/jpeg;base64,AQ==", "data:image/png;base64,AA=="]);
    expect(lineTo).toHaveBeenCalledWith(800, 400);
    expect(fillText).toHaveBeenCalledWith("Играть", 400, 200);
    expect(message.context).toContain('"text":"Играть"');
    expect(UserMessageSchema.safeParse(toEditorUserMessage(message)).success).toBe(true);
  });
});
