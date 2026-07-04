/**
 * Renderer-neutral preview geometry, hit-testing, and playthrough traces.
 *
 * The editor core depends only on descriptor lists and explicit highlight
 * commands, never on a concrete renderer (DOM/canvas/WebGL). This module holds
 * the rectangle math and topmost-first hit-testing used by preview surfaces, an
 * in-memory adapter for tests, and immutable preview playthrough trace values
 * used to record and rewind preview sessions without touching authoring JSON.
 */
import type {
  JsonValue,
  PreviewEntityDescriptor,
  PreviewHighlightCommand,
  PreviewHitTestOptions,
  PreviewHitTestResult,
  PreviewPlaythroughEvent,
  PreviewPlaythroughSnapshot,
  PreviewPlaythroughTrace,
  PreviewPoint,
  PreviewRect,
  PreviewTraceRestorePlan,
  StaticPreviewRendererAdapter
} from "./types.ts";

/** Normalizes rectangles so hit-tests work for drag selections in any direction. */
export function normalizePreviewRect(rect: PreviewRect): PreviewRect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;

  return {
    x,
    y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height)
  };
}

/** Returns true when a point lies inside the normalized rectangle boundaries. */
export function previewRectContainsPoint(rect: PreviewRect, point: PreviewPoint): boolean {
  const normalized = normalizePreviewRect(rect);
  return (
    point.x >= normalized.x &&
    point.y >= normalized.y &&
    point.x <= normalized.x + normalized.width &&
    point.y <= normalized.y + normalized.height
  );
}

/**
 * Returns true when two normalized preview rectangles overlap.
 *
 * NOTE: test-only export (LEGACY-0018): no production consumer imports this
 * predicate directly (rect hit-testing uses it internally), but it is covered
 * by `tests/index.test.ts`, so it stays exported.
 */
export function previewRectsIntersect(left: PreviewRect, right: PreviewRect): boolean {
  const a = normalizePreviewRect(left);
  const b = normalizePreviewRect(right);

  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/**
 * Sorts descriptors in the same order users expect from layered UIs: topmost
 * z-index first, then later render order, then later descriptor order.
 */
export function sortPreviewEntitiesTopmostFirst(
  entities: readonly PreviewEntityDescriptor[]
): readonly PreviewEntityDescriptor[] {
  return entities
    .map((entity, index) => ({ entity, index }))
    .sort((left, right) => {
      const zIndexDelta = (right.entity.zIndex ?? 0) - (left.entity.zIndex ?? 0);
      if (zIndexDelta !== 0) {
        return zIndexDelta;
      }

      const leftRenderOrder = left.entity.renderOrder ?? left.index;
      const rightRenderOrder = right.entity.renderOrder ?? right.index;
      const renderOrderDelta = rightRenderOrder - leftRenderOrder;
      if (renderOrderDelta !== 0) {
        return renderOrderDelta;
      }

      return right.index - left.index;
    })
    .map(({ entity }) => entity);
}

/** Runs renderer-neutral point hit-testing over a descriptor list. */
export function hitTestPreviewPoint(
  entities: readonly PreviewEntityDescriptor[],
  point: PreviewPoint,
  options: PreviewHitTestOptions = {}
): PreviewHitTestResult {
  const matches = filterPreviewHitTestEntities(entities, options).filter((entity) => previewRectContainsPoint(entity.bounds, point));
  return {
    point,
    entities: limitPreviewHitTestEntities(sortPreviewEntitiesTopmostFirst(matches), options.limit)
  };
}

/** Runs renderer-neutral rectangle hit-testing over a descriptor list. */
export function hitTestPreviewRect(
  entities: readonly PreviewEntityDescriptor[],
  rect: PreviewRect,
  options: PreviewHitTestOptions = {}
): PreviewHitTestResult {
  const normalized = normalizePreviewRect(rect);
  const matches = filterPreviewHitTestEntities(entities, options).filter((entity) => previewRectsIntersect(entity.bounds, normalized));
  return {
    rect: normalized,
    entities: limitPreviewHitTestEntities(sortPreviewEntitiesTopmostFirst(matches), options.limit)
  };
}

/**
 * Creates an in-memory adapter for tests and non-DOM preview simulations.
 *
 * NOTE: test-only export (LEGACY-0018): production preview surfaces provide
 * their own renderer adapters; this static adapter exists for
 * `tests/index.test.ts` and non-DOM simulations, so it stays exported.
 */
export function createStaticPreviewRendererAdapter(
  initialEntities: readonly PreviewEntityDescriptor[] = []
): StaticPreviewRendererAdapter {
  let entities = [...initialEntities];
  let highlightCommand: PreviewHighlightCommand = { type: "clearHighlight" };
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getEntities() {
      return entities;
    },
    setEntities(nextEntities) {
      entities = [...nextEntities];
      notify();
    },
    hitTestPoint(point, options) {
      return hitTestPreviewPoint(entities, point, options);
    },
    hitTestRect(rect, options) {
      return hitTestPreviewRect(entities, rect, options);
    },
    highlight(command) {
      highlightCommand = command;
      notify();
    },
    getHighlightCommand() {
      return highlightCommand;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

/** Creates an immutable preview playthrough trace value. */
export function createPreviewPlaythroughTrace(input: {
  readonly traceId: string;
  readonly gameId?: string;
  readonly events?: readonly PreviewPlaythroughEvent[];
  readonly snapshots?: readonly PreviewPlaythroughSnapshot[];
}): PreviewPlaythroughTrace {
  return {
    version: 1,
    traceId: input.traceId,
    gameId: input.gameId,
    events: [...(input.events ?? [])].sort((left, right) => left.sequence - right.sequence),
    snapshots: [...(input.snapshots ?? [])].sort((left, right) => left.eventSequence - right.eventSequence)
  };
}

/** Appends an event and optional preview snapshot without mutating the trace. */
export function appendPreviewPlaythroughEvent(
  trace: PreviewPlaythroughTrace,
  event: Omit<PreviewPlaythroughEvent, "sequence"> & { readonly sequence?: number },
  snapshotState?: JsonValue
): PreviewPlaythroughTrace {
  const nextSequence = event.sequence ?? nextPreviewEventSequence(trace.events);
  const nextEvent: PreviewPlaythroughEvent = {
    ...event,
    sequence: nextSequence
  };
  const nextSnapshots =
    snapshotState === undefined
      ? trace.snapshots
      : [
          ...trace.snapshots,
          {
            id: `${trace.traceId}:snapshot:${nextSequence}`,
            eventSequence: nextSequence,
            state: snapshotState
          }
        ];

  return createPreviewPlaythroughTrace({
    traceId: trace.traceId,
    gameId: trace.gameId,
    events: [...trace.events, nextEvent],
    snapshots: nextSnapshots
  });
}

/**
 * Plans preview rollback by finding the nearest snapshot and events to replay.
 *
 * The returned plan is intentionally preview-only: applying it is a renderer or
 * preview-session concern and must not mutate authoring JSON history.
 */
export function buildPreviewTraceRestorePlan(
  trace: PreviewPlaythroughTrace,
  targetSequence: number
): PreviewTraceRestorePlan {
  const snapshot = [...trace.snapshots]
    .filter((candidate) => candidate.eventSequence <= targetSequence)
    .sort((left, right) => right.eventSequence - left.eventSequence)[0];
  const fromSequence = snapshot?.eventSequence ?? Number.NEGATIVE_INFINITY;
  const replayEvents = trace.events.filter(
    (event) => event.sequence > fromSequence && event.sequence <= targetSequence
  );

  return {
    targetSequence,
    snapshot,
    replayEvents
  };
}

function filterPreviewHitTestEntities(
  entities: readonly PreviewEntityDescriptor[],
  options: PreviewHitTestOptions
): readonly PreviewEntityDescriptor[] {
  const layers = new Set(options.layers ?? []);

  return entities.filter((entity) => {
    if (options.includeHidden !== true && !entity.visible) {
      return false;
    }

    if (options.includeNonSelectable !== true && entity.selectable === false) {
      return false;
    }

    if (layers.size > 0 && (entity.layer === undefined || !layers.has(entity.layer))) {
      return false;
    }

    return true;
  });
}

function limitPreviewHitTestEntities(
  entities: readonly PreviewEntityDescriptor[],
  limit: number | undefined
): readonly PreviewEntityDescriptor[] {
  if (limit === undefined) {
    return entities;
  }

  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }

  return entities.slice(0, Math.floor(limit));
}

function nextPreviewEventSequence(events: readonly PreviewPlaythroughEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.sequence), -1) + 1;
}
