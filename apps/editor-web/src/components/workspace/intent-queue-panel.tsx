/**
 * Agent intent queue panel (ADR-057 §4.11; editor-preview-first-ux §9.5;
 * design-spec §2.4, §4 "intent-stale").
 *
 * Surfaces the session's AGENT intents — the queued AI jobs from the preview
 * entity/region prompt and the text-mode "apply as intent" — next to the session
 * edit journal (mockup zone 5 «Журнал»). Manual form edits never appear here:
 * they apply immediately and never queue (§9.5).
 *
 * Purely presentational: the queue data and the cancel / stale-resolution
 * callbacks come from the {@link EditorWorkspaceController}. Each row shows the
 * intent status in plain Russian; a `pending`/`running`/`stale` intent shows a
 * cancel button («отмена в полёте», §9.5); a `stale` intent (a journal edit
 * touched its read/write pointers) shows the author's choice: apply anyway or
 * cancel (§2.4).
 */
import React from "react";

import type { IntentQueueEntry, QueuedIntentStatus } from "@cubica/editor-engine";

/** Plain-Russian label for each intent status (§9.5 vocabulary). */
const STATUS_LABEL: Readonly<Record<QueuedIntentStatus, string>> = {
  pending: "ожидает",
  running: "выполняется",
  applying: "применяется",
  done: "готово",
  failed: "ошибка",
  cancelled: "отменён",
  stale: "устарел"
};

/** Statuses where the author may still cancel the intent in flight. */
const CANCELLABLE: ReadonlySet<QueuedIntentStatus> = new Set<QueuedIntentStatus>(["pending", "running", "stale"]);

export function IntentQueuePanel({
  intents,
  onCancelIntent,
  onResolveStaleIntent
}: {
  readonly intents: readonly IntentQueueEntry[];
  readonly onCancelIntent: (intentId: string) => void;
  readonly onResolveStaleIntent: (intentId: string, choice: "apply" | "cancel") => void;
}) {
  if (intents.length === 0) {
    return null;
  }

  return (
    <section className="intent-queue" data-testid="intent-queue" aria-label="Очередь агентских интентов">
      <div className="intent-queue-heading">
        <span>Агентские интенты</span>
      </div>
      <ul className="intent-queue-list">
        {intents.map((intent) => (
          <li
            key={intent.id}
            className={`intent-queue-item intent-queue-item-${intent.status}`}
            data-testid="intent-queue-item"
            data-intent-status={intent.status}
          >
            <span className="intent-queue-status">{STATUS_LABEL[intent.status]}</span>
            <span className="intent-queue-targets" title={intent.writePointers.join("\n")}>
              {intent.writePointers.length > 0
                ? `${intent.writePointers.length} цель${intent.writePointers.length === 1 ? "" : "и"}`
                : "контекст"}
            </span>
            {intent.status === "stale" ? (
              <span className="intent-queue-stale-choice">
                <button type="button" onClick={() => onResolveStaleIntent(intent.id, "apply")}>
                  Применить всё равно
                </button>
                <button type="button" onClick={() => onResolveStaleIntent(intent.id, "cancel")}>
                  Отменить
                </button>
              </span>
            ) : CANCELLABLE.has(intent.status) ? (
              <button type="button" className="intent-queue-cancel" onClick={() => onCancelIntent(intent.id)}>
                Отмена
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
