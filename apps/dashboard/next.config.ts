import type { NextConfig } from "next";

// Pages read Fuji, the Guardian API or the agent control API from the browser (docs/SPEC.md §11). The only
// server code is the accounts API (src/app/api, src/server: SQLite on node:sqlite). The shared package ships
// TypeScript sources, so Next transpiles it.
const config: NextConfig = {
  transpilePackages: ["@guardian402/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/guardian/:path*",
        destination: "http://127.0.0.1:4402/:path*",
      },
      {
        source: "/api/agent/:path*",
        destination: "http://127.0.0.1:4403/:path*",
      },
      {
        source: "/api/rpc",
        destination: "http://127.0.0.1:8545",
      },
    ];
  },
};

export default config;
