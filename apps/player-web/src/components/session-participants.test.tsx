import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0]?.[0]);
    const url = new URL(copied);
    expect(url.search).toBe("?gameId=estate-race");
    expect([...new URLSearchParams(url.hash.slice(1)).keys()]).toEqual(["sessionId", "inviteToken"]);
    expect(url.hash).toBe("#sessionId=session-1&inviteToken=inv_secret");
  });

  it("offers recovery only for a hinted non-host joined human seat", () => {
    render(<SessionParticipants
      sessionId="session-1"
      hostManagementHint
      onRecoverGuestSeat={vi.fn()}
      participants={[
        { seatId: "p1", playerId: "p1", kind: "human", joinState: "joined" },
        { seatId: "p2", playerId: "p2", kind: "human", joinState: "joined" },
        { seatId: "p3", playerId: "p3", kind: "human", joinState: "invited" },
        { seatId: "p4", playerId: "p4", kind: "agent", joinState: "joined" }
      ]}
    />);

    expect(screen.getAllByRole("button", { name: /Восстановить приглашение/u })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Восстановить приглашение: p2" })).toBeTruthy();
  });

  it("hides recovery controls without the host-management hint", () => {
    render(<SessionParticipants
      hostManagementHint={false}
      onRecoverGuestSeat={vi.fn()}
      participants={[{ seatId: "p1", playerId: "p1", kind: "human", joinState: "joined" }, { seatId: "p2", playerId: "p2", kind: "human", joinState: "joined" }]}
    />);
    expect(screen.queryByRole("button", { name: /Восстановить приглашение/u })).toBeNull();
  });

  it("recovers, copies the exact fragment link, and keeps the token out of storage", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    const recover = vi.fn().mockResolvedValue({ seatId: "p2", playerId: "p2", inviteToken: "recovery-secret", expiresAt: "2026-08-25T12:00:00.000Z" });
    const setItem = vi.spyOn(window.localStorage, "setItem");
    window.history.replaceState({}, "", "/?gameId=estate-race&secret=remove");
    render(<SessionParticipants sessionId="session-1" hostManagementHint onRecoverGuestSeat={recover} participants={[{ seatId: "p1", playerId: "p1", kind: "human", joinState: "joined" }, { seatId: "p2", playerId: "p2", kind: "human", joinState: "joined" }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Восстановить приглашение: p2" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(recover).toHaveBeenCalledWith("p2");
    expect(writeText).toHaveBeenCalledWith("http://localhost:3000/?gameId=estate-race#sessionId=session-1&inviteToken=recovery-secret");
    expect(screen.getByText("Ссылка скопирована")).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("uses a prompt fallback when clipboard access fails", async () => {
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    const recover = vi.fn().mockResolvedValue({ seatId: "p2", playerId: "p2", inviteToken: "prompt-secret", expiresAt: "2026-08-25T12:00:00.000Z" });
    render(<SessionParticipants sessionId="session-1" hostManagementHint onRecoverGuestSeat={recover} participants={[{ seatId: "p1", playerId: "p1", kind: "human", joinState: "joined" }, { seatId: "p2", playerId: "p2", kind: "human", joinState: "joined" }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Восстановить приглашение: p2" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledWith("Скопируйте ссылку приглашения", expect.stringContaining("inviteToken=prompt-secret")));
    expect(screen.getByText(/Ссылка показана в отдельном окне/u)).toBeTruthy();
  });
});
