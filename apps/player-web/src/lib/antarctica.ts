import type { PlayerFacingContent, PlayerFacingMockup } from "@cubica/contracts-manifest";
import type { CreateSessionResponse, DispatchActionResponse } from "@cubica/contracts-session";

export type { PlayerFacingMockup as AntarcticaMockup };

export interface AntarcticaPlayerSourceData {
  content: PlayerFacingContent;
  runtimeApiUrl: string;
}

export interface ActionEntry {
  actionId: string;
  displayName: string;
  capabilityFamily: string | null;
  capability: string | null;
}

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
const playerWebUrl = process.env.PLAYER_WEB_URL ?? "http://localhost:3000";

const parseJson = <TValue,>(raw: string): TValue => JSON.parse(raw) as TValue;

export async function loadAntarcticaPlayerContent(): Promise<PlayerFacingContent> {
  const response = await fetch(`${playerWebUrl}/api/runtime/player-content/antarctica`);
  if (!response.ok) {
    throw new Error(`Failed to load player content: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return parseJson<PlayerFacingContent>(text);
}

export function getRuntimeApiUrl() {
  return runtimeApiUrl;
}

export function getActionEntries(content: PlayerFacingContent): Array<ActionEntry> {
  return content.actions.map((action) => ({
    actionId: action.actionId,
    displayName: action.displayName,
    capabilityFamily: action.capabilityFamily,
    capability: action.capability
  }));
}

export type SessionSnapshot = CreateSessionResponse<Record<string, unknown>>;
export type ActionSnapshot = DispatchActionResponse<Record<string, unknown>>;
