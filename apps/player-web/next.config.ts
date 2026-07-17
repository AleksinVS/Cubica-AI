import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  experimental: {
    // This host runs the player beside the editor and runtime-api. A single build
    // worker keeps peak memory predictable; Webpack's memory mode trades a little
    // build speed for a lower heap peak without weakening type or lint checks.
    cpus: 1,
    webpackMemoryOptimizations: true,
    // Production entries are loaded on first use instead of all at startup. This
    // lowers the resident set when both web applications share an 8 GiB host.
    preloadEntriesOnStart: false
  }
};

export default nextConfig;
