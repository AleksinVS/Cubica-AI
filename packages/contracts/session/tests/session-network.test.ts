import {
  validatePrivateInviteClaimRequestShape,
  validatePrivateSessionInvitesShape,
  validatePrivateSeatRecoveryInviteRequestShape,
  validateSessionVersionNotificationShape
} from "../src/index.ts";

describe("private invite and version notification contracts", () => {
  const token = `inv_${"a".repeat(43)}`;

  it("closes invite creation metadata and rejects malformed/replayed-shape input", () => {
    const invite = [{ seatId: "seat-b", playerId: "player-b", inviteToken: token, expiresAt: "2026-09-01T00:00:00.000Z" }];
    expect(validatePrivateSessionInvitesShape(invite)).toBe(true);
    expect(validatePrivateSessionInvitesShape([{ ...invite[0], extra: true }])).toBe(false);
    expect(validatePrivateSessionInvitesShape([{ ...invite[0], inviteToken: "ses_bad" }])).toBe(false);
    expect(validatePrivateInviteClaimRequestShape({ inviteToken: token })).toBe(true);
    expect(validatePrivateInviteClaimRequestShape({ inviteToken: token, privateInvites: invite })).toBe(false);
    expect(validatePrivateInviteClaimRequestShape({ inviteToken: "inv_short" })).toBe(false);
    expect(validatePrivateSeatRecoveryInviteRequestShape({ seatId: "seat-b" })).toBe(true);
    expect(validatePrivateSeatRecoveryInviteRequestShape({ seatId: "" })).toBe(false);
    expect(validatePrivateSeatRecoveryInviteRequestShape({ seatId: "seat-b", extra: true })).toBe(false);
    expect(validatePrivateSeatRecoveryInviteRequestShape({})).toBe(false);
  });

  it("accepts only the closed minimal SSE cursor", () => {
    expect(validateSessionVersionNotificationShape({ stateVersion: 4, lastEventSequence: 9 })).toBe(true);
    expect(validateSessionVersionNotificationShape({ stateVersion: 4, lastEventSequence: 9, state: {} })).toBe(false);
    expect(validateSessionVersionNotificationShape({ stateVersion: -1, lastEventSequence: 9 })).toBe(false);
  });
});
