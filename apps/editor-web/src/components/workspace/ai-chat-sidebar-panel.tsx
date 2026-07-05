/**
 * Fallback AI chat sidebar panel.
 *
 * Rendered when the CopilotKit-backed chat is unavailable. Presents the current
 * AI apply state, the active selection, the last prompt/diff, and any prototype
 * extraction proposal (with a button to promote it into a planned ChangeSet).
 * Purely presentational — all data and callbacks come from `EditorWorkspace`.
 */
import type { EditorDiffSummaryItem } from "@cubica/editor-engine";

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
        <strong>AI Chat</strong>
        <button type="button" onClick={onCollapse}>
          Collapse
        </button>
      </div>
      <div className="ai-sidebar-body">
        <section>
          <span>State</span>
          <strong>{aiApplyState}</strong>
        </section>
        <section>
          <span>Selection</span>
          <strong>{selectedNodeTitle ?? "none"}</strong>
        </section>
        {proposedIntent !== null ? (
          <section>
            <span>Last prompt</span>
            <p>{proposedIntent.prompt}</p>
          </section>
        ) : null}
        {aiDiffSummary.length > 0 ? (
          <section>
            <span>Last diff</span>
            {aiDiffSummary.slice(0, 5).map((item, index) => (
              <p key={`${item.description}-${index}`}>{item.description}</p>
            ))}
          </section>
        ) : null}
        {prototypeExtractionProposal !== null ? (
          <section>
            <span>Prototype proposal</span>
            <strong>{prototypeExtractionProposal.proposal.definitionType}</strong>
            <p>{prototypeExtractionProposal.proposal.definitionPointer}</p>
            {prototypeExtractionProposal.gates.slice(0, 6).map((gate) => (
              <p key={gate.id}>{gate.label}: {gate.ok ? "OK" : "blocked"}</p>
            ))}
            <div className="ai-sidebar-actions">
              <button
                type="button"
                disabled={!prototypeProposalReady || aiApplyState === "planning" || aiApplyState === "applying"}
                onClick={onUsePrototypeProposal}
              >
                Use as planned ChangeSet
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
