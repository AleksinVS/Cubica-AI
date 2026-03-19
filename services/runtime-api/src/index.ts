export interface RuntimeApiModuleDescriptor {
  id: string;
  description: string;
}

export * from "./modules/session/contracts.ts";
export * from "./modules/session/inMemorySessionStore.ts";
export * from "./modules/content/manifestLoader.ts";
export * from "./modules/player-api/httpServer.ts";

export const runtimeApiModules: RuntimeApiModuleDescriptor[] = [
  { id: "player-api", description: "External client-facing session and action endpoints." },
  { id: "session", description: "Session lifecycle, locks, sequencing and recovery." },
  { id: "runtime", description: "Deterministic game execution and effect assembly." },
  { id: "content", description: "Manifest bundle loading, validation and version resolution." },
  { id: "ai", description: "Optional AI capabilities, prompt orchestration and normalization." },
  { id: "telemetry", description: "Structured logs, traces, metrics and audit trail." },
  { id: "admin", description: "Health, readiness, replay and internal operations endpoints." }
];

export function listRuntimeApiModules(): RuntimeApiModuleDescriptor[] {
  return [...runtimeApiModules];
}
