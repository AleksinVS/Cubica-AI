/**
 * Fallback AI chat sidebar panel.
 *
 * Rendered when the CopilotKit-backed chat is unavailable. Presents the current
 * AI apply state, the active selection, the last prompt/diff, and any prototype
 * extraction proposal (with a button to promote it into a planned ChangeSet).
 * Purely presentational — all data and callbacks come from `EditorWorkspace`.
 */
import type { EditorDiffSummaryItem } from "@cubica/editor-engine";

import { editorRu as t } from "@/lib/locale";
import type { PreviewAiIntent } from "@/components/preview-selection-overlay";

import { prototypeProposalGatesPassed } from "./agent-surface.ts";
import type { PlannedPrototypeExtractionProposal } from "./types.ts";

export function AiChatSidebarPanel({
  proposedIntent,
  aiApplyState,
  aiDiffSummary,
  prototypeExtractionProposal,
  selectedNodeTitle,
  onUsePrototypeProposal,
  onCollapse
}: {
  readonly proposedIntent: PreviewAiIntent | null;
  readonly aiApplyState: "idle" | "planning" | "applying" | "applied" | "blocked" | "error" | "undone";
  readonly aiDiffSummary: readonly EditorDiffSummaryItem[];
  readonly prototypeExtractionProposal: PlannedPrototypeExtractionProposal | null;
  readonly selectedNodeTitle: string | undefined;
  readonly onUsePrototypeProposal: () => void;
  readonly onCollapse: () => void;
}) {
  const prototypeProposalReady = prototypeExtractionProposal === null ? false : prototypeProposalGatesPassed(prototypeExtractionProposal);

  return (
    <>
      <div className="panel-heading">
        <strong>{t.aiChat.title}</strong>
        <button type="button" onClick={onCollapse}>
          {t.common.collapse}
        </button>
      </div>
      <div className="ai-sidebar-body">
        <section>
          <span>{t.aiChat.state}</span>
          <strong>{t.statusBar.aiStateLabel[aiApplyState] ?? aiApplyState}</strong>
        </section>
        <section>
          <span>{t.aiChat.selection}</span>
          <strong>{selectedNodeTitle ?? t.common.none}</strong>
        </section>
        {proposedIntent !== null ? (
          <section>
            <span>{t.aiChat.lastPrompt}</span>
            <p>{proposedIntent.prompt}</p>
          </section>
        ) : null}
        {aiDiffSummary.length > 0 ? (
          <section>
            <span>{t.aiChat.lastDiff}</span>
            {aiDiffSummary.slice(0, 5).map((item, index) => (
              <p key={`${item.description}-${index}`}>{item.description}</p>
            ))}
          </section>
        ) : null}
        {prototypeExtractionProposal !== null ? (
          <section>
            <span>{t.aiChat.prototypeProposal}</span>
            <strong>{prototypeExtractionProposal.proposal.definitionType}</strong>
            <p>{prototypeExtractionProposal.proposal.definitionPointer}</p>
            {prototypeExtractionProposal.gates.slice(0, 6).map((gate) => (
              <p key={gate.id}>{gate.label}: {gate.ok ? t.aiChat.ok : t.aiChat.blocked}</p>
            ))}
            <div className="ai-sidebar-actions">
              <button
                type="button"
                disabled={!prototypeProposalReady || aiApplyState === "planning" || aiApplyState === "applying"}
                onClick={onUsePrototypeProposal}
              >
                {t.aiChat.useAsPlanned}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
