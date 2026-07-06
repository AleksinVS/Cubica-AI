import type { GameManifestAgentFailurePolicy } from "@cubica/contracts-manifest";
import type { PlayerRuntimeStatus } from "@/presenter/types";
import { useLocale } from "@/components/locale-context";

interface RuntimeStatusPanelProps {
  readonly status: PlayerRuntimeStatus;
  readonly reason: string | null;
  readonly failurePolicy: GameManifestAgentFailurePolicy | null;
  readonly agentRuntimeRequired: boolean;
  readonly onRetry: () => void;
}

/**
 * Blocking runtime status screen.
 *
 * Runtime status is a player-facing dependency state, not a gameplay screen.
 * AI-driven games use it to pause safely when the server-side AI agent boundary
 * is unavailable instead of falling back to deterministic gameplay implicitly.
 */
export function RuntimeStatusPanel({
  status,
  reason,
  failurePolicy,
  agentRuntimeRequired,
  onRetry
}: RuntimeStatusPanelProps) {
  const t = useLocale();

  if (status === "booting") {
    return (
      <div className="loading-state" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <span>{t.loading}</span>
      </div>
    );
  }

  const title = status === "paused"
    ? t.runtimePausedTitle
    : status === "retry"
      ? t.runtimeRetryTitle
      : t.runtimeUnavailableTitle;

  const description = agentRuntimeRequired
    ? t.runtimeAgentRequiredDescription
    : t.runtimeGenericUnavailableDescription;

  return (
    <section className="runtime-status-panel" aria-live="polite">
      <div className="runtime-status-copy">
        <span className="runtime-status-kicker">{t.runtimeStatusKicker}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {failurePolicy ? (
          <p className="runtime-status-policy">
            {t.runtimeFailurePolicy}: <strong>{failurePolicy}</strong>
          </p>
        ) : null}
        {reason ? <p className="runtime-status-reason">{reason}</p> : null}
      </div>
      <button className="action-button runtime-status-retry" type="button" onClick={onRetry}>
        {t.retry}
      </button>
    </section>
  );
}
