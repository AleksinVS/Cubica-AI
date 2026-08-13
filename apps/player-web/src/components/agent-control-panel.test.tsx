import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentControlPanel } from "./agent-control-panel";

describe("AgentControlPanel", () => {
  it("renders paused and facilitator takeover states", () => {
    const onRefresh = vi.fn();
    const control = {
      playerId: "p2",
      status: "paused" as const,
      reasonCode: "runtimeUnavailable" as const
    };
    render(<AgentControlPanel control={control} onRefresh={onRefresh} />);
    expect(screen.getByRole("heading", { name: "Ход ИИ-участника приостановлен" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();

    render(<AgentControlPanel control={{ ...control, status: "facilitatorTakeover" }} onRefresh={onRefresh} />);
    expect(screen.getByRole("heading", { name: "Управление передано ведущему" })).toBeTruthy();
  });

  it("fails closed for malformed control data", () => {
    const onRefresh = vi.fn();
    render(<AgentControlPanel invalid onRefresh={onRefresh} />);
    expect(screen.getByRole("heading", { name: "Состояние участника не удалось проверить" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
  });
});
