import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameManifest } from "@cubica/contracts-manifest";

export interface GameBundle {
  gameId: string;
  manifest: GameManifest;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

const resolveGameManifestPath = (gameId: string) =>
  path.resolve(repoRoot, "games", gameId, "game.manifest.json");

export async function loadGameBundle(gameId: string): Promise<GameBundle> {
  const manifestPath = resolveGameManifestPath(gameId);
  const raw = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(raw) as GameManifest;

  return {
    gameId,
    manifest
  };
}

const cloneState = <TState,>(state: TState): TState => structuredClone(state);

const addLegacyAliases = (state: Record<string, unknown>) => {
  const publicState = state.public && typeof state.public === "object" && !Array.isArray(state.public)
    ? (state.public as Record<string, unknown>)
    : null;
  const secretState = state.secret && typeof state.secret === "object" && !Array.isArray(state.secret)
    ? (state.secret as Record<string, unknown>)
    : null;

  if (publicState?.timeline && typeof publicState.timeline === "object" && !Array.isArray(publicState.timeline)) {
    const timeline = publicState.timeline as Record<string, unknown>;

    if (typeof timeline.stepIndex === "number" && timeline.step_index === undefined) {
      timeline.step_index = timeline.stepIndex;
    }

    if (typeof timeline.stageId === "string" && timeline.stage_id === undefined) {
      timeline.stage_id = timeline.stageId;
    }

    if (typeof timeline.screenId === "string" && timeline.screen_id === undefined) {
      timeline.screen_id = timeline.screenId;
    }
  }

  if (secretState?.stagePicks && typeof secretState.stagePicks === "object" && !Array.isArray(secretState.stagePicks)) {
    if (secretState.stage_picks === undefined) {
      secretState.stage_picks = secretState.stagePicks;
    }
  }

  return state;
};

export function extractInitialState(bundle: GameBundle): unknown {
  const state = bundle.manifest.state as unknown as Record<string, unknown> | undefined;
  if (!state) {
    return null;
  }

  return addLegacyAliases(cloneState(state));
}
