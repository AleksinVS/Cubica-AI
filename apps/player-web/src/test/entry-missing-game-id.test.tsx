/**
 * Unit test for the platform entry point's "missing gameId" behavior
 * (ARC-003, TSK-20260719-antarctica-remediation, block R5).
 *
 * `apps/player-web/app/page.tsx` used to default a bare "/" request to the
 * "antarctica" game, which is a game-agnostic-platform violation (CLAUDE.md
 * rule 10: no hardcoded game id in platform layers). This test locks in the
 * replacement behavior: without an explicit `?gameId=` query parameter the
 * page must render a generic Russian error screen and must never reach the
 * content-loading / session-creation path.
 *
 * `Page` is a Next.js async Server Component. It can be exercised directly
 * in Vitest by awaiting it like any async function and rendering the
 * returned JSX with React Testing Library - no Next.js server runtime is
 * required for this bounded check.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// `loadGamePlayerContent` is the first place Page would talk to runtime-api.
// Mocking it lets the test assert "no content/session fetch happens" simply
// by asserting the mock was never called, instead of stubbing global fetch.
vi.mock("@/lib/game-content-resolvers", () => ({
  loadGamePlayerContent: vi.fn(),
  getRuntimeApiUrl: vi.fn(() => "http://127.0.0.1:3001")
}));

import { loadGamePlayerContent } from "@/lib/game-content-resolvers";
// app/ has no path alias (only src/ does); relative import matches the
// existing pattern in src/test/runtime-bff.test.ts.
import Page from "../../app/page";

describe("player-web entry point without gameId (ARC-003)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a generic Russian error screen and creates no session when gameId is absent", async () => {
    const jsx = await Page({ searchParams: Promise.resolve({}) });
    render(jsx);

    expect(
      screen.getByRole("heading", { name: "Не указан идентификатор игры" })
    ).toBeDefined();
    expect(screen.getByText(/gameId=<идентификатор игры>/)).toBeDefined();

    // The error copy must stay platform-generic: it must not name any
    // concrete game.
    expect(screen.queryByText(/antarctica/i)).toBeNull();
    expect(screen.queryByText(/антарктид/i)).toBeNull();

    // No GamePlayer session/content path was reached.
    expect(loadGamePlayerContent).not.toHaveBeenCalled();
  });

  it("also treats an empty gameId value as missing", async () => {
    const jsx = await Page({ searchParams: Promise.resolve({ gameId: "" }) });
    render(jsx);

    expect(
      screen.getByRole("heading", { name: "Не указан идентификатор игры" })
    ).toBeDefined();
    expect(loadGamePlayerContent).not.toHaveBeenCalled();
  });
});
