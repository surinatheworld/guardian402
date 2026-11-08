# Guardian402 threat model

Scope: the MVP on Avalanche Fuji (testnet only). AgentVault, the Guardian API, the demo agent and the dashboard.
Written in P11 (2026-11-07), together with a security review of AgentVault.

## Assets

| Asset                                                | Where                                   | Why it matters                                               |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Funds in AgentVault (USDC, AVAX, mWAVAX)             | on-chain, owner's vault                 | the thing an attacker wants to move                          |
| Agent key (`AGENT_PK`)                               | agent process                           | can call `executeBatch`; pays x402 fees from a small balance |
| Guardian signer key (`GUARDIAN_SIGNER_PK`)           | Guardian process                        | signs verdicts; holds no funds                               |
| Owner key / wallet                                   | owner's browser wallet (Core, MetaMask) | full control: withdraw, pause, policy                        |
| Facilitator key (`FACILITATOR_PK`, self-hosted only) | facilitator process                     | pays settlement gas; holds a little AVAX                     |
| Verdict nonce and policy                             | AgentVault storage                      | replay protection and limits                                 |
| Check history                                        | Guardian SQLite                         | audit trail; no personal data, no IPs                        |

## Actors

- **Owner**: trusted. Sets policy, can pause, withdraw, revoke the agent and run any call (`ownerExecute`).
- **Agent**: semi-trusted. An AI-driven process that may be manipulated (prompt injection) or have its key stolen.
- **Guardian**: semi-trusted service. Its verdict is a second signature, not custody.
- **Facilitator**: third party (Ultravioleta DAO) or self-hosted. Settles x402 payments only.
- **External attacker**: controls content the agent reads (news, web pages, token metadata), can deploy contracts, mine lookalike addresses, and send transactions.
- **LLM provider**: writes explanation text only.

## Trust assumptions

1. The owner's wallet is not compromised. The vault cannot protect against its own owner.
2. Allowlisted targets (MockRouter in the demo) behave as their code says. The vault allowlists contracts, not intentions.
3. Fuji and the Anvil fork agree closely enough for a 60-second window (see "Simulation divergence").
4. The Guardian signer key and the agent key are different keys on different processes. Holding one is not enough to break the policy.
5. The LLM is untrusted: it only writes text, and the risk level never depends on it.

## Defence in depth

Each agent batch must pass every layer that applies:

1. **AgentVault static policy (always, on-chain):** pause flag, agent address, at most 8 calls, allowlisted targets and selectors, allowlisted recipients and spenders, `maxApproval`, per-day cap per token and for AVAX.
2. **AgentVault verdict rules (on-chain):** approvals and outflows above the verdict threshold need a Guardian verdict, bound to the exact calls (`callsHash`), the vault (EIP-712 domain), the current nonce and a 60 s deadline, with risk ≤ `maxAgentRisk` (THẤP by default).
3. **Guardian checks (off-chain):** simulation on a fork plus 8 deterministic rules. HIGH risk means the vault rejects the verdict.
4. **Batch hygiene (on-chain, added in P11):** approvals granted on the agent path are revoked at the end of the batch.
5. **Owner controls:** kill switch, revoke agent, change caps, withdraw at any time, also while paused.

## Attacks and mitigations

### Agent key compromise

An attacker who holds `AGENT_PK` can call `executeBatch` with any calls.

- Without a verdict: only batches with no approval and no outflow above the verdict threshold (1 USDC, 0.01 AVAX in the demo), to allowlisted targets and recipients, within the daily cap. Every transfer goes to an allowlisted recipient (the team treasury in the demo).
- Leftover allowance (fixed in P11, finding F1): before the fix, an allowance left from an earlier verdict-backed approval let the attacker run swaps at or below the threshold with no verdict, and send the swap output anywhere. Approvals now never outlive their batch.
- With a verdict: the attacker would also need the Guardian to sign a LOW verdict for those exact calls. Drains, unknown spenders, lookalikes, unlimited approvals, bad slippage and redirected swap output come back HIGH (`eval/report.md`), and the vault rejects HIGH.
- Worst case: daily cap per token per day (20 USDC in the demo), to allowlisted recipients only. The owner can pause or revoke the agent at any time.

### Guardian signer compromise

An attacker who holds `GUARDIAN_SIGNER_PK` can sign any verdict, but cannot call `executeBatch` (only the agent can) and cannot move funds. With both keys, the static policy still holds: allowlists, `maxApproval` and the daily cap. Response: the owner calls `setGuardian` with a new signer, or `setGuardian(0)` to accept no verdicts.

### Simulation divergence between check and execution

The Guardian simulates on a fork that can trail Fuji by up to the reset interval (5 minutes, or 120 s of lag). State can also change between the check and the transaction (oracle price, pool inventory, balances).

- The verdict binds the calls, not the outcome. A swap simulated at one price can execute at another.
- Mitigations: 60 s deadline and single-use nonce; on-chain caps that do not depend on the simulation; daily cap counted on the real outflow; agents should set `minOut` (the Guardian flags `minOut = 0` swaps through a bad pool as HIGH).
- Residual: a contract that behaves differently on the fork than on Fuji (for example one that checks `block.number`) can pass the simulation. The allowlist limits which contracts can be called at all.

### Facilitator downtime

If the x402 facilitator is down, `/v1/check` and `/v1/cosign` cannot settle and return an error; the agent pays nothing (settlement only runs after a successful response). No verdict means no batch that needs one: the system fails closed. Fallback: the self-hosted facilitator (`pnpm facilitator`), used on 2026-11-07 when the public one returned `502 upstream_rpc_unavailable`.

### Guardian downtime

No verdicts: only small, allowlisted batches without approvals run (see "Agent key compromise, without a verdict"). The system fails closed for everything else. The owner keeps full control.

### Malicious or compromised allowlisted protocol

An allowlisted router could take the vault's tokens (it is a recipient and a spender). Limits: approvals are capped by `maxApproval` and revoked at the end of the batch (P11); outflows are capped per day; the Guardian checks swap output and slippage against the oracle. Residual: within one batch, an allowlisted contract can take up to the approved amount. Keep the allowlist short and audited.

### LLM prompt injection

Two places:

- **The agent's planner.** Content the agent reads can tell it to drain the vault (scenarios S2 and S3, scripted in DEMO mode). The vault and the Guardian do not trust the agent's intent: they check the calls.
- **The Guardian's explainer.** The LLM sees only structured facts (token deltas, rule findings, trusted labels); revert strings and other untrusted text never reach it. It cannot change the risk: risk comes from the rule engine, and the explainer module cannot import the signer (architecture test in `apps/guardian/test/explain.test.ts`). An explanation that contradicts the risk is replaced by the template.

### Replay and cross-vault use

Verdicts carry the vault address in the EIP-712 domain, the chain id, a single-use nonce and a deadline. Scenario S5 shows a reused verdict (`InvalidVerdict`) and an expired one (`VerdictExpired`) on the fork; Foundry tests cover each field.

### Address poisoning

Lookalike recipients and spenders are flagged by `ADDRESS_POISONING` (4+4 hex characters in production, 3+3 in DEMO because mining 4+4 takes too long on a laptop). They are also outside the allowlist, so the vault rejects them anyway.

## Findings of the P11 review

Review of `contracts/src/AgentVault.sol` acting as an outside auditor. Each finding has a test in `contracts/test/AgentVault.audit.t.sol`.

| Id  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                          | Status                                                                                                                                                                                    | Proof                                                                                                                                  |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Medium   | Agent-path approvals outlived their batch. With a leftover allowance, the agent could run swaps at or below the verdict threshold with no verdict, and an allowlisted router's swap takes an output recipient the vault does not check, so the output could go anywhere, up to the daily cap every day. The Guardian also did not check the swap recipient (eval case m15 was a false negative). | Fixed: the vault revokes every approval the batch granted at the end of the batch; `RECIPIENT_NOT_ALLOWLISTED` flags swap output that does not go to the vault or an allowlisted address. | `test_Audit_F1_*` (failed before the fix), `apps/guardian/test/rules.test.ts` "swap whose output goes outside the allowlist", eval m15 |
| F2  | Low      | The daily cap is per UTC day, so up to 2× the cap can leave within minutes around 00:00 UTC.                                                                                                                                                                                                                                                                                                     | Accepted (simple and predictable; each batch still needs a verdict above the threshold).                                                                                                  | `test_Audit_F2_CapResetsAtUtcMidnight` documents it                                                                                    |
| F3  | Info     | A verdict sent with a batch that does not need one is still checked and uses up the nonce. Only the agent can call `executeBatch`, so nobody else can burn nonces.                                                                                                                                                                                                                               | Accepted (SPEC §16).                                                                                                                                                                      | existing tests in `AgentVault.t.sol`                                                                                                   |
| F5  | Low      | The agent control API (`pnpm dev:agent`, 127.0.0.1:4403, DEMO) started a scenario on any POST. A web page open in the owner's browser could send a simple cross-site POST, or rebind its own domain to 127.0.0.1, and run scenarios that spend the agent's testnet USDC.                                                                                                                         | Fixed in P13: Host must be this machine; POST needs the dashboard Origin and the `X-Guardian402-Demo` header, which forces a CORS preflight only the dashboard passes.                    | `apps/agent/test/control.test.ts`                                                                                                      |
| F6  | Low      | Every check waits for one fork (one simulation at a time). A caller who keeps sending checks could make other callers' checks time out.                                                                                                                                                                                                                                                          | Fixed in P13: above `MAX_QUEUED_CHECKS` (8) waiting checks the API answers 503 with `Retry-After`, before the paywall, so nobody is charged.                                              | `apps/guardian/test/hardening.test.ts`                                                                                                 |
| F7  | Info     | A failed check answered 502 with the internal error message (RPC URLs, node errors). The Guardian API also accepted any Host header, so a rebound domain could reach the local API.                                                                                                                                                                                                              | Fixed in P13: 502 carries no details (they stay in the log); the Host must be in `ALLOWED_HOSTS` (default: this machine on `GUARDIAN_PORT`).                                              | `apps/guardian/test/hardening.test.ts`                                                                                                 |
| F4  | Info     | The owner can allowlist an untracked token as a generic target; its transfers then have no cap.                                                                                                                                                                                                                                                                                                  | Accepted: owner configuration. Track every token the vault holds.                                                                                                                         | —                                                                                                                                      |

AgentVault on Fuji was redeployed with the F1 fix on 2026-11-08 (`0x3f6a5852788ff6a46d924C407976bB89487f7651`); after scenario S1 on Fuji its allowance to the router is 0. The first vault (`0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99`) was emptied and paused.

## Dependencies (P14)

- `pnpm audit --prod`: 1 advisory left (was 8). `zod` 3.25.76 inside `@x402/core` 2.28.0 (pinned by the project) can exhaust memory on oversized collections; x402 parses only the payment header with it, which Node caps at 16 KB. Our own code uses `zod` 4.6.7 (patched); request bodies are capped at 64 KB.
- The wallet SDKs that `@wagmi/connectors` pulls in (WalletConnect, MetaMask SDK, Coinbase, Safe, Porto, Gemini) are removed with pnpm overrides: the dashboard uses only injected wallets. `ws` is pinned to 8.21.3.

## Residual risks

Operational: every key sits in plain text in `.env.local` on one laptop, and the deployer key holds four roles on Fuji (deployer, x402 `PAY_TO`, the treasury the vault may pay, owner of ERC-8004 agent 295). Acceptable on testnet; a real deployment splits them and keeps the owner key in a hardware wallet.

- Funds up to the daily cap per day can move to allowlisted recipients with a compromised agent key and a Guardian that misjudges a batch. The eval set is synthetic and written by the team; 100% recall on it is not a guarantee.
- An allowlisted protocol is trusted within the approved amount of one batch.
- Fork lag (up to a few minutes) can make a simulation stale.
- DEMO parts (mock oracle, mock router, scripted attacks, 3+3 lookalikes, self-hosted facilitator) are not production components.
