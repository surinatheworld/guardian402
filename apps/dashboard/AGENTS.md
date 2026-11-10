# Dashboard design rules

The approved design direction is mandatory for all dashboard changes. Read
`DESIGN.md` in this directory before designing or changing any dashboard UI.
The visual reference is `docs/design/guardian-heroui-v3.html` at the repository
root; its sample data and mock interactions are not production behavior.

Use the shared components and tokens first. Any new UI must match the existing
dashboard across every page, including loading, empty, error, disabled, focus,
mobile and confirmation states. Preserve Vietnamese copy and all existing
security, testnet and demo disclosures. Never replace live information with
invented data or imply a verdict is an on-chain execution.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
