/**
 * Accessible action projection for the Cards Money Trains test-only board.
 *
 * The provider is intentionally independent from Phaser. It copies actions
 * already published in the authoritative session so the host can expose its
 * ordinary keyboard controls before or without creating the visual scene.
 */

import type {
  AccessibleBoardAction,
  AccessibleBoardActionField,
  AccessibleBoardActionsProvider
} from "@cubica/player-web/plugin-api";

import { projectBoardSession } from "./board-state.ts";

type BoardProjection = ReturnType<typeof projectBoardSession>;

const selectOptions = (
  values: readonly { readonly id: string; readonly label?: string }[]
) => values.map((value) => ({ value: value.id, label: value.label ?? value.id }));

const contributionLabel = (name: string, projection: BoardProjection): string => {
  const prefix = name.replace(/Contribution$/u, "").toLowerCase();
  const team = projection.teams.find((candidate) =>
    candidate.id.toLowerCase().includes(prefix) || candidate.label.toLowerCase().includes(prefix));
  return team ? `Вклад: ${team.label}` : `Вклад: ${prefix}`;
};

/** Build a normal keyboard form from public board choices, never from rules. */
const actionFields = (
  action: BoardProjection["availableActions"][number],
  projection: BoardProjection
): readonly AccessibleBoardActionField[] | undefined => {
  const contributionFields: AccessibleBoardActionField[] = Object.entries(action.params ?? {})
    .filter(([name, value]) => name.endsWith("Contribution") && typeof value === "number")
    .map(([name, value]) => ({
      name,
      label: contributionLabel(name, projection),
      kind: "number" as const,
      required: true,
      min: 0,
      step: 1,
      defaultValue: value as number
    }));

  if (action.actionId === "construction.road.build") {
    const options = selectOptions(projection.nodes);
    if (options.length < 2) return undefined;
    return [
      { name: "fromNodeId", label: "Первая станция", kind: "select", required: true, options },
      { name: "toNodeId", label: "Вторая станция", kind: "select", required: true, options },
      ...contributionFields
    ];
  }
  if (action.actionId === "construction.waypoint.build") {
    if (projection.edges.length === 0) return undefined;
    return [
      {
        name: "edgeId",
        label: "Существующая дорога",
        kind: "select",
        required: true,
        options: selectOptions(projection.edges.map((edge) => ({
          id: edge.id,
          label: `${projection.nodes.find((node) => node.id === edge.fromNodeId)?.label ?? edge.fromNodeId} — ${projection.nodes.find((node) => node.id === edge.toNodeId)?.label ?? edge.toNodeId}`
        })))
      },
      {
        name: "positionT",
        label: "Положение на дороге (от 0 до 1)",
        kind: "number",
        required: true,
        min: 0.01,
        max: 0.99,
        step: 0.01
      },
      ...contributionFields
    ];
  }
  return undefined;
};

/** Copy one server-declared action into the public host contribution shape. */
const toAccessibleAction = (
  action: BoardProjection["availableActions"][number],
  projection: BoardProjection
): AccessibleBoardAction => {
  const fields = actionFields(action, projection);
  return {
    id: action.id,
    label: action.label,
    actionId: action.actionId,
    ...(action.description === undefined ? {} : { description: action.description }),
    ...(action.params === undefined ? {} : { params: { ...action.params } }),
    ...(fields === undefined ? {} : { fields }),
    ...(action.actionId === "construction.road.build" ? {
      preview: {
        kind: "transport-road" as const,
        endpointParameters: { from: "fromNodeId", to: "toNodeId" }
      }
    } : {}),
    ...(action.disabled === undefined ? {} : { disabled: action.disabled })
  };
};

/**
 * Return only actions present in the authoritative player-facing snapshot.
 * Phase and availability filtering come from the server projection reader.
 */
export const provideCardsMoneyTrainsAccessibleBoardActions: AccessibleBoardActionsProvider = (
  session
) => {
  const projection = projectBoardSession(session);
  return projection.availableActions.map((action) => toAccessibleAction(action, projection));
};
