import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicJournalDownload } from "./public-journal-download";

describe("PublicJournalDownload", () => {
  it.each([
    { sessionId: null, runtimeStatus: "booting" as const },
    { sessionId: "generic-session", runtimeStatus: "paused" as const },
    { sessionId: "", runtimeStatus: "ready" as const }
  ])("stays hidden before a usable ready session", (state) => {
    const { container } = render(<PublicJournalDownload {...state} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders an accessible server download for a generic ready state", () => {
    render(<PublicJournalDownload sessionId="generic/session" runtimeStatus="ready" />);

    const link = screen.getByRole("link", { name: "Скачать журнал" });
    expect(link.getAttribute("href")).toBe(
      "/api/runtime/sessions/generic%2Fsession/public-journal"
    );
    expect(link.hasAttribute("download")).toBe(true);
  });

  it("uses the same affordance for a Cards Money Trains-shaped session state", () => {
    const cmtState = {
      sessionId: "cmt-session-1",
      runtimeStatus: "ready" as const,
      gameId: "cards-money-trains",
      phase: "operations",
      public: { teams: { "white-logistics": { coins: 24 } } }
    };

    render(
      <PublicJournalDownload
        sessionId={cmtState.sessionId}
        runtimeStatus={cmtState.runtimeStatus}
      />
    );

    expect(screen.getByRole("link", { name: "Скачать журнал" }).getAttribute("href")).toBe(
      "/api/runtime/sessions/cmt-session-1/public-journal"
    );
  });
});
