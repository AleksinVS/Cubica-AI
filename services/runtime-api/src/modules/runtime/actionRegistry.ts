import type { GameBundle } from "../content/manifestLoader.ts";
import type {
  RuntimeActionHandler,
  RuntimeActionRegistry
} from "@cubica/contracts-runtime";
import { getManifestActionDefinition, listManifestActionDefinitions } from "./manifestActions.ts";
import {
  createDeterministicHandler,
  resolveActionCapabilityFamily
} from "./deterministicHandlers.ts";

type RuntimeState = Record<string, unknown>;

const SUPPORTED_MANIFEST_DATA_ACTIONS = new Set([
  "opening.info.i0.advance",
  "opening.info.i02.advance",
  "opening.info.i03.advance",
  "opening.info.i1.advance",
  "opening.info.i2.advance",
  "opening.info.i3.advance",
  "opening.info.i4.advance",
  "opening.info.i5.advance",
  "opening.info.i6.advance",
  "opening.card.1",
  "opening.card.2",
  "opening.card.3",
  "opening.card.3.advance",
  "opening.card.4",
  "opening.card.5",
  "opening.card.6",
  "opening.info.i7.advance",
  "opening.card.7",
  "opening.card.8",
  "opening.card.9",
  "opening.card.9.advance",
  "opening.card.10",
  "opening.card.11",
  "opening.card.12",
  "opening.info.i8.advance",
  "opening.card.13",
  "opening.card.14",
  "opening.card.15",
  "opening.card.16",
  "opening.card.17",
  "opening.card.18",
  "opening.card.18.advance",
  "opening.info.i9.advance",
  "opening.info.i10.advance",
  "opening.card.19",
  "opening.card.20",
  "opening.card.21",
  "opening.card.22",
  "opening.card.23",
  "opening.card.24",
  "opening.info.i11.advance",
  "opening.card.25",
  "opening.card.26",
  "opening.card.27",
  "opening.card.28",
  "opening.card.29",
  "opening.card.30",
  "opening.board.25_30.advance",
  "opening.info.i12.advance",
  "opening.card.31",
  "opening.card.31.advance",
  "opening.card.32",
  "opening.card.32.advance",
  "opening.card.33",
  "opening.card.33.advance",
  "opening.card.34",
  "opening.card.35",
  "opening.card.35.advance",
  "opening.card.36",
  "opening.card.36.advance",
  "opening.info.i13.advance",
  "opening.card.37",
  "opening.card.38",
  "opening.card.39",
  "opening.card.39.advance",
  "opening.card.40",
  "opening.card.41",
  "opening.card.42",
  "opening.card.3902",
  "opening.card.3902.advance",
  "opening.info.i14.advance",
  "opening.info.i14_2.advance",
  "opening.card.43",
  "opening.card.43.advance",
  "opening.card.44",
  "opening.card.45",
  "opening.card.45.advance",
  "opening.card.46",
  "opening.card.47",
  "opening.card.47.advance",
  "opening.card.48",
  "opening.card.48.advance",
  "opening.info.i15.advance",
  "opening.card.49",
  "opening.card.49.advance",
  "opening.card.50",
  "opening.card.50.advance",
  "opening.card.51",
  "opening.card.51.advance",
  "opening.card.52",
  "opening.card.52.advance",
  "opening.card.53",
  "opening.card.53.advance",
  "opening.card.54",
  "opening.card.54.advance",
  "opening.info.i16.advance",
  "opening.info.i34.advance",
  "opening.info.i34_2.advance",
  "opening.card.22.advance",
  "opening.card.23.advance",
  "opening.team.select.fedya",
  "opening.team.select.aliona",
  "opening.team.select.leo",
  "opening.team.select.grisha",
  "opening.team.select.liza",
  "opening.team.select.zenya",
  "opening.team.select.zora",
  "opening.team.select.arkadii",
  "opening.team.select.vasya",
  "opening.team.select.tima",
  "opening.team.confirm"
]);

const createRegistryMap = (bundle: GameBundle) => {
  const registry = new Map<string, RuntimeActionHandler<RuntimeState>>();

  for (const definition of listManifestActionDefinitions(bundle)) {
    if (definition.handlerType === "script") {
      const capabilityFamily = resolveActionCapabilityFamily(definition.capabilityFamily, definition.capability);
      registry.set(definition.actionId, createDeterministicHandler(capabilityFamily));
      continue;
    }

    if (
      definition.handlerType === "manifest-data" &&
      SUPPORTED_MANIFEST_DATA_ACTIONS.has(definition.actionId)
    ) {
      const capabilityFamily = resolveActionCapabilityFamily(definition.capabilityFamily, definition.capability);
      registry.set(definition.actionId, createDeterministicHandler(capabilityFamily, { mode: "manifest-action" }));
    }
  }

  return registry;
};

export function createRuntimeActionRegistry(bundle: GameBundle): RuntimeActionRegistry<RuntimeState> {
  const registry = createRegistryMap(bundle);

  return {
    get(actionId: string) {
      return registry.get(actionId);
    },
    has(actionId: string) {
      return registry.has(actionId);
    },
    list() {
      return [...registry.keys()];
    }
  };
}

export function getRegisteredActionDefinition(bundle: GameBundle, actionId: string) {
  return getManifestActionDefinition(bundle, actionId);
}
