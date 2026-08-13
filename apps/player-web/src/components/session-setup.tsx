"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/components/locale-context";

export interface SessionSetupProps {
  readonly min: number;
  readonly max: number;
  readonly onConfirm: (participantCount: number) => void;
}

/** Neutral preparation screen used before the first fresh local session. */
export function SessionSetup({ min, max, onConfirm }: SessionSetupProps) {
  const t = useLocale();
  const [participantCount, setParticipantCount] = useState(String(min));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = Number(participantCount);
    if (Number.isSafeInteger(selected) && selected >= min && selected <= max) {
      onConfirm(selected);
    }
  };

  return (
    <main className="shell game-player-root session-setup" aria-labelledby="session-setup-title">
      <section className="session-setup-panel">
        <p className="session-setup-kicker">{t.sessionSetupKicker}</p>
        <h1 id="session-setup-title">{t.sessionSetupTitle}</h1>
        <p id="session-setup-description">{t.sessionSetupDescription}</p>
        <form onSubmit={submit}>
          <label htmlFor="participant-count">{t.sessionSetupParticipants}</label>
          <select
            id="participant-count"
            name="participantCount"
            value={participantCount}
            onChange={(event) => setParticipantCount(event.target.value)}
            aria-describedby="session-setup-description"
          >
            {Array.from({ length: max - min + 1 }, (_, index) => {
              const count = min + index;
              return <option key={count} value={count}>{count}</option>;
            })}
          </select>
          <button type="submit">{t.sessionSetupStart}</button>
        </form>
      </section>
    </main>
  );
}
