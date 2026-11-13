// Bundles the agent-side MCP server (apps/guardian-mcp/src/agent-main.ts) into one file for `npx guardian402-mcp`.
// The workspace package @guardian402/shared is bundled in; every other import stays a dependency of this package,
// and the build fails if the bundle needs a package that package.json does not list.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const deps = Object.keys(pkg.dependencies);
const seen = new Set();

await build({
  entryPoints: [join(here, "../../apps/guardian-mcp/src/agent-main.ts")],
  outfile: join(here, "dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  plugins: [
    {
      name: "external-deps",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.kind === "entry-point" || /^[A-Za-z]:[\\/]/.test(args.path)) return undefined;
          if (args.path.startsWith("@guardian402/") || args.path.startsWith("node:")) return undefined;
          const name = args.path.startsWith("@")
            ? args.path.split("/").slice(0, 2).join("/")
            : args.path.split("/")[0];
          seen.add(name);
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

const missing = [...seen].filter((d) => !deps.includes(d));
if (missing.length) {
  console.error(`the bundle imports packages that are not dependencies: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`dist/index.js · external: ${[...seen].sort().join(", ")}`);
