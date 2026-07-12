"use client";

/**
 * Client state controller for durable author-version history.
 *
 * The hook owns pagination, detail loading and optimistic restore concurrency.
 * It intentionally accepts a callback for reloading the wider editor; this
 * keeps the history transport isolated while the workspace remains responsible
 * for projections, diagnostics, preview and local undo/intent state.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  EditorVersionDetails,
  EditorVersionDirtySummary,
  EditorVersionSummary
} from "@/lib/editor-version-contracts";
import {
  EditorVersionApiError,
  fetchEditorVersionDetails,
  fetchEditorVersionPage,
  restoreEditorVersion
} from "./api-client.ts";
import { editorRu as t } from "@/lib/locale";
import type { HistoryRequestState, HistoryRestoreState } from "./history-sidebar-panel.tsx";

export interface UseEditorVersionHistoryOptions {
  readonly sessionId?: string;
  readonly initialCurrentVersionId?: string | null;
  readonly onRestored: () => void | Promise<void>;
}

export function useEditorVersionHistory({ sessionId, initialCurrentVersionId, onRestored }: UseEditorVersionHistoryOptions) {
  const [versions, setVersions] = useState<readonly EditorVersionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(initialCurrentVersionId ?? null);
  const [dirtySummary, setDirtySummary] = useState<EditorVersionDirtySummary | undefined>();
  const [selectedVersionId, setSelectedVersionId] = useState<string | undefined>();
  const [selectedDetails, setSelectedDetails] = useState<EditorVersionDetails | undefined>();
  const [listState, setListState] = useState<HistoryRequestState>("idle");
  const [detailsState, setDetailsState] = useState<HistoryRequestState>("idle");
  const [restoreState, setRestoreState] = useState<HistoryRestoreState>("idle");
  const [error, setError] = useState<string | undefined>();
  const activeSessionRef = useRef(sessionId);
  const detailsRequestRef = useRef(0);
  activeSessionRef.current = sessionId;

  const loadFirstPage = useCallback(async () => {
    if (sessionId === undefined) return;
    setListState("loading");
    setError(undefined);
    try {
      const page = await fetchEditorVersionPage({ sessionId, limit: 20 });
      if (activeSessionRef.current !== sessionId) return;
      setVersions(page.versions);
      setNextCursor(page.nextCursor);
      setCurrentVersionId(page.currentVersionId);
      setDirtySummary(page.dirtySummary);
      setListState("ready");
    } catch (caught) {
      if (activeSessionRef.current !== sessionId) return;
      setListState("error");
      setError(historyErrorMessage(caught));
    }
  }, [sessionId]);

  useEffect(() => {
    setVersions([]);
    setNextCursor(undefined);
    setCurrentVersionId(initialCurrentVersionId ?? null);
    setDirtySummary(undefined);
    setSelectedVersionId(undefined);
    setSelectedDetails(undefined);
    setDetailsState("idle");
    setRestoreState("idle");
    setError(undefined);
    void loadFirstPage();
  }, [initialCurrentVersionId, loadFirstPage, sessionId]);

  const loadMore = useCallback(async () => {
    if (sessionId === undefined || nextCursor === undefined || listState === "loading") return;
    setListState("loading");
    setError(undefined);
    try {
      const page = await fetchEditorVersionPage({ sessionId, cursor: nextCursor, limit: 20 });
      if (activeSessionRef.current !== sessionId) return;
      setVersions((current) => mergeVersions(current, page.versions));
      setNextCursor(page.nextCursor);
      setCurrentVersionId(page.currentVersionId);
      setDirtySummary(page.dirtySummary);
      setListState("ready");
    } catch (caught) {
      if (activeSessionRef.current !== sessionId) return;
      setListState("error");
      setError(historyErrorMessage(caught));
    }
  }, [listState, nextCursor, sessionId]);

  const selectVersion = useCallback(async (versionId: string) => {
    if (sessionId === undefined) return;
    detailsRequestRef.current += 1;
    const requestId = detailsRequestRef.current;
    setSelectedVersionId(versionId);
    setSelectedDetails(undefined);
    setDetailsState("loading");
    setError(undefined);
    try {
      const details = await fetchEditorVersionDetails(sessionId, versionId);
      if (activeSessionRef.current !== sessionId || detailsRequestRef.current !== requestId) return;
      setSelectedDetails(details);
      setDetailsState("ready");
    } catch (caught) {
      if (activeSessionRef.current !== sessionId || detailsRequestRef.current !== requestId) return;
      setDetailsState("error");
      setError(historyErrorMessage(caught));
    }
  }, [sessionId]);

  const restore = useCallback(async (versionId: string) => {
    if (sessionId === undefined || dirtySummary?.isDirty === true) return false;
    setRestoreState("restoring");
    setError(undefined);
    let result;
    try {
      result = await restoreEditorVersion({ sessionId, versionId, expectedHead: currentVersionId });
    } catch (caught) {
      setRestoreState("error");
      setError(historyErrorMessage(caught));
      if (caught instanceof EditorVersionApiError && (caught.code === "session_dirty" || caught.code === "version_conflict")) {
        await loadFirstPage();
      }
      return false;
    }

    setCurrentVersionId(result.currentVersionId);
    setDirtySummary({ isDirty: false, changedPaths: [], checkedAt: new Date().toISOString() });
    setSelectedVersionId(result.currentVersionId);
    setSelectedDetails(undefined);
    setDetailsState("idle");
    try {
      await onRestored();
      await loadFirstPage();
      setRestoreState("idle");
      return true;
    } catch {
      // The durable restore has already succeeded. Never present this as a
      // retryable restore failure, or a second click could create a duplicate.
      await loadFirstPage();
      setRestoreState("error");
      setError(t.history.errorReloadAfterRestore);
      return true;
    }
  }, [currentVersionId, dirtySummary?.isDirty, loadFirstPage, onRestored, sessionId]);

  return {
    versions,
    nextCursor,
    currentVersionId,
    dirtySummary,
    selectedVersionId,
    selectedDetails,
    listState,
    detailsState,
    restoreState,
    error,
    loadFirstPage,
    loadMore,
    selectVersion,
    restore
  };
}

/** Keeps newest-first order while protecting against overlapping cursor pages. */
export function mergeVersions(current: readonly EditorVersionSummary[], next: readonly EditorVersionSummary[]): readonly EditorVersionSummary[] {
  const seen = new Set(current.map((version) => version.versionId));
  return [...current, ...next.filter((version) => !seen.has(version.versionId))];
}

/** Stable Russian copy for the expected API failures; server internals stay hidden. */
export function historyErrorMessage(error: unknown): string {
  if (!(error instanceof EditorVersionApiError)) return t.history.errorRefresh;
  if (error.code === "session_dirty") return t.history.errorDirty;
  if (error.code === "version_conflict") return t.history.errorConflict;
  if (error.code === "version_not_found") return t.history.errorVersionMissing;
  if (error.code === "session_not_found") return t.history.errorSessionMissing;
  if (error.code === "session_incompatible") return t.history.errorSessionIncompatible;
  if (error.code === "invalid_cursor") return t.history.errorCursor;
  return t.history.errorRequest;
}
