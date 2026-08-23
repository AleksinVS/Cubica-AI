import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import type { PlayerSessionSetup } from "@/presenter/types";

interface SessionSetupPanelProps {
  readonly setup: PlayerSessionSetup;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly onSubmit: (selection: { participantCount: number; agentSeatCount: number }) => void;
}

export function SessionSetupPanel({ setup, isPending, error, onSubmit }: SessionSetupPanelProps) {
  const t = useLocale();
  const [participantCount, setParticipantCount] = useState(setup.participantCount);
  const [agentSeatCount, setAgentSeatCount] = useState(0);

  const maxAgentSeats = Math.min(setup.maxAgentSeats, participantCount);
  const boundedAgentSeatCount = Math.min(agentSeatCount, maxAgentSeats);

  return (
    <section className="session-setup-panel" aria-labelledby="session-setup-title">
      <span className="runtime-status-kicker">{t.sessionSetupKicker}</span>
      <h1 id="session-setup-title">{t.sessionSetupTitle}</h1>
      <p>{t.sessionSetupDescription}</p>
      {setup.minParticipants < setup.maxParticipants ? (
        <label className="session-setup-field" htmlFor="participant-count">
          <span>{t.participantCountLabel}</span>
          <select
            id="participant-count"
            value={participantCount}
            onChange={(event) => setParticipantCount(Number(event.target.value))}
            disabled={isPending}
          >
            {Array.from(
              { length: setup.maxParticipants - setup.minParticipants + 1 },
              (_, index) => setup.minParticipants + index
            ).map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
        </label>
      ) : (
        <p className="session-setup-fixed-count">
          {t.participantCountLabel}: <strong>{participantCount}</strong>
        </p>
      )}

      {maxAgentSeats > 0 ? (
        <fieldset className="session-setup-choice">
          <legend>{t.participantModeLabel}</legend>
          <label>
            <input
              type="radio"
              name="participant-mode"
              checked={boundedAgentSeatCount === 0}
              onChange={() => setAgentSeatCount(0)}
              disabled={isPending}
            />
            {t.humanOnlyChoice}
          </label>
          <label>
            <input
              type="radio"
              name="participant-mode"
              checked={boundedAgentSeatCount > 0}
              onChange={() => setAgentSeatCount(1)}
              disabled={isPending}
            />
            {t.agentSeatChoice}
          </label>
        </fieldset>
      ) : null}

      {boundedAgentSeatCount > 0 ? (
        <label className="session-setup-field" htmlFor="agent-seat-count">
          <span>{t.agentSeatCountLabel}</span>
          <select
            id="agent-seat-count"
            value={boundedAgentSeatCount}
            onChange={(event) => setAgentSeatCount(Number(event.target.value))}
            disabled={isPending}
          >
            {Array.from({ length: maxAgentSeats }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
        </label>
      ) : null}

      <button
        className="action-button session-setup-submit"
        type="button"
        disabled={isPending}
        onClick={() => onSubmit({ participantCount, agentSeatCount: boundedAgentSeatCount })}
      >
        {isPending ? t.loading : t.startSession}
      </button>
      {error ? <p className="error session-setup-error" role="alert">{error}</p> : null}
    </section>
  );
}
