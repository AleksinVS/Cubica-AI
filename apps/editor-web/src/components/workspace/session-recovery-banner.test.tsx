/** Focused tests for reused dirty-session recovery copy. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { SessionRecoveryBanner } from "./session-recovery-banner.tsx";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SessionRecoveryBanner", () => {
  it("lists recovered paths and only dismisses the explanation", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDismiss = vi.fn();
    await act(async () => root.render(<SessionRecoveryBanner changedPaths={["games/demo/authoring/game.authoring.json"]} onDismiss={onDismiss} />));
    expect(container.textContent).toContain("несохранённые изменения из прошлой сессии");
    expect(container.textContent).toContain("games/demo/authoring/game.authoring.json");
    await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
    expect(onDismiss).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders nothing for a clean session", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(<SessionRecoveryBanner changedPaths={[]} onDismiss={vi.fn()} />));
    expect(container.childElementCount).toBe(0);
    await act(async () => root.unmount());
  });
});
