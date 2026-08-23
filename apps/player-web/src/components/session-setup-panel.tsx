import { useState } from "react";
import { useLocale } from "@/components/locale-context";
import type { PlayerSessionSetup } from "@/presenter/types";

interface SessionSetupPanelProps {
  readonly setup: PlayerSessionSetup;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly onSubmit: (selection: { agentSeatCount: number; accessMode?: "local" | "private-invite" }) => void;
}

export function SessionSetupPanel({ setup, isPending, error, onSubmit }: SessionSetupPanelProps) {
  const t = useLocale();
  const [agentSeatCount, setAgentSeatCount] = useState(0);
  const [privateInvite, setPrivateInvite] = useState(false);

  const maxAgentSeats = Math.min(setup.maxAgentSeats, setup.participantCount);
  const boundedAgentSeatCount = Math.min(agentSeatCount, maxAgentSeats);

  return (
    <section className="session-setup-panel" aria-labelledby="session-setup-title">
      <span className="runtime-status-kicker">{t.sessionSetupKicker}</span>
      <h1 id="session-setup-title">{t.sessionSetupTitle}</h1>
      <p>{t.sessionSetupDescription}</p>
      <p className="session-setup-fixed-count">
        {t.participantCountLabel}: <strong>{setup.participantCount}</strong>
      </p>

      <fieldset className="session-setup-choice">
        <legend>{t.participantModeLabel}</legend>
        <label>
          <input
            type="radio"
            name="participant-mode"
            checked={!privateInvite && boundedAgentSeatCount === 0}
            onChange={() => { setPrivateInvite(false); setAgentSeatCount(0); }}
            disabled={isPending}
          />
          {t.humanOnlyChoice}
        </label>
        <label>
          <input
            type="radio"
            name="participant-mode"
            checked={!privateInvite && boundedAgentSeatCount > 0}
            onChange={() => { setPrivateInvite(false); setAgentSeatCount(1); }}
            disabled={isPending || maxAgentSeats < 1}
          />
          {t.agentSeatChoice}
        </label>
        {setup.privateInviteAvailable === true ? <label>
          <input type="radio" name="participant-mode" checked={privateInvite} onChange={() => { setPrivateInvite(true); setAgentSeatCount(0); }} disabled={isPending} />
          {t.privateInviteChoice}
        </label> : null}
      </fieldset>

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
        onClick={() => onSubmit({ agentSeatCount: boundedAgentSeatCount, ...(privateInvite ? { accessMode: "private-invite" } : {}) })}
      >
        {isPending ? t.loading : t.startSession}
      </button>
      {error ? <p className="error session-setup-error" role="alert">{error}</p> : null}
    </section>
  );
}
