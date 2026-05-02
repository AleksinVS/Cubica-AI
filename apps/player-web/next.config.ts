import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/runtime/:path*",
        destination: "http://localhost:3001/api/runtime/:path*"
      }
    ];
  }
};

export default nextConfig;
