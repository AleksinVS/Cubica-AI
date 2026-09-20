import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { MVP_PROMPT_SEPARATOR, serializeMvpPromptDocument } from "./mvp-prompt-document";
import { MvpPromptTextarea } from "./mvp-prompt-textarea";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MvpPromptTextarea", () => {
  it("keeps one native textarea and returns an invalid raw draft unchanged", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const initial = serializeMvpPromptDocument(["Разовая правка", "Замысел", "label: Ответ"]);
    const onRaw = vi.fn();
    let root: Root | undefined;
    function Harness() {
      const [raw, setRaw] = useState(initial);
      const textareaRef = useRef<HTMLTextAreaElement>(null);
      return <MvpPromptTextarea ref={textareaRef} value={raw} onChange={(next) => { onRaw(next); setRaw(next); }} />;
    }
    await act(async () => { root = createRoot(container); root.render(<Harness />); });
    const textarea = container.querySelector("textarea");
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(textarea?.value).toBe(initial);
    const invalid = initial.replace(MVP_PROMPT_SEPARATOR, "разделитель удалён");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, invalid);
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onRaw).toHaveBeenLastCalledWith(invalid);
    expect(textarea?.value).toBe(invalid);
    await act(async () => root?.unmount());
    container.remove();
  });

  it("keeps the caret on a parent echo and exposes the textarea ref", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const raw = serializeMvpPromptDocument(["A", "B", "C"]);
    const textareaRef = React.createRef<HTMLTextAreaElement>();
    const onHeightChange = vi.fn();
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<MvpPromptTextarea ref={textareaRef} value={raw} onChange={vi.fn()} onHeightChange={onHeightChange} />);
    });
    const textarea = textareaRef.current;
    expect(textarea).toBe(container.querySelector("textarea"));
    textarea?.setSelectionRange(3, 3);
    await act(async () => root?.render(<MvpPromptTextarea ref={textareaRef} value={raw} onChange={vi.fn()} onHeightChange={onHeightChange} />));
    expect(textareaRef.current?.selectionStart).toBe(3);
    expect(onHeightChange).toHaveBeenCalled();
    await act(async () => root?.unmount());
    container.remove();
  });
});
