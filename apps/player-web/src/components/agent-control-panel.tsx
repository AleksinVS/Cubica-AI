import type { AgentControl } from "@cubica/contracts-session";
import { useLocale } from "@/components/locale-context";

export function AgentControlPanel({
  control,
  invalid = false,
  onRefresh
}: {
  readonly control?: AgentControl;
  readonly invalid?: boolean;
  readonly onRefresh: () => void;
}) {
  const t = useLocale();
  if (invalid) {
    return (
      <section className="agent-control-panel agent-control-paused" role="alert" aria-live="polite">
        <span className="runtime-status-kicker">{t.agentControlKicker}</span>
        <h1>{t.agentControlIntegrityTitle}</h1>
        <p>{t.agentControlIntegrityDescription}</p>
        <button className="action-button" type="button" onClick={onRefresh}>{t.retry}</button>
      </section>
    );
  }

  if (control === undefined) {
    return null;
  }

  const reason = t.agentControlReasons[control.reasonCode];

  if (control.status === "paused") {
    return (
      <section className="agent-control-panel agent-control-paused" role="alert" aria-live="polite">
        <span className="runtime-status-kicker">{t.agentControlKicker}</span>
        <h1>{t.agentPausedTitle}</h1>
        <p>{t.agentPausedDescription}</p>
        <p className="runtime-status-reason">{reason}</p>
        <button className="action-button" type="button" onClick={onRefresh}>{t.retry}</button>
      </section>
    );
  }

  return (
    <section className="agent-control-panel agent-control-takeover" role="status" aria-live="polite">
      <span className="runtime-status-kicker">{t.agentControlKicker}</span>
      <h1>{t.agentTakeoverTitle}</h1>
      <p>{t.agentTakeoverDescription}</p>
      <p className="runtime-status-reason">{reason}</p>
    </section>
  );
}
