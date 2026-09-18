import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameManifestAiDebriefProfile } from "@cubica/contracts-manifest";
import { SessionAiDebriefPanel } from "./session-ai-debrief-panel";
import { PublicJournalDownload } from "./public-journal-download";

const profile: GameManifestAiDebriefProfile = {
  format: "cubica.session-ai-debrief-profile",
  schemaVersion: "1.0.0",
  methodologyVersion: "cmt-final-reflection-v1",
  locale: "ru-RU",
  purpose: "Проверяемая рефлексия по журналу.",
  analysisInstructions: ["Используй только события журнала."],
  facilitatorQuestionGuide: ["Что вы наблюдаете?"],
  limits: { maxFacts: 4, maxInterpretations: 4, maxQuestions: 4 }
};

const draft = {
  format: "cubica.session-ai-debrief",
  schemaVersion: "1.0.0",
  artifactId: "550e8400-e29b-41d4-a716-446655440000",
  requestId: "550e8400-e29b-41d4-a716-446655440001",
  sessionId: "session-1",
  gameId: "cards-money-trains",
  status: "draft",
  createdAt: "2026-09-04T10:00:00.000Z",
  provenance: {
    throughEventSequence: 4,
    journalSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    methodologyVersion: "cmt-final-reflection-v1",
    promptVersion: "session-ai-debrief-prompt-v1",
    provider: "openai",
    model: "pinned-model",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
  },
  sections: {
    facts: [{ statement: "Команда построила участок дороги.", evidenceEventIds: ["event-1", "event-2"] }],
    interpretations: [{ statement: "Возможно, команда рано вложилась в сеть." }],
    facilitatorQuestions: [{ question: "Что повлияло на это решение?" }]
  },
  outputSha256: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
};

const generatedDraft = {
  ...draft,
  requestId: "550e8400-e29b-41d4-a716-446655440002"
};

const publicJournal = {
  format: "cubica.public-gameplay-journal",
  schemaVersion: "1.0.0",
  sessionId: "session-1",
  gameId: "cards-money-trains",
  lifecycle: "active",
  sessionCreatedAt: "2026-09-04T09:00:00.000Z",
  throughEventSequence: 4,
  entries: [
    {
      eventId: "event-1",
      sequence: 1,
      eventType: "road-built",
      occurredAt: "2026-09-04T09:01:00.000Z",
      summary: "Команда построила участок дороги.",
      data: {}
    },
    {
      eventId: "event-2",
      sequence: 2,
      eventType: "train-purchased",
      occurredAt: "2026-09-04T09:02:00.000Z",
      summary: "Команда приобрела поезд.",
      data: {}
    }
  ]
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "550e8400-e29b-41d4-a716-446655440002") });
});

describe("SessionAiDebriefPanel", () => {
  it.each([
    ["player", { viewerRole: "player" as const, profile }],
    ["without a published profile", { viewerRole: "facilitator" as const, profile: undefined }]
  ])("fails closed for %s", (_label, props) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" {...props} />);
    expect(screen.queryByRole("button", { name: "Разбор партии" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats latest 404 as a quiet empty state and generates only on explicit click", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(generatedDraft), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <>
        <PublicJournalDownload sessionId="session-1" runtimeStatus="ready" />
        <SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    await waitFor(() => expect(screen.getByText("Черновика пока нет. Запросите его после просмотра публичного журнала.")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Создать черновик" }));
    await waitFor(() => expect(screen.getByText("Факты из журнала")).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByText("Новый черновик создан."));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runtime/sessions/session-1/ai-debriefs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requestId: "550e8400-e29b-41d4-a716-446655440002" })
      })
    );
  });

  it("separates sections, renders every evidence id, and confirms the exact hash", async () => {
    const confirmed = { ...draft, status: "confirmed", confirmedAt: "2026-09-04T10:01:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(publicJournal), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmed), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <>
        <PublicJournalDownload sessionId="session-1" runtimeStatus="ready" />
        <SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    await waitFor(() => expect(screen.getByText("Возможные интерпретации")).toBeTruthy());
    expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy();
    expect(screen.getByText("Возможно, команда рано вложилась в сеть.")).toBeTruthy();
    expect(screen.getByText("Что повлияло на это решение?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Открыть событие: event-1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Открыть событие: event-2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Открыть событие: event-1" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: /Событие журнала.*event-1/ })).toBeTruthy());
    expect(screen.getByText("road-built")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtime/sessions/session-1/public-journal",
      expect.objectContaining({ credentials: "same-origin" })
    );

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить этот вариант" }));
    await waitFor(() => expect(screen.getByLabelText("Подтверждено")).toBeTruthy());
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runtime/sessions/session-1/ai-debriefs/550e8400-e29b-41d4-a716-446655440000/confirm",
      expect.objectContaining({ body: JSON.stringify({ outputSha256: draft.outputSha256 }) })
    );
    expect(screen.queryByRole("button", { name: "Подтвердить этот вариант" })).toBeNull();
  });

  it("keeps the journal and draft visible after a bounded error", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <>
        <PublicJournalDownload sessionId="session-1" runtimeStatus="ready" />
        <SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    await waitFor(() => expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить этот вариант" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Не удалось подтвердить вариант"));
    expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Открыть событие: event-1" })).toBeTruthy();
    expect(document.querySelectorAll(
      'a[href="/api/runtime/sessions/session-1/public-journal"]'
    )).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Скачать журнал" })).toHaveLength(1);
  });

  it("rejects a confirmation response for a different artifact and preserves the draft", async () => {
    const wrongArtifact = {
      ...draft,
      artifactId: "550e8400-e29b-41d4-a716-446655440099",
      status: "confirmed",
      confirmedAt: "2026-09-04T10:01:00.000Z"
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(wrongArtifact), { status: 200 })));
    render(<SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />);
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    await waitFor(() => expect(screen.getByLabelText("Черновик")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить этот вариант" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Не удалось подтвердить вариант"));
    expect(screen.getByLabelText("Черновик")).toBeTruthy();
    expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy();
  });

  it("does not show the empty state while latest is loading and ignores a late response after a session change", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstLatest = new Promise<Response>((resolve) => { resolveFirst = resolve; });
    const sessionTwoDraft = { ...draft, sessionId: "session-2", sections: {
      ...draft.sections,
      facts: [{ statement: "Вторая сессия загрузилась.", evidenceEventIds: ["event-9"] }]
    } };
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstLatest)
      .mockResolvedValueOnce(new Response(JSON.stringify(sessionTwoDraft), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(
      <SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    expect(screen.getByRole("status", { name: "" }).textContent).toContain("Загрузка разбора");
    expect(screen.queryByText("Черновика пока нет. Запросите его после просмотра публичного журнала.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Создать черновик" })).toBeNull();

    rendered.rerender(
      <SessionAiDebriefPanel sessionId="session-2" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    resolveFirst(new Response(JSON.stringify(draft), { status: 200 }));
    await waitFor(() => expect(screen.getByText("Вторая сессия загрузилась.")).toBeTruthy());
    expect(screen.queryByText("Команда построила участок дороги.")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtime/sessions/session-2/ai-debriefs/latest",
      expect.objectContaining({ credentials: "same-origin" })
    );
  });

  it("traps modal focus, closes with Escape, and keeps regeneration after confirmation", async () => {
    const confirmed = { ...draft, status: "confirmed", confirmedAt: "2026-09-04T10:01:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(confirmed), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(generatedDraft), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />);
    const trigger = screen.getByRole("button", { name: "Разбор партии" });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByLabelText("Подтверждено")).toBeTruthy());
    expect(trigger.inert).toBe(true);
    expect(trigger.getAttribute("aria-hidden")).toBe("true");
    const dialog = screen.getByRole("dialog");
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], summary"));
    expect(document.activeElement).toBe(focusable[0]);
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(trigger.inert).toBe(false);
    expect(trigger.hasAttribute("aria-hidden")).toBe(false);

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "Создать новый черновик" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Создать новый черновик" }));
    await waitFor(() => expect(screen.getByLabelText("Черновик")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Подтвердить этот вариант" })).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/runtime/sessions/session-1/ai-debriefs",
      expect.objectContaining({ body: JSON.stringify({ requestId: "550e8400-e29b-41d4-a716-446655440002" }) })
    );
  });

  it("fails closed when an evidence event is missing and preserves the draft", async () => {
    const missingEventJournal = { ...publicJournal, entries: [publicJournal.entries[1]] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(missingEventJournal), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />);
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    await waitFor(() => expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Открыть событие: event-1" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Не удалось открыть это событие"));
    expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Скачать журнал" })).toHaveLength(1);
  });

  it("shows a bounded evidence error when the journal request fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionAiDebriefPanel sessionId="session-1" runtimeStatus="ready" viewerRole="facilitator" profile={profile} />);
    fireEvent.click(screen.getByRole("button", { name: "Разбор партии" }));
    await waitFor(() => expect(screen.getByText("Команда построила участок дороги.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Открыть событие: event-1" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Не удалось открыть это событие"));
    expect(screen.getByText("Возможно, команда рано вложилась в сеть.")).toBeTruthy();
  });
});
