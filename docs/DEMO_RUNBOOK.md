# Guardian402 demo runbook (3 minutes, Fuji)

Everything runs on Avalanche Fuji testnet. Say this at the start of the pitch: **DEMO MODE is on. The oracle, the
DEX pools, the attack scenarios and the 3+3 lookalike address are simulated. No real money.**

Addresses (from `packages/shared/src/addresses/fuji.json`):

|                     | Address                                      |
| ------------------- | -------------------------------------------- |
| AgentVault          | `0x6A8CCC880238DF1f4309d1B04EDFBD6017A4Cf3c` |
| MockRouter (DEMO)   | `0xe20967C615e442991D468ed7f797edcAeA1771d9` |
| mWAVAX (DEMO)       | `0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5` |
| USDC (Circle, Fuji) | `0x5425890298aed601595a70AB815c96711a31Bc65` |

## The night before

- [ ] `git pull`, `pnpm install`, `cd contracts && forge build` on the demo laptop.
- [ ] `.env.local` at the repo root has `AGENT_PK`, `OWNER_PK` (or the owner wallet in the browser), `GUARDIAN_SIGNER_PK`, `PAY_TO`, `FACILITATOR_PK`.
- [ ] Run the checks below once and top up anything that is low.

## Pre-demo checklist (15 minutes before)

Set the shell variables once:

```bash
RPC=https://api.avax-test.network/ext/bc/C/rpc
USDC=0x5425890298aed601595a70AB815c96711a31Bc65
VAULT=0x6A8CCC880238DF1f4309d1B04EDFBD6017A4Cf3c
ROUTER=0xe20967C615e442991D468ed7f797edcAeA1771d9
MWAVAX=0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5
AGENT=$(cast wallet address --private-key "$AGENT_PK")
```

| Check                                   | Command                                                                                      | Needs                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| Agent AVAX (gas)                        | `cast balance $AGENT --rpc-url $RPC --ether`                                                 | ≥ 0.05                  |
| Agent USDC (x402 fees, 0.005–0.01 each) | `cast call $USDC "balanceOf(address)(uint256)" $AGENT --rpc-url $RPC`                        | ≥ 100000 (0.1 USDC)     |
| Vault USDC                              | `cast call $USDC "balanceOf(address)(uint256)" $VAULT --rpc-url $RPC`                        | ≥ 10000000 (10 USDC)    |
| Vault USDC spent today                  | `cast call $VAULT "remainingToday(address)(uint256)" $USDC --rpc-url $RPC`                   | ≥ 4000000 (two S1 runs) |
| Router mWAVAX                           | `cast call $MWAVAX "balanceOf(address)(uint256)" $ROUTER --rpc-url $RPC`                     | ≥ 1 mWAVAX              |
| Vault not paused                        | `cast call $VAULT "paused()(bool)" --rpc-url $RPC`                                           | `false`                 |
| Facilitator gas (self-hosted)           | `cast balance $(cast wallet address --private-key "$FACILITATOR_PK") --rpc-url $RPC --ether` | ≥ 0.01                  |

Top-ups: `pnpm seed:fuji` (idempotent) refills the vault and gas for owner and agent. USDC for the agent: Circle's
faucet (https://faucet.circle.com, Avalanche Fuji). AVAX: the Avalanche faucet (https://core.app/tools/testnet-faucet).

Start the services, one terminal each (Docker Desktop must be running on Windows):

```bash
pnpm fork
```

```bash
FACILITATOR_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc pnpm facilitator
```

```bash
NETWORK=fuji CHAIN_RPC_URL=https://avalanche-fuji-c-chain-rpc.publicnode.com FACILITATOR_URL=http://127.0.0.1:4022 DEMO_MODE=true pnpm dev:guardian
```

```bash
NETWORK=fuji CHAIN_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc DEMO_MODE=true pnpm dev:agent
```

```bash
pnpm dev:dashboard
```

Then:

- [ ] `curl http://127.0.0.1:4402/v1/health` shows `"ok":true`, `"network":"fuji"`, `"demoMode":true`.
- [ ] `curl http://127.0.0.1:4022/supported` answers (facilitator reachable).
- [ ] http://localhost:3000 shows the yellow DEMO MODE banner, the vault balances, and "✓ khớp guardian của vault".
- [ ] Warm-up: run S1 once from the Điều khiển page (or `pnpm agent scenario S1`), 5 minutes before going on stage. Since P14 a cold first check is retried instead of failing, so this is a rehearsal, not a fix.
- [ ] Optional speed check: `pnpm bench:guardian 10` → p50 about 250 ms with the Guardian reading Fuji through PublicNode (measured 2026-11-09; 733 ms through the official RPC). Keep `FUJI_RPC_URL` (the fork's upstream) on the official RPC: PublicNode drops older state and breaks the fork a few minutes after a reset.
- [ ] Do not run `pnpm eval` during the demo: it resets the fork.

## The 3 minutes

| Time      | Show                       | Say                                                                                                                                                                                         |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | Tổng quan page             | The agent's money sits in AgentVault. Caps, allowlists and a kill switch are on-chain. Every check costs a few cents in USDC over x402. DEMO MODE is on.                                    |
| 0:20–0:50 | Điều khiển → **S1**        | A normal swap: Guardian LOW, the x402 fee and the vault transaction open on Snowtrace.                                                                                                      |
| 0:50–1:30 | Điều khiển → **S2**        | A prompt-injected agent tries to send the whole balance to an attacker. Guardian HIGH with a Vietnamese explanation; the agent sends it anyway and the vault reverts `RecipientNotAllowed`. |
| 1:30–2:20 | Điều khiển → **S4**        | The key case: a swap through a manipulated pool passes every static rule. Only the simulation sees 30% slippage. The vault rejects the HIGH verdict: `RiskTooHigh`.                         |
| 2:20–2:40 | Doanh thu page             | Every check was paid: count, total, settlement links.                                                                                                                                       |
| 2:40–3:00 | Đã chặn page, eval numbers | Everything that was stopped, with reasons. Eval: 40 synthetic cases, report in `eval/report.md`.                                                                                            |

Optional if there is time: S6 (owner pauses, the agent is blocked), Kiểm tra giao dịch with the S3 preset (lookalike address), and the MCP agent paying for a check (`pnpm mcp:example`, see README "MCP server").

S0 (`transfer` of 1.5 USDC to the treasury, LOW, executes) is the plain "agent payment" case; it costs 1.5 USDC of the vault per run, so keep it out of repeated rehearsals. The same scenarios from a terminal: `NETWORK=fuji CHAIN_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc DEMO_MODE=true pnpm agent scenario S1` (then S2, S4).

## Fallback

| Problem                                             | Do this                                                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public facilitator fails (`502`, settlement errors) | The commands above already use the self-hosted facilitator. If even that fails, check `FACILITATOR_PK` has AVAX.                                                                                    |
| Fuji RPC rate-limited (HTTP 429, Cloudflare 1015)   | Reads already fall back to the other public endpoint. If the fork itself is starved, set `FUJI_RPC_URL` to a provider URL with a key (archive or full state), restart `pnpm fork` and the Guardian. |
| Guardian returns `SIMULATION_FAILED` on S1          | Fork was cold or lagging: wait 20 s and run S1 again; if it repeats, restart `pnpm fork` and the Guardian.                                                                                          |
| A scenario says "KHÔNG KHỚP"                        | Read the line: usually low balances (checklist) or a paused vault. Unpause from Điều khiển.                                                                                                         |
| Anything else, or the network is down               | Show the Snowtrace links in `docs/PROGRESS.md` (P8 and P9 sections).                                                                                                                                |
| Docker is not running (Windows)                     | Start Docker Desktop, then `pnpm fork` again.                                                                                                                                                       |
