import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionSetup } from "./session-setup";

describe("SessionSetup", () => {
  it("requires explicit confirmation and exposes an accessible participant choice", () => {
    const onConfirm = vi.fn();
    render(<SessionSetup min={2} max={4} onConfirm={onConfirm} />);

    expect(screen.getByRole("heading", { name: "Выберите количество участников" })).toBeTruthy();
    expect(screen.getByLabelText("Участники")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Участники"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Начать игру" }));

    expect(onConfirm).toHaveBeenCalledWith(3);
  });
});
