import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionParticipants } from "./session-participants";

describe("SessionParticipants", () => {
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
});
