import { describe, expect, it } from "vitest";
import { buildPrivateInviteFragment, parsePrivateInviteFragment } from "./private-invite-fragment";

const invite = { seatId: "seat-1", playerId: "player-1", credential: `ses_${"a".repeat(43)}` };

describe("private invite fragments", () => {
  it("round-trips without putting the credential in a query string", () => {
    const fragment = buildPrivateInviteFragment({ sessionId: "session-1", invite });
    expect(fragment.startsWith("#invite?")).toBe(true);
    expect(parsePrivateInviteFragment(fragment)).toEqual({ sessionId: "session-1", invite });
  });

  it("rejects malformed and oversized session identifiers", () => {
    expect(parsePrivateInviteFragment("#invite?sessionId=x&seatId=s&playerId=p")).toBeNull();
    expect(parsePrivateInviteFragment(`#invite?sessionId=${"x".repeat(257)}&seatId=s&playerId=p&credential=ses_${"a".repeat(43)}`)).toBeNull();
  });
});
