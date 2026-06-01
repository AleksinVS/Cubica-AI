import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  async rewrites() {
    return [
      {
        source: "/api/runtime/player-content/:gameId",
        destination: `${runtimeApiUrl}/games/:gameId/player-content`
      },
      {
        source: "/api/runtime/:path*",
        destination: `${runtimeApiUrl}/:path*`
      }
    ];
  }
};

export default nextConfig;
