"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { validateSessionAiDebriefArtifact, type SessionAiDebriefArtifact } from "@cubica/contracts-ai";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import {
  validatePortablePublicGameplayJournal,
  type PortablePublicGameplayJournalEntry,
  type SessionRole
} from "@cubica/contracts-session";
import type { PlayerRuntimeStatus } from "@/presenter/types";
import { useLocale } from "@/components/locale-context";

type SessionAiDebriefPanelProps = {
  readonly sessionId: string | null;
  readonly runtimeStatus: PlayerRuntimeStatus;
  readonly viewerRole?: SessionRole;
  readonly profile?: GameManifestAiDebriefProfile;
};

type LoadState = "idle" | "loading" | "ready";

const journalHref = (sessionId: string) =>
  `/api/runtime/sessions/${encodeURIComponent(sessionId)}/public-journal`;

const isArtifact = (value: unknown): value is SessionAiDebriefArtifact =>
  validateSessionAiDebriefArtifact(value);

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function SessionAiDebriefPanel({
  sessionId,
  runtimeStatus,
  viewerRole,
  profile
}: SessionAiDebriefPanelProps) {
  const t = useLocale();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const regenerateRef = useRef<HTMLButtonElement>(null);
  const eventRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const focusAfterActionRef = useRef<"status" | "regenerate" | null>(null);
  const requestGeneration = useRef(0);
  const latestController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const journalController = useRef<AbortController | null>(null);
  const journalGeneration = useRef(0);
  const loadedSessionId = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [artifact, setArtifact] = useState<SessionAiDebriefArtifact | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [busyAction, setBusyAction] = useState<"generate" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAction, setErrorAction] = useState<"load" | "generate" | "confirm">("load");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [journalEntry, setJournalEntry] = useState<PortablePublicGameplayJournalEntry | null>(null);
  const [journalBusy, setJournalBusy] = useState<string | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);

  const eligible = viewerRole === "facilitator" &&
    profile !== undefined &&
    runtimeStatus === "ready" &&
    typeof sessionId === "string" &&
    sessionId.trim() !== "";

  const loadLatest = useCallback(async () => {
    if (!eligible || sessionId === null) return;
    const requestSessionId = sessionId;
    const generation = ++requestGeneration.current;
    latestController.current?.abort();
    const controller = new AbortController();
    latestController.current = controller;
    setLoadState("loading");
    setError(null);
    setErrorAction("load");
    try {
      const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}/ai-debriefs/latest`, {
        credentials: "same-origin",
        signal: controller.signal
      });
      if (requestGeneration.current !== generation || requestSessionId !== sessionId) return;
      if (response.status === 404) {
        setArtifact(null);
        setLoadState("ready");
        return;
      }
      if (!response.ok) throw new Error("latest request failed");
      const value = await readResponse(response);
      if (!isArtifact(value) || value.sessionId !== requestSessionId) throw new Error("latest response invalid");
      setArtifact(value);
      setLoadState("ready");
    } catch {
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      setLoadState("ready");
      setErrorAction("load");
      setError(t.aiDebriefErrorLoad);
    }
  }, [eligible, sessionId, t.aiDebriefErrorLoad]);

  useEffect(() => {
    requestGeneration.current += 1;
    latestController.current?.abort();
    actionController.current?.abort();
    journalController.current?.abort();
    journalGeneration.current += 1;
    loadedSessionId.current = null;
    focusAfterActionRef.current = null;
    setArtifact(null);
    setError(null);
    setStatusMessage(null);
    setLoadState("idle");
    setBusyAction(null);
    setJournalEntry(null);
    setJournalBusy(null);
    setJournalError(null);
    setOpen(false);
  }, [eligible, profile?.methodologyVersion, sessionId]);

  useEffect(() => {
    if (!eligible || sessionId === null || loadedSessionId.current === sessionId) return;
    loadedSessionId.current = sessionId;
    void loadLatest();
  }, [eligible, loadLatest]);

  useEffect(() => () => {
    requestGeneration.current += 1;
    latestController.current?.abort();
    actionController.current?.abort();
    journalGeneration.current += 1;
    journalController.current?.abort();
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      else triggerRef.current?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const backdrop = backdropRef.current;
    const container = backdrop?.parentElement;
    if (backdrop === null || container === null || backdrop === undefined || container === undefined) return;
    const background = Array.from(container.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden")
      }));
    for (const item of background) {
      item.element.inert = true;
      item.element.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const item of background) {
        item.element.inert = item.inert;
        if (item.ariaHidden === null) item.element.removeAttribute("aria-hidden");
        else item.element.setAttribute("aria-hidden", item.ariaHidden);
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanel();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          ".session-ai-debrief-dialog button:not([disabled]), .session-ai-debrief-dialog a[href], .session-ai-debrief-dialog summary"
        ) ?? []);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel, open]);

  useEffect(() => {
    if (open && focusAfterActionRef.current !== null && artifact !== null && busyAction === null) {
      const target = focusAfterActionRef.current;
      focusAfterActionRef.current = null;
      if (target === "status") {
        dialogRef.current?.scrollTo({ top: 0 });
        statusRef.current?.focus({ preventScroll: true });
      } else {
        regenerateRef.current?.focus();
      }
    }
  }, [artifact, busyAction, open]);

  useEffect(() => {
    if (journalEntry !== null) eventRef.current?.focus();
  }, [journalEntry]);

  if (!eligible || profile === undefined || sessionId === null) return null;

  const generate = async () => {
    const requestSessionId = sessionId;
    const generation = ++requestGeneration.current;
    latestController.current?.abort();
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const requestId = crypto.randomUUID();
    setBusyAction("generate");
    setError(null);
    setErrorAction("generate");
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/runtime/sessions/${encodeURIComponent(sessionId)}/ai-debriefs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ requestId }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("generate failed");
      const value = await readResponse(response);
      if (requestGeneration.current !== generation || requestSessionId !== sessionId) return;
      if (
        !isArtifact(value) ||
        value.sessionId !== requestSessionId ||
        value.requestId !== requestId ||
        value.status !== "draft"
      ) {
        throw new Error("generate response invalid");
      }
      focusAfterActionRef.current = "status";
      setArtifact(value);
      setJournalEntry(null);
      setJournalError(null);
      setLoadState("ready");
      setStatusMessage(t.aiDebriefDraftCreated);
    } catch {
      if (controller.signal.aborted || requestGeneration.current !== generation || requestSessionId !== sessionId) return;
      setErrorAction("generate");
      setError(t.aiDebriefErrorGenerate);
    } finally {
      if (requestGeneration.current === generation) setBusyAction(null);
    }
  };

  const confirm = async () => {
    if (artifact === null || artifact.status === "confirmed") return;
    const requestSessionId = sessionId;
    const generation = ++requestGeneration.current;
    latestController.current?.abort();
    actionController.current?.abort();
    const controller = new AbortController();
    actionController.current = controller;
    const artifactToConfirm = artifact;
    setBusyAction("confirm");
    setError(null);
    setErrorAction("confirm");
    setStatusMessage(null);
    try {
      const response = await fetch(
        `/api/runtime/sessions/${encodeURIComponent(requestSessionId)}/ai-debriefs/${encodeURIComponent(artifactToConfirm.artifactId)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ outputSha256: artifactToConfirm.outputSha256 }),
          signal: controller.signal
        }
      );
      if (!response.ok) throw new Error("confirm failed");
      const value = await readResponse(response);
      if (requestGeneration.current !== generation || requestSessionId !== sessionId) return;
      if (
        !isArtifact(value) ||
        value.sessionId !== requestSessionId ||
        value.artifactId !== artifactToConfirm.artifactId ||
        value.outputSha256 !== artifactToConfirm.outputSha256 ||
        value.status !== "confirmed"
      ) {
        throw new Error("confirm response invalid");
      }
      focusAfterActionRef.current = "regenerate";
      setArtifact(value);
      setStatusMessage(t.aiDebriefConfirmationSaved);
    } catch {
      if (controller.signal.aborted || requestGeneration.current !== generation || requestSessionId !== sessionId) return;
      setErrorAction("confirm");
      setError(t.aiDebriefErrorConfirm);
    } finally {
      if (requestGeneration.current === generation) setBusyAction(null);
    }
  };

  const openEvidence = async (eventId: string) => {
    const generation = ++journalGeneration.current;
    journalController.current?.abort();
    const controller = new AbortController();
    journalController.current = controller;
    setJournalBusy(eventId);
    setJournalError(null);
    try {
      const response = await fetch(journalHref(sessionId), {
        credentials: "same-origin",
        signal: controller.signal
      });
      if (!response.ok) throw new Error("journal request failed");
      const value = await readResponse(response);
      if (!validatePortablePublicGameplayJournal(value) || value.sessionId !== sessionId) {
        throw new Error("journal response invalid");
      }
      const entry = value.entries.find((candidate) => candidate.eventId === eventId);
      if (entry === undefined) throw new Error("journal event missing");
      if (journalGeneration.current !== generation) return;
      setJournalEntry(entry);
    } catch {
      if (controller.signal.aborted || journalGeneration.current !== generation) return;
      setJournalError(t.aiDebriefErrorEvidence);
    } finally {
      if (journalGeneration.current === generation) setJournalBusy(null);
    }
  };

  const statusText = artifact?.status === "confirmed" ? t.aiDebriefConfirmed : t.aiDebriefDraft;
  const actionDisabled = busyAction !== null || loadState === "loading";

  return (
    <>
      <button
        ref={triggerRef}
        className="session-ai-debrief-trigger"
        type="button"
        onClick={() => {
          previousFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement
            : triggerRef.current;
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        {t.aiDebriefEntry}
      </button>
      {open ? (
        <div ref={backdropRef} className="session-ai-debrief-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closePanel();
        }}>
          <section
            ref={dialogRef}
            className="session-ai-debrief-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-ai-debrief-title"
            aria-describedby="session-ai-debrief-description"
          >
            <div className="session-ai-debrief-header">
              <div>
                <span className="runtime-status-kicker">{t.aiDebriefEntry}</span>
                <h2 id="session-ai-debrief-title">{t.aiDebriefTitle}</h2>
                <p id="session-ai-debrief-description">{t.aiDebriefDescription}</p>
              </div>
              <button ref={closeRef} type="button" onClick={closePanel}>{t.aiDebriefClose}</button>
            </div>
            {loadState === "loading" ? <p role="status" aria-live="polite">{t.aiDebriefLoad}</p> : null}
            {error ? (
              <div className="session-ai-debrief-error" role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (errorAction === "generate") void generate();
                    else if (errorAction === "confirm") void confirm();
                    else void loadLatest();
                  }}
                  disabled={actionDisabled}
                >{t.aiDebriefRetryLoad}</button>
              </div>
            ) : null}
            {statusMessage ? (
              <p ref={statusRef} className="session-ai-debrief-status" role="status" aria-live="polite" tabIndex={-1}>
                {statusMessage}
              </p>
            ) : null}
            {loadState === "loading" ? null : artifact === null ? (
              <div className="session-ai-debrief-empty">
                <p>{t.aiDebriefEmpty}</p>
                <button type="button" onClick={() => void generate()} disabled={actionDisabled}>
                  {busyAction === "generate" ? t.aiDebriefGenerating : t.aiDebriefGenerate}
                </button>
              </div>
            ) : (
              <>
                <div className="session-ai-debrief-status-badge" aria-label={statusText}>{statusText}</div>
                <section aria-labelledby="session-ai-debrief-facts">
                  <h3 id="session-ai-debrief-facts">{t.aiDebriefFacts}</h3>
                  <p className="session-ai-debrief-section-note">{t.aiDebriefEvidenceBacked}</p>
                  <ul>
                    {artifact.sections.facts.map((fact) => (
                      <li key={`${fact.statement}-${fact.evidenceEventIds.join("|")}`}>
                        <p>{fact.statement}</p>
                        <div className="session-ai-debrief-evidence" aria-label={t.aiDebriefEvidence}>
                          {fact.evidenceEventIds.map((eventId) => (
                            <button
                              key={eventId}
                              type="button"
                              onClick={() => void openEvidence(eventId)}
                              disabled={actionDisabled || journalBusy !== null}
                              aria-label={`${t.aiDebriefOpenEvidence}: ${eventId}`}
                            ><code>{eventId}</code></button>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
                <section aria-labelledby="session-ai-debrief-interpretations">
                  <h3 id="session-ai-debrief-interpretations">{t.aiDebriefInterpretations}</h3>
                  {artifact.sections.interpretations.length > 0 ? (
                    <ul>{artifact.sections.interpretations.map((item, index) => (
                      <li key={`${item.statement}-${index}`}>
                        <span className="session-ai-debrief-hypothesis-label">{t.aiDebriefHypothesis}</span> {item.statement}
                      </li>
                    ))}</ul>
                  ) : <p>{t.aiDebriefNoInterpretations}</p>}
                </section>
                <a className="session-ai-debrief-journal-link" href={journalHref(sessionId)} download>{t.downloadJournal}</a>
                {journalBusy ? <p role="status" aria-live="polite">{t.aiDebriefLoadingEvidence}</p> : null}
                {journalError ? <p className="session-ai-debrief-error" role="alert">{journalError}</p> : null}
                {journalEntry ? (
                  <article ref={eventRef} className="session-ai-debrief-event" tabIndex={-1} aria-labelledby="session-ai-debrief-event-heading">
                    <h4 id="session-ai-debrief-event-heading">{t.aiDebriefEventHeading} <code>{journalEntry.eventId}</code></h4>
                    <dl>
                      <dt>{t.aiDebriefEventType}</dt><dd><code>{journalEntry.eventType}</code></dd>
                      <dt>{t.aiDebriefEventSequence}</dt><dd>{journalEntry.sequence}</dd>
                      <dt>{t.aiDebriefEventTime}</dt><dd>{journalEntry.occurredAt}</dd>
                    </dl>
                    <p>{typeof journalEntry.summary === "string" ? journalEntry.summary : JSON.stringify(journalEntry.summary)}</p>
                  </article>
                ) : null}
                <section aria-labelledby="session-ai-debrief-questions">
                  <h3 id="session-ai-debrief-questions">{t.aiDebriefQuestions}</h3>
                  <ol>{artifact.sections.facilitatorQuestions.map((item, index) => <li key={`${item.question}-${index}`}>{item.question}</li>)}</ol>
                </section>
                <details>
                  <summary>{t.aiDebriefProvenance}</summary>
                  <dl>
                    <dt>{t.aiDebriefThroughEvent}</dt><dd>{artifact.provenance.throughEventSequence}</dd>
                    <dt>{t.aiDebriefJournalHash}</dt><dd><code>{artifact.provenance.journalSha256}</code></dd>
                    <dt>{t.aiDebriefMethodology}</dt><dd><code>{artifact.provenance.methodologyVersion}</code></dd>
                    <dt>{t.aiDebriefPrompt}</dt><dd><code>{artifact.provenance.promptVersion}</code></dd>
                    <dt>{t.aiDebriefProvider}</dt><dd><code>{artifact.provenance.provider}</code></dd>
                    <dt>{t.aiDebriefModel}</dt><dd><code>{artifact.provenance.model}</code></dd>
                    <dt>{t.aiDebriefTokens}</dt><dd>{artifact.provenance.usage.inputTokens} / {artifact.provenance.usage.outputTokens} / {artifact.provenance.usage.totalTokens}</dd>
                    <dt>{t.aiDebriefOutputHash}</dt><dd><code>{artifact.outputSha256}</code></dd>
                  </dl>
                </details>
                <div className="session-ai-debrief-actions">
                  <button ref={regenerateRef} type="button" onClick={() => void generate()} disabled={actionDisabled}>
                    {busyAction === "generate" ? t.aiDebriefGenerating : t.aiDebriefRegenerate}
                  </button>
                  {artifact.status === "draft" ? (
                    <button type="button" onClick={() => void confirm()} disabled={actionDisabled}>
                      {busyAction === "confirm" ? t.aiDebriefConfirming : t.aiDebriefConfirm}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
