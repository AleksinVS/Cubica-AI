import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionSetupPanel } from "./session-setup-panel";

const setup = {
  participantCount: 2,
  minParticipants: 2,
  maxParticipants: 2,
  maxAgentSeats: 2
} as const;

describe("SessionSetupPanel", () => {
  it("keeps the participant count fixed and offers bounded human/agent choices", () => {
    const onSubmit = vi.fn();
    render(<SessionSetupPanel setup={setup} isPending={false} error={null} onSubmit={onSubmit} />);

    expect(screen.getByText((_, element) =>
      element?.classList.contains("session-setup-fixed-count") ?? false
    ).textContent).toContain("Количество участников: 2");
    expect(screen.queryByLabelText("Количество участников")).toBeNull();
    expect(screen.getByLabelText("Только люди")).toBeTruthy();
    expect(screen.getByLabelText("Добавить ИИ-участника")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Добавить ИИ-участника"));
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));
    expect(onSubmit).toHaveBeenCalledWith({ participantCount: 2, agentSeatCount: 1 });

    fireEvent.change(screen.getByLabelText("Количество ИИ-участников"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));
    expect(onSubmit).toHaveBeenLastCalledWith({ participantCount: 2, agentSeatCount: 2 });
  });

  it("renders the creation error and disables duplicate submission", () => {
    const onSubmit = vi.fn();
    render(<SessionSetupPanel setup={setup} isPending error="Сессия не создана" onSubmit={onSubmit} />);

    expect(screen.getByRole("alert").textContent).toContain("Сессия не создана");
    expect(screen.getByRole("button", { name: "Загрузка..." }).hasAttribute("disabled")).toBe(true);
  });

  it("supports explicit local/private access and disables agent seats for private sessions", () => {
    const onSubmit = vi.fn();
    render(<SessionSetupPanel setup={setup} isPending={false} error={null} onSubmit={onSubmit} />);

    expect((screen.getByLabelText("Локальная игра") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Добавить ИИ-участника"));
    fireEvent.click(screen.getByLabelText("Игра по приглашениям"));
    expect(screen.queryByLabelText("Добавить ИИ-участника")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));
    expect(onSubmit).toHaveBeenCalledWith({
      participantCount: 2,
      agentSeatCount: 0,
      accessMode: "private-invite"
    });

    fireEvent.click(screen.getByLabelText("Локальная игра"));
    expect(screen.getByLabelText("Добавить ИИ-участника")).toBeTruthy();
  });
});
