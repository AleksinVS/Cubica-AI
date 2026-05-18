import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../"),
  async rewrites() {
    return [
      {
        source: "/api/runtime/player-content/:gameId",
        destination: "http://localhost:3001/games/:gameId/player-content"
      },
      {
        source: "/api/runtime/:path*",
        destination: "http://localhost:3001/:path*"
      }
    ];
  }
};

export default nextConfig;
