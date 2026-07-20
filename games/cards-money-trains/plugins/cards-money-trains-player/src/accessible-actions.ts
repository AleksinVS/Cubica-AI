/**
 * Accessible action projection for the Cards Money Trains board.
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
import { MOVEMENT_TRAVERSE_ACTION_ID } from "./movement-selection.ts";
import {
  TRAIN_WAGON_SELECT_ACTION_ID,
  TRAIN_WAGON_UNSELECT_ACTION_ID
} from "./train-formation-selection.ts";
import { TEAM_MARKER_COLOR_IDS } from "./team-palette.ts";

type BoardProjection = ReturnType<typeof projectBoardSession>;

const CARGO_LOAD_ACTION_ID = "cargo.load";
const CARGO_PHASE_FINISH_ACTION_ID = "cargo.phase.finish";
const CARGO_DELIVER_ACTION_ID = "settlement.cargo.deliver";
const SETTLEMENT_PHASE_FINISH_ACTION_ID = "settlement.phase.finish";
const CARGO_OFFER_DRAW_ACTION_ID = "cargo.offer.draw";
const CARGO_OFFER_SELECT_ACTION_ID = "cargo.offer.select";
const CARGO_OFFER_SKIP_ACTION_ID = "cargo.offer.skip";
const CARGO_QUEUE_PREPARE_ACTION_ID = "cargo.queue.prepare";
const CONSTRUCTION_CONTRIBUTION_SET_ACTION_ID =
  "construction.contribution.set";
const CONSTRUCTION_ACTION_IDS: ReadonlySet<string> = new Set([
  CONSTRUCTION_CONTRIBUTION_SET_ACTION_ID,
  "construction.mode.road",
  "construction.mode.waypoint",
  "construction.road.build",
  "construction.waypoint.build",
  "construction.phase.finish"
]);
const CARGO_OFFER_ACTION_IDS: ReadonlySet<string> = new Set([
  CARGO_OFFER_DRAW_ACTION_ID,
  CARGO_OFFER_SELECT_ACTION_ID,
  CARGO_OFFER_SKIP_ACTION_ID
]);
const ADD_LOGISTICS_COMPANY_ACTION_ID =
  "session.setup.team.add.logistics-company";
const ADD_LOCOMOTIVE_GUILD_ACTION_ID =
  "session.setup.team.add.locomotive-guild";
const ADD_TEAM_ACTION_IDS: ReadonlySet<string> = new Set([
  ADD_LOGISTICS_COMPANY_ACTION_ID,
  ADD_LOCOMOTIVE_GUILD_ACTION_ID
]);
const SETUP_WAGON_PLACE_ACTION_ID = "session.setup.place.wagon";
const SETUP_LOCOMOTIVE_PLACE_ACTION_ID = "session.setup.place.locomotive";
const MAINTENANCE_LOCOMOTIVE_ACTION_ID = "maintenance.pay.locomotive";
const MAINTENANCE_WAGON_ACTION_ID = "maintenance.pay.wagon";
const MAINTENANCE_CARGO_ACTION_ID = "maintenance.pay.held-cargo";
const EXPLICIT_FORM_ACTION_IDS: ReadonlySet<string> = new Set([
  ...ADD_TEAM_ACTION_IDS,
  SETUP_WAGON_PLACE_ACTION_ID,
  SETUP_LOCOMOTIVE_PLACE_ACTION_ID,
  MAINTENANCE_LOCOMOTIVE_ACTION_ID,
  MAINTENANCE_WAGON_ACTION_ID,
  MAINTENANCE_CARGO_ACTION_ID
]);
const PARAMETERLESS_LIFECYCLE_ACTION_IDS: ReadonlySet<string> = new Set([
  "cards.lifecycle.initialize",
  "session.setup.finalize",
  "session.play.start",
  "maintenance.phase.finish",
  "news.lifecycle.first-turn.skip",
  "news.lifecycle.draw",
  "news.lifecycle.stagnation"
]);

const selectOptions = (
  values: readonly { readonly id: string; readonly label?: string }[]
) => values.map((value) => ({ value: value.id, label: value.label ?? value.id }));

/**
 * Reuse the plugin's closed visual palette instead of declaring another color
 * vocabulary for the form. Runtime's action schema remains authoritative for
 * whether the submitted color is accepted and still unused.
 */
const teamColorOptions = selectOptions(
  TEAM_MARKER_COLOR_IDS.map((colorId) => ({ id: colorId }))
);

/**
 * Name every public edge by its projected endpoint labels.
 *
 * This is an input aid, not a legality filter: closed, non-incident or otherwise
 * invalid choices remain visible and are rejected authoritatively by Runtime.
 */
const edgeSelectOptions = (projection: BoardProjection) =>
  selectOptions(projection.edges.map((edge) => ({
    id: edge.id,
    label:
      `${projection.nodes.find((node) => node.id === edge.fromNodeId)?.label ?? edge.fromNodeId}`
      + ` — ${projection.nodes.find((node) => node.id === edge.toNodeId)?.label ?? edge.toNodeId}`
  })));

/** All public wagons remain input aids; Runtime filters stale or illegal choices. */
const wagonSelectOptions = (projection: BoardProjection) =>
  selectOptions(
    projection.vehicles
      .filter((vehicle) => vehicle.kind === "wagon")
      .map((vehicle) => ({ id: vehicle.id, label: vehicle.id }))
  );

/** All public locomotives remain input aids; Runtime owns placement legality. */
const locomotiveSelectOptions = (projection: BoardProjection) =>
  selectOptions(
    projection.vehicles
      .filter((vehicle) => vehicle.kind === "locomotive")
      .map((vehicle) => ({ id: vehicle.id, label: vehicle.id }))
  );

/**
 * Every public network node is a safe placement input aid.
 *
 * This deliberately avoids duplicating current station capacity, team order,
 * closure and setup-phase rules in the browser. Runtime rejects stale or
 * illegal choices from an otherwise public node list.
 */
const stationSelectOptions = (projection: BoardProjection) =>
  selectOptions(projection.nodes);

/**
 * Offer decks exist only for the numbered terminals 1–23.
 *
 * The exact ID shape deliberately excludes the separate 3,14 terminal and the
 * 9¾ waypoint. Options still come from the current public node projection, so
 * an absent or malformed terminal is never invented by the browser.
 */
const terminalDeckSelectOptions = (projection: BoardProjection) =>
  selectOptions(
    projection.nodes
      .filter((node) =>
        node.objectType === "transport.terminal"
        && /^terminal-(?:[1-9]|1[0-9]|2[0-3])$/u.test(node.id))
      .sort((left, right) =>
        Number(left.id.slice("terminal-".length))
        - Number(right.id.slice("terminal-".length)))
  );

const cargoLabel = (
  cargo: NonNullable<BoardProjection["cargos"]>[number],
  nodeLabels: ReadonlyMap<string, string>
): string => {
  const origin = cargo.fromNodeId
    ? nodeLabels.get(cargo.fromNodeId) ?? cargo.fromNodeId
    : "неизвестный пункт";
  const destination = cargo.toNodeId
    ? nodeLabels.get(cargo.toNodeId) ?? cargo.toNodeId
    : "неизвестный пункт";
  const payout = cargo.payout === null ? "" : ` · ${cargo.payout} монет`;
  return `${origin} → ${destination}${payout}`;
};

/**
 * Name only publicly available cargo by its public route and published payout.
 *
 * The filtering prevents a large hidden deck from becoming a selector. It does
 * not prove that a specific wagon can load the order in the current snapshot.
 */
const availableCargoSelectOptions = (projection: BoardProjection) => {
  const nodeLabels = new Map(projection.nodes.map((node) => [node.id, node.label]));
  return selectOptions((projection.cargos ?? [])
    .filter((cargo) => cargo.status === "available")
    .map((cargo) => ({ id: cargo.id, label: cargoLabel(cargo, nodeLabels) })));
};

/**
 * Maintenance may refer to a cargo already held by a wagon.
 *
 * Only cargo present in the public projection can enter this selector; hidden
 * deck cards remain excluded by `projectBoardSession`. Runtime still decides
 * whether the selected cargo actually owes maintenance.
 */
const visibleCargoSelectOptions = (projection: BoardProjection) => {
  const nodeLabels = new Map(projection.nodes.map((node) => [node.id, node.label]));
  return selectOptions((projection.cargos ?? [])
    .map((cargo) => ({ id: cargo.id, label: cargoLabel(cargo, nodeLabels) })));
};

/**
 * The two open cards are already public `offered` entities.
 *
 * Filtering that public presentation state keeps hidden deck contents out of
 * the browser. It does not decide whether either card can still be selected.
 */
const offeredCargoSelectOptions = (projection: BoardProjection) => {
  const nodeLabels = new Map(projection.nodes.map((node) => [node.id, node.label]));
  return selectOptions((projection.cargos ?? [])
    .filter((cargo) => cargo.status === "offered")
    .map((cargo) => ({ id: cargo.id, label: cargoLabel(cargo, nodeLabels) })));
};

/** Build a normal keyboard form from public board choices, never from rules. */
const actionFields = (
  action: BoardProjection["availableActions"][number],
  projection: BoardProjection
): readonly AccessibleBoardActionField[] | undefined => {
  if (ADD_TEAM_ACTION_IDS.has(action.actionId)) {
    return [{
      name: "name",
      label: "Название команды",
      kind: "text",
      required: true,
      minLength: 1,
      maxLength: 80,
      pattern: ".*\\S.*"
    }, {
      name: "colorId",
      label: "Цвет команды",
      kind: "select",
      required: true,
      options: teamColorOptions
    }];
  }

  if (action.actionId === SETUP_WAGON_PLACE_ACTION_ID) {
    return [{
      name: "wagonId",
      label: "Вагон",
      kind: "select",
      required: true,
      options: wagonSelectOptions(projection)
    }, {
      name: "stationId",
      label: "Станция или полустанок",
      kind: "select",
      required: true,
      options: stationSelectOptions(projection)
    }];
  }

  if (action.actionId === SETUP_LOCOMOTIVE_PLACE_ACTION_ID) {
    return [{
      name: "locomotiveId",
      label: "Локомотив",
      kind: "select",
      required: true,
      options: locomotiveSelectOptions(projection)
    }, {
      name: "stationId",
      label: "Станция или полустанок",
      kind: "select",
      required: true,
      options: stationSelectOptions(projection)
    }];
  }

  if (action.actionId === MAINTENANCE_LOCOMOTIVE_ACTION_ID) {
    return [{
      name: "locomotiveId",
      label: "Локомотив",
      kind: "select",
      required: true,
      options: locomotiveSelectOptions(projection)
    }];
  }

  if (action.actionId === MAINTENANCE_WAGON_ACTION_ID) {
    return [{
      name: "wagonId",
      label: "Вагон",
      kind: "select",
      required: true,
      options: wagonSelectOptions(projection)
    }];
  }

  if (action.actionId === MAINTENANCE_CARGO_ACTION_ID) {
    return [{
      name: "cargoId",
      label: "Удерживаемый груз",
      kind: "select",
      required: true,
      options: visibleCargoSelectOptions(projection)
    }];
  }

  if (
    action.actionId === CARGO_OFFER_DRAW_ACTION_ID
    || action.actionId === CARGO_OFFER_SKIP_ACTION_ID
  ) {
    return [{
      name: "terminalId",
      label: "Терминал",
      kind: "select",
      required: true,
      options: terminalDeckSelectOptions(projection)
    }];
  }

  if (action.actionId === CARGO_OFFER_SELECT_ACTION_ID) {
    return [{
      name: "terminalId",
      label: "Терминал",
      kind: "select",
      required: true,
      options: terminalDeckSelectOptions(projection)
    }, {
      name: "cargoId",
      label: "Открытая грузовая карта",
      kind: "select",
      required: true,
      options: offeredCargoSelectOptions(projection)
    }];
  }

  if (action.actionId === CONSTRUCTION_CONTRIBUTION_SET_ACTION_ID) {
    return [{
      name: "teamId",
      label: "Команда",
      kind: "select",
      required: true,
      options: selectOptions(
        projection.teams.map((team) => ({ id: team.id, label: team.label }))
      )
    }, {
      name: "amount",
      label: "Сумма вклада",
      kind: "number",
      required: true,
      min: 0,
      step: 1
    }];
  }

  if (action.actionId === "construction.road.build") {
    const options = selectOptions(projection.nodes);
    if (options.length < 2) return undefined;
    return [
      { name: "fromNodeId", label: "Первая станция", kind: "select", required: true, options },
      { name: "toNodeId", label: "Вторая станция", kind: "select", required: true, options }
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
        options: edgeSelectOptions(projection)
      },
      {
        name: "positionT",
        label: "Положение на дороге (от 0 до 1)",
        kind: "number",
        required: true,
        min: 0.01,
        max: 0.99,
        step: 0.01
      }
    ];
  }
  if (action.actionId === MOVEMENT_TRAVERSE_ACTION_ID) {
    return [{
      name: "edgeId",
      label: "Дорога для движения",
      kind: "select",
      required: true,
      // Options always come from this exact public snapshot. There is no
      // fixture enum and no attempt to guess the current locomotive's routes.
      options: edgeSelectOptions(projection)
    }];
  }
  if (
    action.actionId === TRAIN_WAGON_SELECT_ACTION_ID
    || action.actionId === TRAIN_WAGON_UNSELECT_ACTION_ID
  ) {
    return [{
      name: "wagonId",
      label: action.actionId === TRAIN_WAGON_SELECT_ACTION_ID
        ? "Вагон для отметки"
        : "Вагон для снятия отметки",
      kind: "select",
      required: true,
      // Every public wagon remains visible. This is an accessible input list,
      // not a duplicate browser-side implementation of formation rules.
      options: wagonSelectOptions(projection)
    }];
  }
  if (action.actionId === CARGO_LOAD_ACTION_ID) {
    return [
      {
        name: "wagonId",
        label: "Вагон",
        kind: "select",
        required: true,
        options: wagonSelectOptions(projection)
      },
      {
        name: "cargoId",
        label: "Груз",
        kind: "select",
        required: true,
        options: availableCargoSelectOptions(projection)
      }
    ];
  }
  if (action.actionId === CARGO_DELIVER_ACTION_ID) {
    return [{
      name: "wagonId",
      label: "Вагон с доставленным грузом",
      kind: "select",
      required: true,
      // Cargo, payout and beneficiary are derived authoritatively by Runtime.
      options: wagonSelectOptions(projection)
    }];
  }
  return undefined;
};

/** Cargo workflows accept only their explicit form fields, never hidden defaults. */
const omitsFixedParams = (actionId: string): boolean =>
  EXPLICIT_FORM_ACTION_IDS.has(actionId)
  || PARAMETERLESS_LIFECYCLE_ACTION_IDS.has(actionId)
  || actionId.startsWith("news.effect.apply.")
  || actionId.startsWith("news.cargo-addition.apply.")
  || actionId.startsWith("news.apply.")
  || CARGO_OFFER_ACTION_IDS.has(actionId)
  || actionId === CARGO_QUEUE_PREPARE_ACTION_ID
  || actionId === CARGO_LOAD_ACTION_ID
  || actionId === CARGO_DELIVER_ACTION_ID
  || actionId === CARGO_PHASE_FINISH_ACTION_ID
  || actionId === SETTLEMENT_PHASE_FINISH_ACTION_ID
  || CONSTRUCTION_ACTION_IDS.has(actionId);

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
    ...(action.params === undefined || omitsFixedParams(action.actionId)
      ? {}
      : { params: { ...action.params } }),
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
 * The plugin does not derive topology or gameplay permission in the browser.
 */
export const provideCardsMoneyTrainsAccessibleBoardActions: AccessibleBoardActionsProvider = (
  session
) => {
  const projection = projectBoardSession(session);
  return projection.availableActions
    // A large manifest can publish many facilitator actions at once. Runtime's
    // current verdict is the authoritative way to keep the keyboard form
    // useful: proven-unavailable actions disappear, parameter-dependent ones
    // stay visible so the facilitator can supply their fields. Older snapshots
    // have no verdict and retain the previous presentation behavior.
    .filter((action) => action.availabilityStatus !== "unavailable")
    .map((action) => toAccessibleAction(action, projection));
};
