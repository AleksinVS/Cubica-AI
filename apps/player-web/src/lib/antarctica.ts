import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { GameManifest } from "@cubica/contracts-manifest";
import type { CreateSessionResponse, DispatchActionResponse } from "@cubica/contracts-session";

export interface AntarcticaMockup {
  id: string;
  name: string;
  description: string;
  type: string;
  imagePath: string;
}

export interface AntarcticaPlayerSourceData {
  manifest: GameManifest;
  mockups: Array<AntarcticaMockup>;
  runtimeApiUrl: string;
}

const repoRoot = path.resolve(process.cwd(), "..", "..");
const gameRoot = path.resolve(repoRoot, "games", "antarctica");
const mockupDir = path.resolve(gameRoot, "design", "mockups");

const parseJson = <TValue,>(raw: string): TValue => JSON.parse(raw) as TValue;

export async function loadAntarcticaManifest(): Promise<GameManifest> {
  const raw = await readFile(path.resolve(gameRoot, "game.manifest.json"), "utf-8");
  return parseJson<GameManifest>(raw);
}

export async function loadAntarcticaMockups(): Promise<Array<AntarcticaMockup>> {
  const files = (await readdir(mockupDir)).filter((file) => file.endsWith(".design.json")).sort();

  const mockups = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.resolve(mockupDir, file), "utf-8");
      const parsed = parseJson<Record<string, unknown>>(raw);

      return {
        id: typeof parsed.id === "string" ? parsed.id : path.basename(file, ".design.json"),
        name: typeof parsed.name === "string" ? parsed.name : file,
        description: typeof parsed.description === "string" ? parsed.description : "",
        type: typeof parsed.type === "string" ? parsed.type : "mockup",
        imagePath:
          typeof parsed.image === "object" &&
          parsed.image !== null &&
          !Array.isArray(parsed.image) &&
          typeof (parsed.image as Record<string, unknown>).path === "string"
            ? String((parsed.image as Record<string, unknown>).path)
            : ""
      };
    })
  );

  return mockups;
}

export function getRuntimeApiUrl() {
  return process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";
}

export function getActionEntries(manifest: GameManifest) {
  return Object.entries(manifest.actions).map(([actionId, definition]) => ({
    actionId,
    displayName: definition.displayName ?? actionId,
    capabilityFamily: definition.capabilityFamily ?? "unknown",
    capability: definition.capability ?? null
  }));
}

export type SessionSnapshot = CreateSessionResponse<Record<string, unknown>>;
export type ActionSnapshot = DispatchActionResponse<Record<string, unknown>>;
