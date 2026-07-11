import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  transpilePackages: ["@cubica/editor-engine"],
  experimental: {
    // The editor has a large dependency graph (Monaco, graph UI and Agent UI).
    // One worker prevents its build from competing with the player and desktop
    // applications for memory; the trade-off is a longer, stable build.
    cpus: 1,
    webpackMemoryOptimizations: true,
    // Lazy production entry loading reduces idle memory after editor startup.
    preloadEntriesOnStart: false
  }
};

export default nextConfig;
