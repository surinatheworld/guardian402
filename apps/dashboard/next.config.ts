import type { NextConfig } from "next";

// Pages read Fuji, the Guardian API or the agent control API from the browser (docs/SPEC.md §11). The only
// server code is the accounts API (src/app/api, src/server: SQLite on node:sqlite). The shared package ships
// TypeScript sources, so Next transpiles it.
//
// Public endpoint: a browser on another machine (public tunnel) cannot reach 127.0.0.1, so it calls these
// same-origin paths and the dashboard forwards them to the services on its own host (src/lib/config.ts).
// The agent control API lives under /api/agent-control: /api/agent/v1/* is the dashboard's own agent REST
// API, and a rewrite there would capture its dynamic routes (checks/:checkId, transactions/:hash).
const config: NextConfig = {
  allowedDevOrigins: (process.env.DASHBOARD_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  transpilePackages: ["@guardian402/shared"],
  reactStrictMode: true,
  experimental: { optimizePackageImports: ["@gravity-ui/icons"] },
  poweredByHeader: false,
  // The five destinations of the Phase 15 redesign replaced these pages; keep old links working.
  async redirects() {
    return [
      { source: "/kiem-tra", destination: "/chay-thu", permanent: false },
      { source: "/demo", destination: "/chay-thu", permanent: false },
      { source: "/da-chan", destination: "/hoat-dong?xem=rejected", permanent: false },
      { source: "/dieu-khien", destination: "/quy-tac", permanent: false },
      { source: "/doanh-thu", destination: "/ve-guardian", permanent: false },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/guardian/:path*",
        destination: `${(process.env.GUARDIAN_PROXY_URL || "http://127.0.0.1:4402").replace(/\/$/, "")}/:path*`,
      },
      {
        source: "/api/agent-control/:path*",
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
