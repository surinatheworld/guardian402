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
- Foundry 1.8.5 (`foundryup`). If the native `anvil` cannot run, Docker is used for `pnpm fork` (see Windows setup).

## Setup

```bash
git clone --recurse-submodules https://github.com/surinatheworld/guardian402
cd guardian402
pnpm install
cp .env.example .env.local
pnpm fork
```

## Windows setup

- **Recommended: WSL2.** Install Ubuntu with `wsl --install`, clone the repo inside the WSL filesystem (for example `~/code/guardian402`, not `/mnt/c/...`), and install Node, pnpm and Foundry there as on Linux. Everything, including `pnpm fork`, then runs natively.
- **Fallback: native Windows + Docker.** Windows Smart App Control can block `anvil.exe` ("An Application Control policy has blocked this file"), while `forge` and `cast` still run. Start Docker Desktop and `pnpm fork` runs Anvil from the official `ghcr.io/foundry-rs/foundry:v1.8.5` image instead (`ANVIL_RUNNER=docker` forces it).
- If `corepack enable pnpm` fails with `EPERM` (no write access to `C:\Program Files\nodejs`), install the shim in a user folder: `corepack enable pnpm --install-directory "%LOCALAPPDATA%\corepack-bin"` and add that folder to your `PATH`.
