import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionParticipants } from "./session-participants";

describe("SessionParticipants", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, "clipboard");
    window.history.replaceState({}, "", "/");
  });

  it("labels server-authoritative human and AI seats", () => {
    render(<SessionParticipants participants={[
      { seatId: "p1", playerId: "p1", kind: "human", joinState: "local" },
      { seatId: "p2", playerId: "p2", kind: "agent", joinState: "local" }
    ]} />);

    expect(screen.getByText("p1")).toBeTruthy();
    expect(screen.getByText("Человек")).toBeTruthy();
    expect(screen.getByText("p2")).toBeTruthy();
    expect(screen.getByText("ИИ")).toBeTruthy();
  });

  it("copies an invite URL with only gameId query and exact session/token fragment fields", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    window.history.replaceState(
      {},
      "",
      "/?gameId=estate-race&launchToken=portal-secret&launchCounter=7&contentSourceId=preview-secret"
    );
    render(<SessionParticipants
      sessionId="session-1"
      participants={[{ seatId: "p1", playerId: "p1", kind: "human", joinState: "local" }]}
      privateInvites={[{
        seatId: "p2",
        playerId: "p2",
        inviteToken: "inv_secret",
        expiresAt: "2026-08-25T12:00:00.000Z"
      }]}
    />);

    const button = screen.getByRole("button", { name: "Скопировать ссылку" });
    expect(button).toBeTruthy();
    fireEvent.click(button);
    await Promise.resolve();
    const copied = String(writeText.mock.calls[0]?.[0]);
    const url = new URL(copied);
    expect(url.search).toBe("?gameId=estate-race");
    expect([...new URLSearchParams(url.hash.slice(1)).keys()]).toEqual(["sessionId", "inviteToken"]);
    expect(url.hash).toBe("#sessionId=session-1&inviteToken=inv_secret");
  });
});
