import type { SessionAiDebriefSections } from "@cubica/contracts-ai";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import type { PortablePublicGameplayJournal } from "@cubica/contracts-session";
import { HttpError } from "../errors.ts";

export class SessionAiDebriefEvidenceError extends HttpError {
  constructor(message: string) {
    super(502, message, "PROVIDER_FALSE_EVIDENCE");
  }
}

/** Cross-document checks kept separate from JSON Schema shape validation. */
export function assertSessionAiDebriefSectionsSemantics(
  sections: SessionAiDebriefSections,
  journal: PortablePublicGameplayJournal,
  profile: GameManifestAiDebriefProfile
): void {
  if (
    sections.facts.length > profile.limits.maxFacts ||
    sections.interpretations.length > profile.limits.maxInterpretations ||
    sections.facilitatorQuestions.length > profile.limits.maxQuestions
  ) {
    throw new SessionAiDebriefEvidenceError("The AI debrief exceeded the published methodology limits.");
  }
  const eventIds = new Set(journal.entries.map((entry) => entry.eventId));
  for (const fact of sections.facts) {
    if (fact.evidenceEventIds.some((eventId) => !eventIds.has(eventId))) {
      throw new SessionAiDebriefEvidenceError("The AI debrief cited an event outside its pinned journal.");
    }
  }
}
