"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FacilitatorDebriefResponse,
  type FacilitatorDebriefDraft,
  validateFacilitatorDebriefResponseShape
} from "@cubica/contracts-session/facilitator-debrief";

export type FacilitatorDebriefFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface FacilitatorDebriefPanelProps {
  readonly sessionId: string;
  readonly expectedStateVersion: number;
  readonly fetchImpl?: FacilitatorDebriefFetch;
}

type PanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string; readonly method: "GET" | "POST" }
  | { readonly kind: "response"; readonly response: FacilitatorDebriefResponse };

const invalidResponseMessage = "Сервер вернул неподдерживаемый формат разбора.";
const mismatchedResponseMessage = "Сервер вернул разбор для другой сессии.";
const requestFailedMessage = "Не удалось загрузить разбор. Проверьте соединение и повторите попытку.";

function endpointFor(sessionId: string): string {
  return `/api/runtime/sessions/${encodeURIComponent(sessionId)}/facilitator-debrief`;
}

async function readValidatedResponse(
  response: Response,
  sessionId: string
): Promise<FacilitatorDebriefResponse> {
  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new Error(response.ok ? invalidResponseMessage : requestFailedMessage);
  }

  if (!validateFacilitatorDebriefResponseShape(body)) {
    throw new Error(response.ok ? invalidResponseMessage : requestFailedMessage);
  }
  if (body.sessionId !== sessionId) {
    throw new Error(mismatchedResponseMessage);
  }
  if (!response.ok) {
    throw new Error(requestFailedMessage);
  }
  return body;
}

function evidenceLabel(sequences: ReadonlyArray<number>): string {
  return sequences.join(", ");
}

function confidenceLabel(confidence: "low" | "medium" | "high"): string {
  switch (confidence) {
    case "high":
      return "высокая";
    case "medium":
      return "средняя";
    default:
      return "низкая";
  }
}

function Evidence({ sequences }: { readonly sequences: ReadonlyArray<number> }) {
  return <p className="facilitator-debrief-evidence">События: {evidenceLabel(sequences)}</p>;
}

function ReadyDebrief({ draft }: { readonly draft: FacilitatorDebriefDraft }) {
  return (
    <>
      <header>
        <h2>{draft.title}</h2>
        <p>{draft.summary}</p>
      </header>

      <section aria-labelledby="facilitator-debrief-facts-title">
        <h3 id="facilitator-debrief-facts-title">Факты игры</h3>
        <ul>
          {draft.facts.map((fact, index) => (
            <li key={`${fact.statement}-${index}`}>
              <p>{fact.statement}</p>
              <Evidence sequences={fact.eventSequences} />
            </li>
          ))}
        </ul>
      </section>

      {draft.interpretations.length > 0 ? (
        <section aria-labelledby="facilitator-debrief-interpretations-title">
          <h3 id="facilitator-debrief-interpretations-title">Интерпретации</h3>
          <ul>
            {draft.interpretations.map((interpretation, index) => (
              <li key={`${interpretation.statement}-${index}`}>
                <p>{interpretation.statement}</p>
                <p>Уверенность: {confidenceLabel(interpretation.confidence)}</p>
                <Evidence sequences={interpretation.eventSequences} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="facilitator-debrief-questions-title">
        <h3 id="facilitator-debrief-questions-title">Вопросы для рефлексии</h3>
        <ol>
          {draft.reflectionQuestions.map((item, index) => (
            <li key={`${item.question}-${index}`}>
              <p>{item.question}</p>
              <Evidence sequences={item.eventSequences} />
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export function FacilitatorDebriefPanel({
  sessionId,
  expectedStateVersion,
  fetchImpl
}: FacilitatorDebriefPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const mountedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const requestRef = useRef<{ readonly generation: number; readonly promise: Promise<void> } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const beginRequest = useCallback((method: "GET" | "POST") => {
    if (requestRef.current !== null) return;

    const generation = ++requestGenerationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "loading" });
    const isCurrentRequest = () =>
      mountedRef.current &&
      requestGenerationRef.current === generation &&
      requestRef.current?.generation === generation;
    const request = (async () => {
      try {
        const fetcher = fetchImpl ?? globalThis.fetch;
        const response = await fetcher(endpointFor(sessionId), {
          method,
          ...(method === "POST"
            ? {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expectedStateVersion })
              }
            : {}),
          signal: controller.signal,
          credentials: "same-origin"
        });
        const validated = await readValidatedResponse(response, sessionId);
        if (isCurrentRequest()) setState({ kind: "response", response: validated });
      } catch (error) {
        if (!isCurrentRequest() || (error instanceof DOMException && error.name === "AbortError")) return;
        setState({
          kind: "error",
          message: error instanceof Error && error.message !== "" ? error.message : requestFailedMessage,
          method
        });
      }
    })();
    requestRef.current = { generation, promise: request };
    void request.finally(() => {
      if (
        requestRef.current?.generation === generation &&
        requestRef.current.promise === request
      ) {
        requestRef.current = null;
        abortRef.current = null;
      }
    });
  }, [expectedStateVersion, fetchImpl, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    beginRequest("GET");
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      requestRef.current = null;
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort();
    };
  }, [beginRequest]);

  return (
    <section className="facilitator-debrief-panel" aria-labelledby="facilitator-debrief-panel-title">
      <span className="runtime-status-kicker">Для ведущего</span>
      <h1 id="facilitator-debrief-panel-title">Разбор игры</h1>

      {state.kind === "loading" ? (
        <p role="status" aria-live="polite">Разбор загружается…</p>
      ) : state.kind === "error" ? (
        <div role="alert" aria-live="assertive">
          <p>{state.message}</p>
          <button type="button" onClick={() => beginRequest(state.method)}>Повторить</button>
        </div>
      ) : state.response.status === "absent" ? (
        <section aria-labelledby="facilitator-debrief-absent-title">
          <h2 id="facilitator-debrief-absent-title">Разбор ещё не подготовлен</h2>
          <p>Сформируйте краткий разбор завершившейся игры с опорой на события сессии.</p>
          <button type="button" onClick={() => beginRequest("POST")} disabled={!state.response.canGenerate}>
            Сформировать разбор
          </button>
        </section>
      ) : state.response.status === "generating" ? (
        <section aria-labelledby="facilitator-debrief-generating-title" role="status" aria-live="polite">
          <h2 id="facilitator-debrief-generating-title">Разбор формируется</h2>
          <p>Подождите: ведущий получит разбор после обработки игровых событий.</p>
        </section>
      ) : state.response.status === "failed" ? (
        <section aria-labelledby="facilitator-debrief-failed-title" role="alert" aria-live="assertive">
          <h2 id="facilitator-debrief-failed-title">Не удалось подготовить разбор</h2>
          <p>{state.response.error?.message ?? requestFailedMessage}</p>
          <button type="button" onClick={() => beginRequest("POST")} disabled={!state.response.canGenerate}>Повторить</button>
        </section>
      ) : state.response.draft === undefined ? (
        <div role="alert" aria-live="assertive">
          <p>{invalidResponseMessage}</p>
        </div>
      ) : (
        <>
          <p className="facilitator-debrief-ai-notice" role="note">
            Этот текст создан ИИ и является черновиком: ведущий должен проверить его перед использованием.
          </p>
          <ReadyDebrief draft={state.response.draft} />
        </>
      )}
    </section>
  );
}
