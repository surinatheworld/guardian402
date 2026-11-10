import type { NextConfig } from "next";

// Pages read Fuji, the Guardian API or the agent control API from the browser (docs/SPEC.md §11). The only
// server code is the accounts API (src/app/api, src/server: SQLite on node:sqlite). The shared package ships
// TypeScript sources, so Next transpiles it.
const config: NextConfig = {
  transpilePackages: ["@guardian402/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
  // Hackathon demo: the proxied APIs are open to any origin so a frontend on another machine can call the
  // public URL directly (no cookies are used, so `*` is enough). Do not keep this for a production deployment.
  async headers() {
    return [
      {
        source: "/api/:service(guardian|agent|rpc)/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, PATCH, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
          { key: "Access-Control-Expose-Headers", value: "*" },
        ],
      },
      {
        source: "/api/rpc",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
    ];
  },
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
