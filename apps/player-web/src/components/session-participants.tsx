import type { SessionParticipant } from "@cubica/contracts-session";
import { useLocale } from "@/components/locale-context";

export function SessionParticipants({ participants }: {
  readonly participants: ReadonlyArray<SessionParticipant>;
}) {
  const t = useLocale();
  if (participants.length === 0) return null;

  return (
    <section className="session-participants" aria-labelledby="session-participants-title">
      <h2 id="session-participants-title">{t.participantsTitle}</h2>
      <ul>
        {participants.map((participant) => (
          <li key={participant.seatId}>
            <span>{participant.playerId}</span>
            <span className="session-participant-kind">
              {participant.kind === "agent" ? t.aiParticipant : t.humanParticipant}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
