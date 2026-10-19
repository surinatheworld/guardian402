# Guardian402

Transaction firewall and co-signer for AI-agent wallets on Avalanche Fuji (testnet only).
Team1 Vietnam UniHack 2026.

Status: phase P0 — repository skeleton and toolchain. No business logic yet.
The full README (quickstart, architecture, DEMO MODE list) is written in phase P11.

- Spec: [docs/SPEC.md](docs/SPEC.md)
- Agent instructions and commands: [CLAUDE.md](CLAUDE.md)
- Phase prompts: [PROMPTS.md](PROMPTS.md)

## Requirements

- Node >= 22.13, pnpm 10 (via `corepack enable pnpm`)
- Foundry 1.8.5 (`foundryup`). If the native `anvil` cannot run, Docker is used for `pnpm fork`.

## Setup

```bash
git clone --recurse-submodules https://github.com/surinatheworld/guardian402
cd guardian402
pnpm install
cp .env.example .env.local
pnpm fork
```
