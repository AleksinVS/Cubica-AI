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
import { LOCOMOTIVE_MOVE_ACTION_ID } from "./movement-selection.ts";

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

/** Human-readable public label for one explicitly active transport unit. */
const vehicleLabel = (
  vehicle: BoardProjection["vehicles"][number],
  projection: BoardProjection
): string => {
  const team = projection.teams.find((candidate) => candidate.id === vehicle.ownerTeamId);
  const node = projection.nodes.find((candidate) => candidate.id === vehicle.nodeId);
  return [
    team?.label ?? vehicle.ownerTeamId ?? "Без владельца",
    node?.label ?? vehicle.nodeId ?? "Вне станции",
    "активен",
    vehicle.id
  ].join(" · ");
};

const cargoStatusLabel = (status: string | null): string => {
  if (status === "available") return "доступен";
  if (status === "in_transit") return "в пути";
  if (status === "delivered") return "доставлен";
  return status ? `статус: ${status}` : "статус не указан";
};

/** Describe one public order while leaving all route and status checks to runtime. */
const cargoLabel = (
  cargo: BoardProjection["cargoOrders"][number],
  projection: BoardProjection
): string => {
  const from = projection.nodes.find((node) => node.id === cargo.fromNodeId);
  const to = projection.nodes.find((node) => node.id === cargo.toNodeId);
  const route = `${from?.label ?? cargo.fromNodeId ?? "?"} → ${to?.label ?? cargo.toNodeId ?? "?"}`;
  const payout = cargo.payout === null ? "выплата не указана" : `выплата ${cargo.payout}`;
  return `${route} · ${cargoStatusLabel(cargo.status)} · ${payout} · ${cargo.id}`;
};

/** Public endpoint labels for a road; openness remains a runtime concern. */
const edgeLabel = (
  edge: BoardProjection["edges"][number],
  projection: BoardProjection
): string => {
  const from = projection.nodes.find((node) => node.id === edge.fromNodeId);
  const to = projection.nodes.find((node) => node.id === edge.toNodeId);
  return `${from?.label ?? edge.fromNodeId} — ${to?.label ?? edge.toNodeId}`;
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
          label: edgeLabel(edge, projection)
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
  if (action.actionId === LOCOMOTIVE_MOVE_ACTION_ID) {
    return [
      {
        name: "vehicleId",
        label: "Активный локомотив",
        kind: "select",
        required: true,
        options: selectOptions(projection.vehicles
          .filter((vehicle) => vehicle.kind === "locomotive")
          .map((vehicle) => ({
            id: vehicle.id,
            label: vehicleLabel(vehicle, projection)
          })))
      },
      {
        name: "edgeId",
        label: "Дорога",
        kind: "select",
        required: true,
        options: selectOptions(projection.edges.map((edge) => ({
          id: edge.id,
          label: edgeLabel(edge, projection)
        })))
      }
    ];
  }
  if (action.actionId === "mock.cargo.load.white") {
    return [
      {
        name: "wagonId",
        label: "Активный вагон",
        kind: "select",
        required: true,
        options: selectOptions(projection.vehicles
          .filter((vehicle) => vehicle.kind === "wagon")
          .map((vehicle) => ({
            id: vehicle.id,
            label: vehicleLabel(vehicle, projection)
          })))
      },
      {
        name: "cargoId",
        label: "Предложенный груз",
        kind: "select",
        required: true,
        options: selectOptions(projection.cargoOfferIds.map((id) => {
          const cargo = projection.cargoOrders.find((candidate) => candidate.id === id);
          return {
            id,
            label: cargo ? cargoLabel(cargo, projection) : id
          };
        }))
      }
    ];
  }
  if (
    action.actionId === "mock.operations.attach.white"
    || action.actionId === "mock.operations.detach.white"
  ) {
    return [
      {
        name: "vehicleId",
        label: "Активный локомотив",
        kind: "select",
        required: true,
        options: selectOptions(projection.vehicles
          .filter((vehicle) => vehicle.kind === "locomotive")
          .map((vehicle) => ({
            id: vehicle.id,
            label: vehicleLabel(vehicle, projection)
          })))
      },
      {
        name: "wagonId",
        label: "Активный вагон",
        kind: "select",
        required: true,
        options: selectOptions(projection.vehicles
          .filter((vehicle) => vehicle.kind === "wagon")
          .map((vehicle) => ({
            id: vehicle.id,
            label: vehicleLabel(vehicle, projection)
          })))
      }
    ];
  }
  if (action.actionId === "mock.cargo.deliver") {
    return [
      {
        name: "wagonId",
        label: "Активный вагон",
        kind: "select",
        required: true,
        options: selectOptions(projection.vehicles
          .filter((vehicle) => vehicle.kind === "wagon")
          .map((vehicle) => ({
            id: vehicle.id,
            label: vehicleLabel(vehicle, projection)
          })))
      },
      {
        name: "cargoId",
        label: "Публичный грузовой заказ",
        kind: "select",
        required: true,
        // Deliberately include every public status. Runtime alone decides
        // whether a selected order is currently deliverable.
        options: selectOptions(projection.cargoOrders.map((cargo) => ({
          id: cargo.id,
          label: cargoLabel(cargo, projection)
        })))
      }
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
