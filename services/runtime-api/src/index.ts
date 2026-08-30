export interface RuntimeApiModuleDescriptor {
  id: string;
  description: string;
}

export * from "@cubica/contracts-session";
export * from "@cubica/contracts-runtime";
export * from "./modules/session/inMemorySessionStore.ts";
export * from "./modules/session/postgresSessionStore.ts";
export * from "./modules/session/sessionStoreFactory.ts";
export * from "./modules/content/manifestLoader.ts";
export * from "./modules/runtime/index.ts";
export * from "./modules/player-api/httpServer.ts";

export const runtimeApiModules: RuntimeApiModuleDescriptor[] = [
  { id: "player-api", description: "External client-facing session and action endpoints." },
  { id: "session", description: "Session lifecycle, locks, sequencing and recovery." },
  { id: "runtime", description: "Deterministic Game Intent execution through typed transactional mechanics plans." },
  { id: "content", description: "Manifest bundle loading, validation and version resolution." },
  { id: "ai", description: "Optional AI capabilities, prompt orchestration and normalization." },
  { id: "telemetry", description: "Structured logs, traces, metrics and audit trail." },
  { id: "admin", description: "Health, readiness, replay and internal operations endpoints." }
];

export function listRuntimeApiModules(): RuntimeApiModuleDescriptor[] {
  return [...runtimeApiModules];
}
