import { useState } from "react";
import type { PrivateSessionInvite, SessionParticipant } from "@cubica/contracts-session";
import type { SessionActionAvailability } from "@cubica/contracts-session";
import { useLocale } from "@/components/locale-context";

export function SessionParticipants({
  sessionId,
  privateInvites = [],
  participants,
  actionAvailability = [],
  hostManagementHint = false,
  onRecoverGuestSeat
}: {
  readonly sessionId?: string | null;
  readonly privateInvites?: ReadonlyArray<PrivateSessionInvite>;
  readonly participants: ReadonlyArray<SessionParticipant>;
  readonly actionAvailability?: ReadonlyArray<SessionActionAvailability>;
  readonly hostManagementHint?: boolean;
  readonly onRecoverGuestSeat?: (seatId: string) => Promise<PrivateSessionInvite | undefined>;
}) {
  const t = useLocale();
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  if (participants.length === 0) return null;
  const hasJoinedParticipant = participants.some((participant) => participant.joinState === "joined");
  const hasAvailableAction = actionAvailability.some((action) => action.status !== "unavailable");
  const buildInviteLink = (invite: PrivateSessionInvite) => {
    if (!sessionId || typeof window === "undefined") return null;
    const currentUrl = new URL(window.location.href);
    const gameId = currentUrl.searchParams.get("gameId");
    currentUrl.search = "";
    if (gameId !== null) currentUrl.searchParams.set("gameId", gameId);
    currentUrl.hash = new URLSearchParams({ sessionId, inviteToken: invite.inviteToken }).toString();
    return currentUrl.toString();
  };
  const copyInvite = async (invite: PrivateSessionInvite, seatId: string) => {
    const link = buildInviteLink(invite);
    if (!link) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setFeedback((current) => ({ ...current, [seatId]: t.inviteCopied }));
    } catch {
      window.prompt(t.recoveryFallbackPrompt, link);
      setFeedback((current) => ({ ...current, [seatId]: t.recoveryFallbackNotice }));
    }
  };
  const recover = async (participant: SessionParticipant) => {
    if (!onRecoverGuestSeat) return;
    setPendingSeat(participant.seatId);
    setFeedback((current) => ({ ...current, [participant.seatId]: t.recoveryLoading }));
    try {
      const invite = await onRecoverGuestSeat(participant.seatId);
      if (invite) await copyInvite(invite, participant.seatId);
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [participant.seatId]: error instanceof Error ? error.message : t.recoveryError
      }));
    } finally {
      setPendingSeat(null);
    }
  };
  return (
    <section className="session-participants" aria-labelledby="session-participants-title">
      <h2 id="session-participants-title">{t.participantsTitle}</h2>
      <ul>
        {participants.map((participant, index) => (
          <li key={participant.seatId}>
            <span>{participant.playerId}</span>
            <span className="session-participant-kind">
              <span>{participant.kind === "agent" ? t.aiParticipant : t.humanParticipant}</span>
              <span aria-label="join state">
                {" · "}
                {participant.joinState === "invited"
                  ? t.invitedParticipant
                  : participant.joinState === "joined"
                    ? t.joinedParticipant
                    : t.localParticipant}
              </span>
            </span>
            {hostManagementHint &&
            index > 0 &&
            participant.kind === "human" &&
            participant.joinState === "joined" &&
            onRecoverGuestSeat ? (
              <span>
                <button
                  type="button"
                  disabled={pendingSeat !== null}
                  onClick={() => void recover(participant)}
                  aria-label={`${t.recoverGuestSeat}: ${participant.playerId}`}
                >
                  {pendingSeat === participant.seatId ? t.recoveryLoading : t.recoverGuestSeat}
                </button>
                {feedback[participant.seatId] ? (
                  <span role="status">{feedback[participant.seatId]}</span>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {hasJoinedParticipant && !hasAvailableAction ? (
        <p role="status">{t.waitingForTurn}</p>
      ) : null}
      {privateInvites.length > 0 && sessionId ? (
        <section aria-labelledby="session-invites-title">
          <h3 id="session-invites-title">{t.privateInvitesTitle}</h3>
          <ul>
            {privateInvites.map((invite) => (
              <li key={invite.seatId}>
                <span>
                  {invite.playerId} · {new Date(invite.expiresAt).toLocaleString("ru-RU")}
                </span>
                <button type="button" onClick={() => void copyInvite(invite, invite.seatId)}>
                  {t.copyInviteLink}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
