import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  transpilePackages: ["@cubica/editor-engine"]
};

export default nextConfig;
