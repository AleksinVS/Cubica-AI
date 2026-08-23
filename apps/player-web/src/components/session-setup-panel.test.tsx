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

  it("submits the explicit private-invite mode without an agent seat", () => {
    const onSubmit = vi.fn();
    render(<SessionSetupPanel
      setup={{ ...setup, privateInviteAvailable: true }}
      isPending={false}
      error={null}
      onSubmit={onSubmit}
    />);

    fireEvent.click(screen.getByLabelText("Пригласить участников по ссылке"));
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));

    expect(onSubmit).toHaveBeenCalledWith({ participantCount: 2, agentSeatCount: 0, accessMode: "private-invite" });
  });

  it("keeps access mode orthogonal to the selected participant count", () => {
    const onSubmit = vi.fn();
    render(<SessionSetupPanel
      setup={{ ...setup, maxParticipants: 4, privateInviteAvailable: true }}
      isPending={false}
      error={null}
      onSubmit={onSubmit}
    />);

    fireEvent.change(screen.getByLabelText("Количество участников"), { target: { value: "4" } });
    fireEvent.click(screen.getByLabelText("Пригласить участников по ссылке"));
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));

    expect(onSubmit).toHaveBeenCalledWith({
      participantCount: 4,
      agentSeatCount: 0,
      accessMode: "private-invite"
    });
  });
});
