import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FacilitatorDebriefFetch, FacilitatorDebriefPanelProps } from "./facilitator-debrief-panel";
import { FacilitatorDebriefPanel } from "./facilitator-debrief-panel";

const base = {
  format: "cubica.facilitator-debrief",
  schemaVersion: "1.0.0",
  sessionId: "session-debrief",
  gameId: "neutral-game"
} as const;

const absent = { ...base, status: "absent", canGenerate: true } as const;
const ready = {
  ...base,
  status: "ready",
  canGenerate: false,
  runId: "debrief_fixture123",
  requestedAt: "2026-08-27T10:00:00.000Z",
  completedAt: "2026-08-27T10:00:20.000Z",
  journalSha256: `sha256:${"a".repeat(64)}`,
  throughEventSequence: 2,
  provider: "z.ai",
  model: "glm-4.7",
  promptVersion: "facilitator-debrief-ru-v1",
  draft: {
    title: "Путь к решению",
    summary: "Команда завершила раунд и изменила план.",
    facts: [{ statement: "Раунд завершён.", eventSequences: [2] }],
    interpretations: [{
      statement: "Решение могло снизить риск.",
      confidence: "low",
      eventSequences: [1, 2]
    }],
    reflectionQuestions: [{ question: "Что повлияло на решение?", eventSequences: [1] }]
  }
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function renderPanel(fetchImpl: FacilitatorDebriefFetch) {
  const props: FacilitatorDebriefPanelProps = {
    sessionId: "session-debrief",
    expectedStateVersion: 7,
    fetchImpl
  };
  return render(<FacilitatorDebriefPanel {...props} />);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("FacilitatorDebriefPanel", () => {
  it("loads absent state and starts generation with the exact version body", async () => {
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>()
      .mockResolvedValueOnce(jsonResponse(absent))
      .mockResolvedValueOnce(jsonResponse({
        ...base,
        status: "generating",
        canGenerate: false,
        runId: "debrief_fixture123",
        requestedAt: "2026-08-27T10:00:00.000Z",
        journalSha256: `sha256:${"a".repeat(64)}`,
        throughEventSequence: 2,
        provider: "z.ai",
        model: "glm-4.7",
        promptVersion: "facilitator-debrief-ru-v1"
      }));

    renderPanel(fetchImpl);
    await waitFor(() => expect(screen.getByRole("button", { name: "Сформировать разбор" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Сформировать разбор" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Разбор формируется" })).toBeTruthy());

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "/api/runtime/sessions/session-debrief/facilitator-debrief"
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({ expectedStateVersion: 7 });
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("renders ready content, confidence text, and event evidence as text", async () => {
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>().mockResolvedValue(jsonResponse(ready));
    renderPanel(fetchImpl);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Путь к решению" })).toBeTruthy());
    expect(screen.getByText("Команда завершила раунд и изменила план.")).toBeTruthy();
    expect(screen.getByText("Раунд завершён.")).toBeTruthy();
    expect(screen.getByText("Уверенность: низкая")).toBeTruthy();
    expect(screen.getAllByText("События: 1, 2").length).toBe(1);
    expect(screen.getByText("Что повлияло на решение?")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Факты игры" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Вопросы для рефлексии" })).toBeTruthy();
    expect(screen.getByText("Этот текст создан ИИ и является черновиком: ведущий должен проверить его перед использованием.")).toBeTruthy();
  });

  it("shows failed status and allows a manual retry", async () => {
    const failed = {
      ...base,
      status: "failed",
      canGenerate: true,
      runId: "debrief_fixture123",
      requestedAt: "2026-08-27T10:00:00.000Z",
      completedAt: "2026-08-27T10:00:20.000Z",
      journalSha256: `sha256:${"a".repeat(64)}`,
      throughEventSequence: 2,
      provider: "z.ai",
      model: "glm-4.7",
      promptVersion: "facilitator-debrief-ru-v1",
      error: { code: "provider_timeout", message: "Провайдер не ответил вовремя." }
    } as const;
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>()
      .mockResolvedValueOnce(jsonResponse(failed))
      .mockResolvedValueOnce(jsonResponse(absent));
    renderPanel(fetchImpl);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Не удалось подготовить разбор" })).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Провайдер не ответил вовремя.");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сформировать разбор" })).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed for an invalid response and does not render response markup", async () => {
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>().mockResolvedValue(
      jsonResponse({ ...absent, summary: "<strong>не HTML</strong>" })
    );
    renderPanel(fetchImpl);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("неподдерживаемый формат");
    expect(screen.queryByRole("heading", { name: "не HTML" })).toBeNull();
  });

  it("does not issue concurrent POST requests on repeated clicks", async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const postResponse = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>()
      .mockResolvedValueOnce(jsonResponse(absent))
      .mockReturnValueOnce(postResponse);
    renderPanel(fetchImpl);
    await waitFor(() => expect(screen.getByRole("button", { name: "Сформировать разбор" })).toBeTruthy());
    const button = screen.getByRole("button", { name: "Сформировать разбор" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resolvePost?.(jsonResponse({ ...base, status: "generating", canGenerate: false, runId: "debrief_fixture123", requestedAt: "2026-08-27T10:00:00.000Z", journalSha256: `sha256:${"a".repeat(64)}`, throughEventSequence: 2, provider: "z.ai", model: "glm-4.7", promptVersion: "facilitator-debrief-ru-v1" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Разбор формируется" })).toBeTruthy());
  });

  it("starts a fresh GET after StrictMode effect cleanup", async () => {
    const requests: Array<ReturnType<typeof deferred<Response>>> = [];
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>(() => {
      const pending = deferred<Response>();
      requests.push(pending);
      return pending.promise;
    });

    render(
      <StrictMode>
        <FacilitatorDebriefPanel sessionId="session-debrief" expectedStateVersion={7} fetchImpl={fetchImpl} />
      </StrictMode>
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await act(async () => requests[1]?.resolve(jsonResponse(absent)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сформировать разбор" })).toBeTruthy());
  });

  it("ignores an old response after rerendering to another session even when abort is ignored", async () => {
    const oldRequest = deferred<Response>();
    const newRequest = deferred<Response>();
    const newReady = { ...ready, sessionId: "session-new", draft: { ...ready.draft, title: "Новый разбор" } };
    const oldReady = { ...ready, draft: { ...ready.draft, title: "Устаревший разбор" } };
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const view = renderPanel(fetchImpl);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    view.rerender(
      <FacilitatorDebriefPanel sessionId="session-new" expectedStateVersion={7} fetchImpl={fetchImpl} />
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await act(async () => newRequest.resolve(jsonResponse(newReady)));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Новый разбор" })).toBeTruthy());
    await act(async () => oldRequest.resolve(jsonResponse(oldReady)));
    expect(screen.getByRole("heading", { name: "Новый разбор" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Устаревший разбор" })).toBeNull();
  });

  it("rejects a validly shaped response bound to another session", async () => {
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>().mockResolvedValue(
      jsonResponse({ ...absent, sessionId: "session-other" })
    );
    renderPanel(fetchImpl);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("другой сессии");
    expect(screen.queryByRole("button", { name: "Сформировать разбор" })).toBeNull();
  });

  it("retries a transport GET failure with GET rather than POST", async () => {
    const fetchImpl = vi.fn<FacilitatorDebriefFetch>()
      .mockRejectedValueOnce(new Error("Сеть недоступна"))
      .mockResolvedValueOnce(jsonResponse(absent));
    renderPanel(fetchImpl);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Сформировать разбор" })).toBeTruthy());
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET"]);
  });
});
