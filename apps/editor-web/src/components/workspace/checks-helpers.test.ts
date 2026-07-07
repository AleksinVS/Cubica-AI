/**
 * Unit tests for the Checks-tab aggregation helpers (Phase 8.1; design-spec §3.5).
 *
 * Coverage: every diagnostic stream is merged; plugin/workflow duplicates collapse;
 * a diagnostic deep inside an entity resolves to that entity (pointer walk-up);
 * `entity-missing-view` becomes a deterministic «create-view» quick fix; grouping
 * is severity-ordered and drops empty groups; counts split by severity.
 */
import { describe, expect, it } from "vitest";

import type {
  EditorEntity,
  EditorEntityProjection,
  EditorEntityProjectionDiagnostic
} from "@cubica/editor-engine";
import type { RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";

import {
  aggregateWorkspaceChecks,
  groupChecksBySeverity,
  resolveEntityForPointer,
  summarizeCheckCounts
} from "./checks-helpers.ts";

const FILE = "games/demo/authoring/game.authoring.json";

function entity(overrides: Partial<EditorEntity> & { readonly entityId: string; readonly pointer: string }): EditorEntity {
  return {
    entityId: overrides.entityId,
    kind: overrides.kind ?? "ui-component",
    label: overrides.label ?? "Карточка выбора",
    primarySource: {
      filePath: FILE,
      pointer: overrides.pointer,
      documentKind: "game"
    },
    facets: overrides.facets ?? {},
    diagnostics: overrides.diagnostics ?? []
  };
}

function projectionOf(entities: readonly EditorEntity[], diagnostics: readonly EditorEntityProjectionDiagnostic[]): EditorEntityProjection {
  const entityById = new Map(entities.map((item) => [item.entityId, item]));
  const bySource = new Map<string, readonly EditorEntity[]>();
  for (const item of entities) {
    bySource.set(`${item.primarySource.filePath}#${item.primarySource.pointer}`, [item]);
  }
  return {
    projectionVersion: 1,
    gameId: "demo",
    sourceHashes: {},
    entities,
    entityById,
    entitiesBySourcePointer: bySource,
    diagnostics
  };
}

function routed(overrides: Partial<RoutedEditorDiagnostic> & { readonly message: string }): RoutedEditorDiagnostic {
  return {
    severity: overrides.severity ?? "error",
    source: overrides.source ?? "schema",
    pointer: overrides.pointer ?? "",
    label: overrides.label ?? "/",
    message: overrides.message,
    range: undefined,
    filePath: overrides.filePath
  };
}

describe("aggregateWorkspaceChecks", () => {
  it("merges routed, plugin and projection diagnostics and resolves entities via pointer walk-up", () => {
    const card = entity({ entityId: "ui:card", pointer: "/root/screens/0/children/0", label: "Карточка «Маршрут»" });
    const projection = projectionOf(
      [card],
      [
        {
          severity: "warning",
          code: "entity-missing-view",
          message: "Нет вида для Telegram",
          source: card.primarySource
        }
      ]
    );

    const checks = aggregateWorkspaceChecks({
      routedDiagnostics: [
        // Deep inside the card entity — must resolve to it by walking the pointer up.
        routed({ severity: "error", source: "schema", pointer: "/root/screens/0/children/0/title", message: "Invalid title" })
      ],
      pluginDiagnostics: [],
      projectionDiagnostics: projection.diagnostics,
      projection,
      activeFilePath: FILE
    });

    expect(checks).toHaveLength(2);
    const schemaRow = checks.find((item) => item.source === "schema");
    expect(schemaRow?.entityId).toBe("ui:card");
    expect(schemaRow?.entityLabel).toBe("Карточка «Маршрут»");
    expect(schemaRow?.badge).toBe("схема");

    const projectionRow = checks.find((item) => item.code === "entity-missing-view");
    expect(projectionRow?.entityId).toBe("ui:card");
    expect(projectionRow?.badge).toBe("смысл");
    // The only deterministic quick fix in this slice.
    expect(projectionRow?.quickFix).toBe("create-view");
    expect(schemaRow?.quickFix).toBeUndefined();
  });

  it("deduplicates a finding surfaced on both the workflow and plugin streams", () => {
    const projection = projectionOf([], []);
    const dup = routed({ severity: "error", source: "plugin", pointer: "/root/x", message: "Plugin blocked" });
    const checks = aggregateWorkspaceChecks({
      routedDiagnostics: [dup],
      pluginDiagnostics: [dup],
      projectionDiagnostics: [],
      projection,
      activeFilePath: FILE
    });
    expect(checks).toHaveLength(1);
  });

  it("does not offer a quick fix for entity-missing-view when no entity resolves", () => {
    const projection = projectionOf([], []);
    const checks = aggregateWorkspaceChecks({
      routedDiagnostics: [],
      pluginDiagnostics: [],
      projectionDiagnostics: [
        {
          severity: "warning",
          code: "entity-missing-view",
          message: "Нет вида",
          source: { filePath: FILE, pointer: "/root/orphan", documentKind: "game" }
        }
      ],
      projection,
      activeFilePath: FILE
    });
    expect(checks[0]?.quickFix).toBeUndefined();
  });
});

describe("resolveEntityForPointer", () => {
  it("returns undefined when nothing matches at or above the pointer", () => {
    const projection = projectionOf([entity({ entityId: "a", pointer: "/root/a" })], []);
    expect(resolveEntityForPointer(projection, FILE, "/root/b/c")).toBeUndefined();
  });
});

describe("groupChecksBySeverity", () => {
  it("orders groups error → warning → info and drops empty groups", () => {
    const projection = projectionOf([], []);
    const checks = aggregateWorkspaceChecks({
      routedDiagnostics: [
        routed({ severity: "warning", message: "w1" }),
        routed({ severity: "error", message: "e1" }),
        routed({ severity: "warning", message: "w2" })
      ],
      pluginDiagnostics: [],
      projectionDiagnostics: [],
      projection,
      activeFilePath: FILE
    });
    const groups = groupChecksBySeverity(checks);
    expect(groups.map((group) => group.severity)).toEqual(["error", "warning"]);
    expect(groups[1]?.items).toHaveLength(2);
  });
});

describe("summarizeCheckCounts", () => {
  it("splits counts by severity", () => {
    const projection = projectionOf([], []);
    const checks = aggregateWorkspaceChecks({
      routedDiagnostics: [routed({ severity: "error", message: "e" }), routed({ severity: "warning", message: "w" })],
      pluginDiagnostics: [],
      projectionDiagnostics: [],
      projection,
      activeFilePath: FILE
    });
    expect(summarizeCheckCounts(checks)).toEqual({ error: 1, warning: 1, info: 0, total: 2 });
  });
});
