import type { NextConfig } from "next";

const API = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  transpilePackages: ["@autoreel/shared"],
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      { source: "/files/:path*", destination: `${API}/files/:path*` },
    ];
  },
};
export default config;
