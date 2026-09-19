import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@copilotkit/react-core/v2", () => ({
  CopilotKit: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CopilotChat: () => null,
  CopilotChatUserMessage: () => null,
  useAgent: vi.fn(), useCopilotKit: vi.fn(), useAgentContext: vi.fn(), useFrontendTool: vi.fn()
}));
import { EditorAgentProvider } from "./editor-agent-ui";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("keeps the working editor mounted when the agent connection becomes ready", async () => {
  vi.stubEnv("NEXT_PUBLIC_CUBICA_EDITOR_AGENT_UI", "1");
  let finishConnection!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finishConnection = resolve; })));
  const mounted = vi.fn(), unmounted = vi.fn();
  function EditorDraft() {
    useEffect(() => { mounted(); return unmounted; }, []);
    return <input defaultValue="Авторский черновик" />;
  }
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<EditorAgentProvider><EditorDraft /></EditorAgentProvider>); });
  const input = container.querySelector("input")!;
  input.value = "Новая правка";
  await act(async () => { finishConnection(Response.json({ ok: true, agUiBackendConfigured: true })); });
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
  expect(container.querySelector("input")).toBe(input);
  expect(input.value).toBe("Новая правка");
  await act(async () => { root.unmount(); }); container.remove();
});
