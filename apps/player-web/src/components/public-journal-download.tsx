import type { PlayerState } from "@/presenter/types";
import { useLocale } from "@/components/locale-context";

export type PublicJournalDownloadProps = Pick<PlayerState, "sessionId" | "runtimeStatus">;

/**
 * One game-neutral download affordance for the server-authoritative journal.
 * The link is intentionally absent until the session has a usable credential
 * and the presenter has reached its ready state.
 */
export function PublicJournalDownload({
  sessionId,
  runtimeStatus
}: PublicJournalDownloadProps) {
  const t = useLocale();
  if (runtimeStatus !== "ready" || typeof sessionId !== "string" || sessionId.trim() === "") {
    return null;
  }

  return (
    <a
      className="public-journal-download"
      href={`/api/runtime/sessions/${encodeURIComponent(sessionId)}/public-journal`}
      download
    >
      {t.downloadJournal}
    </a>
  );
}
