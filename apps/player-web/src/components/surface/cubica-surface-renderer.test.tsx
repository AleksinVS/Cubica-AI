import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

import type { CubicaSurface } from "@cubica/contracts-ai";

import { CubicaSurfaceRenderer, isPlayerWebSurfaceAction } from "./cubica-surface-renderer";

const unsupportedSurface: CubicaSurface = {
  schemaVersion: "1.0.0",
  surfaceId: "surface-unsupported-action",
  catalogVersion: "2026-06-11",
  mode: "primary-gameplay",
  title: "Unsupported action",
  root: {
    id: "root",
    kind: "cubica.button",
    props: {
      label: "Open editor"
    },
    actions: [
      {
        id: "editor",
        kind: "editorTool",
        label: "Open editor",
        target: "editor.applyChangeSet",
        sideEffectPolicy: "human-approved",
        requiresApproval: true
      }
    ]
  }
};

describe("CubicaSurfaceRenderer", () => {
  it("does not dispatch unsupported player-web action kinds", () => {
    const onAction = vi.fn();

    render(<CubicaSurfaceRenderer surface={unsupportedSurface} onAction={onAction} />);

    const button = screen.getByRole("button", { name: "Open editor" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });

  it("keeps the player-web action allowlist explicit", () => {
    expect(isPlayerWebSurfaceAction(undefined)).toBe(false);
    expect(isPlayerWebSurfaceAction({ id: "noop", kind: "noop", sideEffectPolicy: "read-only" })).toBe(false);
    expect(isPlayerWebSurfaceAction({ id: "agent", kind: "agentTurn", sideEffectPolicy: "system-approved" })).toBe(true);
    expect(isPlayerWebSurfaceAction({ id: "runtime", kind: "runtimeAction", sideEffectPolicy: "system-approved" })).toBe(true);
    expect(isPlayerWebSurfaceAction({ id: "url", kind: "openUrl", sideEffectPolicy: "system-approved" })).toBe(false);
  });
});
