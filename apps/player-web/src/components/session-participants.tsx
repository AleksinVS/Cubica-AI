import type { PrivateSessionInvite, SessionParticipant } from "@cubica/contracts-session";
import type { SessionActionAvailability } from "@cubica/contracts-session";
import { useLocale } from "@/components/locale-context";

export function SessionParticipants({ sessionId, privateInvites = [], participants, actionAvailability = [] }: {
  readonly sessionId?: string | null;
  readonly privateInvites?: ReadonlyArray<PrivateSessionInvite>;
  readonly participants: ReadonlyArray<SessionParticipant>;
  readonly actionAvailability?: ReadonlyArray<SessionActionAvailability>;
}) {
  const t = useLocale();
  if (participants.length === 0) return null;

  const hasJoinedParticipant = participants.some((participant) => participant.joinState === "joined");
  const hasAvailableAction = actionAvailability.some((action) => action.status !== "unavailable");
  const copyInvite = async (invite: PrivateSessionInvite) => {
    if (!sessionId || typeof window === "undefined" || !navigator.clipboard) return;
    const currentUrl = new URL(window.location.href);
    const gameId = currentUrl.searchParams.get("gameId");
    currentUrl.search = "";
    if (gameId !== null) {
      currentUrl.searchParams.set("gameId", gameId);
    }
    const params = new URLSearchParams({ sessionId, inviteToken: invite.inviteToken });
    currentUrl.hash = params.toString();
    await navigator.clipboard.writeText(currentUrl.toString());
  };
  return (
    <section className="session-participants" aria-labelledby="session-participants-title">
      <h2 id="session-participants-title">{t.participantsTitle}</h2>
      <ul>
        {participants.map((participant) => (
          <li key={participant.seatId}>
            <span>{participant.playerId}</span>
            <span className="session-participant-kind">
              <span>{participant.kind === "agent" ? t.aiParticipant : t.humanParticipant}</span>
              <span aria-label="join state"> · {participant.joinState === "invited" ? t.invitedParticipant : participant.joinState === "joined" ? t.joinedParticipant : t.localParticipant}</span>
            </span>
          </li>
        ))}
      </ul>
      {hasJoinedParticipant && !hasAvailableAction ? <p role="status">{t.waitingForTurn}</p> : null}
      {privateInvites.length > 0 && sessionId ? <section aria-labelledby="session-invites-title"><h3 id="session-invites-title">{t.privateInvitesTitle}</h3><ul>{privateInvites.map((invite) => <li key={invite.seatId}><span>{invite.playerId} · {new Date(invite.expiresAt).toLocaleString("ru-RU")}</span><button type="button" onClick={() => void copyInvite(invite)}>{t.copyInviteLink}</button></li>)}</ul></section> : null}
    </section>
  );
}
