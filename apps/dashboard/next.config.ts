import type { NextConfig } from "next";

// No backend of its own (docs/SPEC.md §11): every page reads Fuji, the Guardian API or the agent control API
// from the browser. The shared package ships TypeScript sources, so Next transpiles it.
const config: NextConfig = {
  transpilePackages: ["@guardian402/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
