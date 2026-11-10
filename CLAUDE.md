# Guardian402 — instructions for the coding agent

## What we are building

Guardian402 is a transaction firewall and co-signer for AI-agent wallets on Avalanche.

Before an agent's transaction runs, the Guardian API:

1. simulates it on an Anvil fork of Avalanche Fuji,
2. scores it with a deterministic rule engine,
3. asks an LLM to write a short explanation (Vietnamese + English) of what the simulation shows,
4. signs an EIP-712 verdict bound to that exact transaction.

The agent's funds live in `AgentVault`, a contract on Fuji. The vault only executes an agent's calls if they pass its on-chain policy (allowlists, daily caps, kill switch) and, when required, carry a valid Guardian verdict. Each check is paid per request in USDC over x402.

- Hackathon: Team1 Vietnam UniHack. Code freeze 2026-11-19, submission 2026-11-21 23:59 (UTC+7).
- Network: Avalanche Fuji only (chain id 43113, CAIP-2 `eip155:43113`).
- Full technical spec: `docs/SPEC.md`. Read the relevant section before every phase.

## Non-negotiable rules (hackathon rules — breaking them costs points or disqualifies)

1. **The LLM never decides whether money moves.** Risk comes only from the rule engine. The LLM only writes explanation text from the simulation result. The explainer module must not import the signer, any wallet client, or anything that can change a risk level.
2. **Every agent action passes AgentVault's policy:** spending caps, allowlists, kill switch.
3. **Non-custodial.** Funds stay in the owner's AgentVault. The owner can withdraw at any time. The Guardian can only sign verdicts; it can never move funds.
4. **No token, no token sale, no real money from users.** Fuji testnet only. Never put mainnet keys or mainnet addresses with funds in this repo.
5. **On-chain data is limited to hashes, payments and state.** No personal data on-chain.
6. **Every mocked or simulated part is behind an explicit flag** (mock oracle, mock pools, scripted attack mode, demo lookalike settings) and shows a `DEMO MODE` banner in the dashboard, so the team can declare it at the start of the pitch.
7. **Tests are mandatory on every money path** in the contracts.

## Engineering rules

- **Do not invent APIs.** For x402, read the installed source and types under `node_modules/@x402/*` (pinned to 2.28.0). For ERC-8004, use the ABIs from the official `erc-8004-contracts` repo. If something is still unclear, stop and ask the team.
- Pin dependency versions. Node >= 22.13, pnpm workspaces.
- One branch per phase (`feat/p1-agentvault`, `feat/p2-…`, …), merged into `main` by pull request after the team reviews it.
- Secrets live in `.env.local` files (git-ignored). Keep `.env.example` files complete and up to date. Never log private keys or full signatures of keys.
- Small, focused commits. Run the relevant tests before saying something works, and paste the real command output when reporting. If a test fails, say so.
- Code, identifiers, comments and commit messages in English. Talk to the team in Vietnamese.
- Keep the "Commands" section below accurate whenever you add a script.
- At the end of each phase, report in Vietnamese: what changed, how to run it, test results, open questions, and anything you mocked.

## Stack

- Contracts: Solidity 0.8.28, Foundry (forge, anvil, cast), OpenZeppelin Contracts exactly v5.7.0. Set `evm_version = "cancun"` in `foundry.toml` (Fuji has the Cancun EIPs active via ACP-131; blob transactions excluded). Do not raise it further unless you have verified Fuji supports the newer EVM version. Use the non-transient `ReentrancyGuard`. Fallback if a Fuji deploy fails: OpenZeppelin v5.4.0 + `shanghai` (SPEC §16).
- TypeScript services: Node 22, TypeScript strict mode, viem 2.x, zod, vitest, Express, better-sqlite3, pino.
- x402: `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch`, all at exactly `2.28.0`.
- Dashboard: Next.js (App Router), wagmi 2.x, viem, Tailwind CSS.

## Repo layout

```
guardian402/
├── CLAUDE.md                  # this file
├── README.md
├── docs/
│   ├── SPEC.md                # technical spec (source of truth)
│   ├── THREAT_MODEL.md        # written in phase 12
│   └── DEMO_RUNBOOK.md        # written in phase 12
├── contracts/                 # Foundry project
│   ├── src/AgentVault.sol
│   ├── src/mocks/             # MockERC20, MockOracle, MockRouter
│   ├── test/
│   └── script/
├── packages/shared/           # ABIs, addresses, EIP-712 types, zod schemas, constants
├── apps/guardian/             # Guardian API: x402 paywall, simulator, rules, explainer, signer, store
├── apps/guardian-mcp/         # bonus B2: the Guardian's checks as paid MCP tools (x402)
├── apps/agent/                # demo agent, scripted scenarios, local control API
├── apps/dashboard/            # Next.js dashboard (Vietnamese UI)
├── eval/                      # labelled cases, runner, report
└── scripts/                   # fork, deploy, seed, lookalike-address mining
```

## Commands

Keep this list true. Add each script here when you create it.

Available now:

- `git submodule update --init --recursive` — fetch `contracts/lib` (OpenZeppelin v5.7.0, forge-std v1.17.0) after a fresh clone
- `pnpm install`
- `pnpm fork` — start an Anvil fork of Fuji on `http://127.0.0.1:8545` with `--hardfork cancun` (`scripts/fork.mjs`). `ANVIL_RUNNER=auto|native|docker`; `auto` uses native `anvil` if it runs, else the `ghcr.io/foundry-rs/foundry:v1.8.5` Docker image (needed where Windows Smart App Control blocks `anvil.exe`; on Windows, WSL2 is recommended, see README). `FORK_PORT=8546 pnpm fork` starts a second fork (for the MCP server). The fork's upstream (`FUJI_RPC_URL`) must keep recent state: PublicNode does not ("missing trie node" a few minutes after a reset), the official RPC does
- `cd contracts && forge build` / `cd contracts && forge test -vvv` — contract build and tests (unit, fuzz, invariant)
- `cd contracts && forge coverage --report summary --no-match-coverage "(test|script)/"` — coverage of `src/`
- `pnpm test` (same as `pnpm -r test`) — TypeScript tests in every workspace package
- `pnpm typecheck` — `tsc` in every workspace package
- `pnpm lint` — ESLint over the TypeScript workspace
- `pnpm format` / `pnpm format:check` — Prettier

- `pnpm deploy:local` / `pnpm seed:local` — deploy and seed on the running `pnpm fork` (wrapper `scripts/contracts.mjs`; secrets from root `.env.local`; refuses any chain id other than 43113). On the fork it funds the keys (and `FACILITATOR_PK` if set) with test AVAX and mints test USDC to the owner (100) and the agent (5)
- `pnpm deploy:fuji` / `pnpm seed:fuji` — same on Fuji; addresses go to `packages/shared/src/addresses/<network>.json`. Seed is idempotent.
- `pnpm verify:fuji` — verify the Fuji contracts on Routescan / testnet.snowtrace.io
- `pnpm handoff:fuji` — start the Ownable2Step transfer of AgentVault to the team lead's wallet
- `pnpm redeploy-mocks:fuji` / `pnpm swap-router:fuji <oldRouter>` — replace mWAVAX and MockRouter (verified in the same run), then move the vault allowlist from the old router to the new one
- `pnpm redeploy-vault:fuji` — deploy a new AgentVault with the current code (verified in the same run) and keep the mocks; if `OWNER_PK` owns the old vault it is emptied to the owner and paused first. Then run `pnpm seed:fuji`, `pnpm handoff:fuji` and `pnpm known-contracts`. It also points `local.json` at the new vault, because the fork tests and `local` mode use the seeded Fuji deployment
- `node scripts/contracts.mjs adopt local` — fork only: impersonate the owners on the running fork and move the seeded Fuji vault to `OWNER_PK` and the DEMO mocks to `DEPLOYER_PK`, so `pnpm seed:local` can set the agent, the guardian, the oracle price and test USDC for fresh keys. Plain JSON-RPC, no `cast` (works where Smart App Control blocks `cast.exe`). Changes fork state only; no deploy, no tracked file
- `pnpm abi` — `forge build`, then regenerate `packages/shared/src/abi/*.ts` (committed)
- `pnpm test:crosscheck` — sign a verdict in TypeScript, write `contracts/test/fixtures/verdict.json`, run `VerdictCrossCheck.t.sol`
- `pnpm known-contracts` — regenerate `apps/guardian/config/known-contracts.{fuji,local}.json` from the deployed addresses (run after a deploy)
- `pnpm --filter @guardian402/guardian fixtures:rules` — capture real `SimResult` fixtures for the rule tests into `apps/guardian/test/fixtures/rules/` (needs `pnpm fork`)
- `pnpm --filter @guardian402/guardian test:fork` — simulator integration tests (`*.fork.test.ts`); needs `pnpm fork` running. Resets the fork to the latest Fuji block first and uses the seeded Fuji deployment. Each run makes many calls to the public Fuji RPC, which rate-limits (HTTP 429 / Cloudflare 1015): avoid running it in a tight loop

- `pnpm dev:guardian` — Guardian API on http://127.0.0.1:4402 (`NETWORK=local`: everything on the fork; `NETWORK=fuji` with `CHAIN_RPC_URL` = Fuji: vault read on Fuji, simulation on the fork reset from Fuji)
- `pnpm facilitator` — self-hosted x402 facilitator on http://127.0.0.1:4022, settling on `FACILITATOR_RPC_URL` (default `CHAIN_RPC_URL`); needs `FACILITATOR_PK` with a little AVAX. Point the Guardian at it with `FACILITATOR_URL=http://127.0.0.1:4022`
- `pnpm --filter @guardian402/guardian pay-check [check|cosign]` — one paid S1 call from the agent wallet; prints the settlement link

- `pnpm agent scenario <S0..S6|all>` — run the demo scenarios (docs/SPEC.md §10) against the Guardian on `GUARDIAN_URL` and the vault on `CHAIN_RPC_URL`; S2–S6 need `DEMO_MODE=true`, S6 needs `OWNER_PK`. S0 (and `all`) spends 1.5 USDC of the vault each run. Prints risk, explanation, x402 settlement and vault tx; appends to `apps/agent/data/attempts.jsonl`; exits 1 on any mismatch with the spec table
- `pnpm dev:agent` — local control API on http://127.0.0.1:4403 (`POST /scenario/:id`, `GET /attempts`, `GET /health`), `DEMO_MODE=true` only
- `pnpm mine-lookalike [fuji|local] [chars]` — mine a lookalike of the MockRouter address with `cast wallet vanity` into `apps/agent/fixtures/lookalike.json` (default 3+3 characters, DEMO)

- `pnpm dev:dashboard` — Next.js dashboard on http://localhost:3000 (Vietnamese UI; settings in `apps/dashboard/.env.local`, see its `.env.example`). Reads Fuji (or the fork), the Guardian API and the agent control API from the browser; the Guardian's `DASHBOARD_ORIGIN` must be `http://localhost:3000`
- `pnpm --filter @guardian402/dashboard build` — production build of the dashboard
- Dashboard accounts (no separate command; part of `pnpm dev:dashboard`): `/tai-khoan` page and the route handlers `/api/auth/{register,login,logout,me,siwe/nonce,siwe/verify}` and `/api/account/{profile,password,wallets/:address,vaults,vaults/:address}`, on SQLite at `ACCOUNT_DB` (default `apps/dashboard/data/accounts.db`, git-ignored). Web2 email + scrypt password and web3 Sign-In with Ethereum (EIP-4361); vaults link only when their on-chain `owner()` is one of the user's wallets. Schema and rules in `apps/dashboard/src/server/`; tests in `apps/dashboard/test/accounts.test.ts`. Vault workspace under `/api/vaults/:vault/{agents,contacts,policy-changes,alert-rules,notifications,checks}` (agent registry, address book with lookalike check, owner policy changes verified on chain, alerts from Guardian checks and cap usage, check reviews; `test/workspace.test.ts`). Pages: `/tai-khoan` and `/quan-ly` (tabs Agent, Danh bạ, Chính sách, Cảnh báo, Kiểm tra). Full reference: `docs/API.md`

- `pnpm erc8004:fuji` — bonus B1: register the Guardian on the official ERC-8004 IdentityRegistry on Fuji (`0x8004A818…4BD9e`) with `DEPLOYER_PK`, store the `registration-v1` file as a base64 data-URI agentURI, and write `packages/shared/src/addresses/erc8004.fuji.json`. Idempotent: reuses the recorded agentId and sends `setAgentURI` only when the file changed. Optional `GUARDIAN_PUBLIC_URL` (public Guardian base URL to advertise; default: the GitHub repo)

- `./run-local.sh [start|setup|stop|status|scenario <id>]` (or `pnpm local`, `pnpm local:setup`, `pnpm local:stop`, `pnpm local:status`) — the whole local stack on the fork: fork, `adopt local` + `seed:local`, facilitator, Guardian, agent API, dashboard. `setup` creates `.env.local` with fresh testnet keys if it is missing (`scripts/init-local-env.mjs`; `--force` keeps a `.bak-*` copy). Never deploys, never edits tracked files, stops only what it started. Logs in `.run-local/logs/`. On Windows run it from Git Bash

- `pnpm --filter @guardian402/guardian llm:compare <provider:model>... [--gap ms] [--verbose]` — run the 14 rule fixtures through each LLM explainer (e.g. `gemini:gemini-3.5-flash-lite groq:<model>`) and print how often the LLM text was used, p50/max latency and fallback reasons. Keys from `.env.local`: `<PROVIDER>_API_KEY` or `LLM_API_KEY` for the provider in `LLM_PROVIDER`. `--gap 4500` stays under a 15 requests/minute free tier

- `pnpm bench:guardian [runs]` — latency of the Guardian pipeline on the free DEMO endpoint `/v1/demo/check` with the S1 batch (default 10 runs; needs a Guardian with `DEMO_MODE=true` on `GUARDIAN_URL`)
- `pnpm mcp` — bonus B2: the Guardian as a paid MCP server over stdio (`apps/guardian-mcp`): tools `check_transaction` (0.005 USDC) and `cosign_transaction` (0.01 USDC), paid over x402. Same env as the Guardian; refuses to start on the fork of a running Guardian API: start `FORK_PORT=8546 pnpm fork` and set `MCP_FORK_RPC_URL=http://127.0.0.1:8546`. History in `GUARDIAN_MCP_DB`
- `pnpm mcp:example [check|cosign]` — an agent (`AGENT_PK`) starts the MCP server, pays for one tool call on the S1 batch and prints the risk and the settlement link; refuses any payment above 0.02 USDC
- `pnpm --filter @guardian402/guardian-mcp test` — MCP tool tests (payment asked, paid call settled, failures not charged)

- `pnpm eval` — run the 40 labelled cases in `eval/cases/` through the Guardian pipeline on a fresh fork and write `eval/report.md` and `eval/report.json`. Needs `pnpm fork` and `cd contracts && forge build`. It resets the fork and deploys its own vault and mocks there: stop any Guardian using the same fork first. Same cases → same fingerprint in the report (latency varies)

## Key constants (details and sources in docs/SPEC.md §2)

- Fuji RPC: `https://api.avax-test.network/ext/bc/C/rpc` · explorer: `https://testnet.snowtrace.io`
- USDC on Fuji: `0x5425890298aed601595a70AB815c96711a31Bc65` (6 decimals, EIP-712 name `USD Coin`, version `2`)
- Default x402 facilitator: `https://facilitator.ultravioletadao.xyz`
