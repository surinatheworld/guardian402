# Guardian402 threat model

Scope: the MVP on Avalanche Fuji (testnet only). AgentVault, the Guardian API, the demo agent and the dashboard.
Written in P11 (2026-11-07), together with a security review of AgentVault.

## Assets

| Asset                                                | Where                                   | Why it matters                                                                                          |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Funds in AgentVault (USDC, AVAX, mWAVAX)             | on-chain, owner's vault                 | the thing an attacker wants to move                                                                     |
| Agent key (`AGENT_PK`)                               | agent process                           | can call `executeBatch`; pays x402 fees from a small balance                                            |
| Guardian signer key (`GUARDIAN_SIGNER_PK`)           | Guardian process                        | signs verdicts; holds no funds                                                                          |
| Owner key / wallet                                   | owner's browser wallet (Core, MetaMask) | full control: withdraw, pause, policy                                                                   |
| Facilitator key (`FACILITATOR_PK`, self-hosted only) | facilitator process                     | pays settlement gas; holds a little AVAX                                                                |
| Verdict nonce and policy                             | AgentVault storage                      | replay protection and limits                                                                            |
| Check history                                        | Guardian SQLite                         | audit trail; no personal data, no IPs                                                                   |
| User accounts and vault workspace                    | dashboard SQLite (`ACCOUNT_DB`)         | off-chain only; scrypt hashes, session token hashes, no keys; policy is only prepared, the wallet signs |

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
2. **AgentVault verdict rules (on-chain):** approvals, outflows above the verdict threshold, and any outflow of a batch that reaches an allowed target (a call to it, native value sent to it, or a token transfer to it) need a Guardian verdict, bound to the exact calls (`callsHash`), the vault (EIP-712 domain), the current nonce and a 60 s deadline, with risk ≤ `maxAgentRisk` (THẤP by default).
3. **Guardian checks (off-chain):** simulation on a fork plus 8 deterministic rules. HIGH risk means the vault rejects the verdict.
4. **Batch hygiene (on-chain, added in P11):** approvals granted on the agent path are revoked at the end of the batch.
5. **Owner controls:** kill switch, revoke agent, change caps, withdraw at any time, also while paused.

## Attacks and mitigations

### Agent key compromise

An attacker who holds `AGENT_PK` can call `executeBatch` with any calls.

- Without a verdict: only direct payments at or below the verdict threshold (1 USDC, 0.01 AVAX in the demo) to allowlisted recipients that are not also allowed targets (the team treasury in the demo), within the daily cap. A batch that reaches an allowed target (the router) can still run, but it cannot move anything out of the vault (second review, R1–R3): the vault cannot check where a target sends what it receives.
- Leftover allowance (fixed in P11, finding F1): before the fix, an allowance left from an earlier verdict-backed approval let the attacker run swaps at or below the threshold with no verdict, and send the swap output anywhere. Approvals now never outlive their batch.
- With a verdict: the attacker would also need the Guardian to sign a LOW verdict for those exact calls. Drains, unknown spenders, lookalikes, unlimited approvals, bad slippage and redirected swap output come back HIGH (`eval/report.md`), and the vault rejects HIGH.
- Worst case: daily cap per token per day (20 USDC in the demo), to allowlisted recipients only. The owner can pause or revoke the agent at any time.

### Guardian signer compromise

An attacker who holds `GUARDIAN_SIGNER_PK` can sign any verdict, but cannot call `executeBatch` (only the agent can) and cannot move funds. With both keys, the static policy still holds: allowlists, `maxApproval` and the daily cap. Response: the owner calls `setGuardian` with a new signer, or `setGuardian(0)` to accept no verdicts.

### Simulation divergence between check and execution

The Guardian simulates on a fork that can trail Fuji by up to the reset interval (5 minutes, or 120 s of lag). State can also change between the check and the transaction (oracle price, pool inventory, balances).

- The verdict binds the calls, not the outcome. A swap simulated at one price can execute at another.
- Mitigations: 60 s deadline and single-use nonce; on-chain caps that do not depend on the simulation; daily cap counted on the real outflow; `UNPROTECTED_SWAP` (since 2026-11-11) rates a swap through a known router MEDIUM when its `minOut` is more than 3% below the simulated output, so a LOW-only vault refuses a swap that would accept whatever the pool gives at execution time. The demo agent sets `minOut` to the oracle quote minus 1%; a pool that moves after the check then makes the swap revert instead of costing the vault.
- Residual: a contract that behaves differently on the fork than on Fuji (for example one that checks `block.number`) can pass the simulation. The allowlist limits which contracts can be called at all.

### Facilitator downtime

If the x402 facilitator is down, `/v1/check` and `/v1/cosign` cannot settle and return an error; the agent pays nothing (settlement only runs after a successful response). No verdict means no batch that needs one: the system fails closed. Fallback: the self-hosted facilitator (`pnpm facilitator`), used on 2026-11-07 when the public one returned `502 upstream_rpc_unavailable`.

### Guardian downtime

No verdicts: only small direct payments to allowlisted recipients run (see "Agent key compromise, without a verdict"). The system fails closed for everything else. The owner keeps full control.

### Malicious or compromised allowlisted protocol

An allowlisted router could take the vault's tokens (it is a recipient and a spender). Limits: approvals are capped by `maxApproval` and revoked at the end of the batch (P11); outflows are capped per day; nothing reaches an allowed target without a verdict (second review, R1–R3), also when the owner has granted it a standing allowance; the Guardian checks swap output and slippage against the oracle. Residual: within one verdict-backed batch, an allowlisted contract can take up to the approved amount. Keep the allowlist short and audited.

### LLM prompt injection

Two places:

- **The agent's planner.** Content the agent reads can tell it to drain the vault (scenarios S2 and S3, scripted in DEMO mode). The vault and the Guardian do not trust the agent's intent: they check the calls.
- **The Guardian's explainer.** The LLM sees only structured facts (token deltas, rule findings, trusted labels); revert strings and other untrusted text never reach it. Token symbols reach it only for trusted tokens (V4). It cannot change the risk: risk comes from the rule engine, and the explainer module cannot import the signer (architecture test in `apps/guardian/test/explain.test.ts`). An explanation that contradicts the risk is replaced by the template.

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

## Findings of the second review (2026-11-11)

Second review of `contracts/src/AgentVault.sol` before the code freeze. No Critical or High finding. Each finding has tests in `contracts/test/AgentVault.review.t.sol` that failed before the fix. The fixes change no ABI, no storage layout and no `Policy` field.

| Id  | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status                                                                                                                                     | Proof                                                                    |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| R1  | Medium   | Native value needs no approval, so F1 did not cover it. A batch that sent AVAX at or below the native threshold to an allowlisted payable target needed no verdict, and the vault cannot check the target's arguments: with a payable entry point that takes an output recipient, the agent key alone could move the native daily cap to any address. Not exploitable with the Fuji configuration (`swapExactIn` is not payable, the vault holds no AVAX). | Fixed: a batch that reaches an allowed target needs a verdict for any outflow.                                                             | `test_Review_R1_*`, `testFuzz_OutflowViaTargetNeedsVerdict`, invariant 7 |
| R2  | Low      | F1 was closed only for approvals granted on the agent path. An allowance the owner grants with `ownerExecute` let the agent swap at or below the threshold with no verdict, output to any address. No product flow grants such an allowance; the Fuji vault's allowance to the router is 0.                                                                                                                                                                | Fixed by the R1 rule.                                                                                                                      | `test_Review_R2_OwnerGrantedAllowanceNeedsVerdict`                       |
| R3  | Low      | One list answers "may be approved" and "may be paid": the router must be an allowed recipient to be approvable, so the agent could transfer tokens straight into it with no verdict, up to the daily cap (recoverable from the DEMO router by its owner; lost to the first caller on a router with a public sweep).                                                                                                                                        | Fixed: a transfer, or a plain native payment, to an address that is also an allowed target makes the batch need a verdict for any outflow. | `test_Review_R3_*`                                                       |
| R4  | Low      | The vault read only the success flag of each call. A tracked token that returns `false` instead of reverting made the batch "succeed": `Executed` was emitted and nothing had moved. Fuji USDC reverts on failure.                                                                                                                                                                                                                                         | Fixed: on the agent path a tracked token must return nothing or `true` (`CallFailed` otherwise).                                           | `test_Review_R4_*`                                                       |
| R5  | Info     | Removing a target kept its selectors in storage; allowing the target again brought every old selector back with no transaction or event for them.                                                                                                                                                                                                                                                                                                          | Fixed: removing a target removes its selectors and emits one event per selector.                                                           | `test_Review_R5_*`                                                       |

**The fixes are on Fuji since 2026-11-11.** AgentVault was redeployed with this code at `0x6A8CCC880238DF1f4309d1B04EDFBD6017A4Cf3c` (Routescan verified) and seeded with the §4.8 policy. Read on Fuji with `eth_call` from the agent: a 0.5 USDC approve + swap through the router with no verdict reverts `VerdictRequired` (R1; the P11 vault accepted it below the 1 USDC threshold), and a direct 0.5 USDC payment to the treasury still passes. The P11 vault `0x3f6a5852788ff6a46d924C407976bB89487f7651` was emptied (32 USDC back to the owner, then into the new vault) and paused.

Checked and found sound (tests `test_ReviewOk_*` and the existing suites): the verdict is bound to the calls, the vault, the chain id, the nonce and the deadline; a failed batch does not use up a nonce; both entry points are `nonReentrant` and a target cannot reach owner functions; agent-path approvals are revoked at the end of the batch; an inflow in the same batch can only hide an outflow with someone else's money, and untracked tokens the vault holds (mWAVAX) cannot be moved by the agent with the current allowlist; fee-on-transfer tokens are counted on what really leaves the vault; the vault is not an ERC-1271 signer; the owner can withdraw everything while paused and while a handoff is pending.

Operational notes, not contract findings:

- The local fork has the same chain id (43113) and vault address as Fuji, so a verdict signed by a Guardian running with `NETWORK=local` is valid on Fuji if both use the same `GUARDIAN_SIGNER_PK` and the nonce matches. Use different signer keys for local and for Fuji (`scripts/init-local-env.mjs` creates fresh ones).
- The team lead accepted ownership of the new vault on 2026-11-11 ([0xaa92a946…6049](https://testnet.snowtrace.io/tx/0xaa92a94601eacd8dd3d42d9edab13fe4b52c134756bca8eb29852183e6456049)): `owner()` is the team lead's browser wallet, so the `OWNER_PK` hot key in `.env.local` no longer controls the vault (it can still fund it).

## Findings of the third review (2026-11-11): verdict binding and x402 charging

Review of the Guardian API: is a verdict usable only for the calls that were simulated, and is a caller charged only for a delivered check? No finding puts vault funds at risk: every verdict carried the true risk and only the vault's agent can use one. Each finding has a test in `apps/guardian/test/verdict-audit.test.ts` that failed before the fix.

| Id  | Severity       | Finding                                                                                                                                                                                                                                                      | Status                                                                                                                 |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| V1  | High (revenue) | A check is stored before the x402 settlement, with the signed verdict, and `GET /v1/checks/:checkId` served it for free. A payment that never settled, or one payment sent with two bodies at once, still gave a valid verdict (and the whole check result). | Fixed: the signature is never stored or served; the free endpoints list a paid check only once its payment row exists. |
| V2  | Medium         | A simulation that could not run (fork or RPC error, timeout) was scored HIGH (`SIMULATION_FAILED`), signed and charged: the caller paid for the Guardian's outage.                                                                                           | Fixed: 503, nothing signed, stored or settled.                                                                         |
| V3  | Medium         | The internal viem error went into `simulation.revertReason`: fork URL and request body, including `FUJI_RPC_URL` (with its API key, if it has one) inside `anvil_reset`.                                                                                     | Fixed: a fixed public text; the detail goes to the log.                                                                |
| V4  | Medium         | A token's own `symbol()` text went unchanged into the LLM prompt and the template explanation (prompt injection; a fake token calling itself "USDC"). The risk and the signature were never affected.                                                        | Fixed: `cleanSymbol` in the simulator; the explanation uses symbols of trusted tokens only.                            |
| V5  | Low            | Invalid input answered 502 instead of 400: a `value` like `"1e3"` (`BigInt` threw inside the schema) and an address with a wrong checksum. Never charged.                                                                                                    | Fixed in `packages/shared/src/schemas.ts`.                                                                             |
| V6  | Low            | An unknown field inside a call (e.g. `operation: 1`) was dropped silently.                                                                                                                                                                                   | Fixed: `callSchema` is strict.                                                                                         |
| V7  | Low            | The explainer received the pipeline's own findings array and could edit what is reported (not the risk or the score).                                                                                                                                        | Fixed: copies.                                                                                                         |
| V8  | Low            | A failed settlement left no log line (wrong x402 hook).                                                                                                                                                                                                      | Fixed: `onSettleFailure`.                                                                                              |

Checked and found sound: the EIP-712 digest and `hashCalls` match Solidity byte for byte (`pnpm test:crosscheck`); every signed field is checked by the vault; the hash and the simulation use the same call array; a non-canonical `value` is refused, never normalised; the explainer cannot reach the risk or the signer; 400 and 502 are not settled; a `/v1/check` payment is refused on `/v1/cosign`; a settled payment cannot be replayed; `/v1/demo/check` does not exist when `DEMO_MODE=false` and never signs; no key or signature is logged.

Left as they are:

- ~~A swap with `minOut = 0` is LOW when its simulated output is good.~~ Decided by the team lead on 2026-11-11 and done: rule `UNPROTECTED_SWAP` (MEDIUM, `minOut` more than 3% below the simulated output); S1 sets `minOut`; S4 keeps `minOut = 0` on purpose and now shows both findings.
- If the Guardian stops between the settlement and the response, the caller has paid and has no verdict, and nothing serves it again (it used to be readable through V1). The caller pays for a new check.
- An x402 payment is not bound to the request body (protocol design): the same unsettled payment can start several simulations at once; only one is paid and only that one is delivered. The busy gate bounds the load.

## Findings of the fourth review (2026-11-12): the dashboard's public proxies

Review of the same-origin proxies a public tunnel exposes (`apps/dashboard`). Both were plain rewrites in `next.config.ts`; both are route handlers now. Tests in `apps/dashboard/test/proxies.test.ts`.

| Id  | Severity      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | High (tunnel) | `/api/rpc` forwarded every JSON-RPC method to the Anvil fork on `127.0.0.1:8545`, in every network mode. Anyone with the public URL could call `anvil_setCode`, `anvil_setStorageAt`, `anvil_reset` or `evm_setAutomine`. The Guardian simulates on that fork: a compromised agent could change fork state so a harmful batch scores LOW and use the verdict on Fuji (still inside the vault's allowlists and daily caps), and anyone could make every check answer 503. | Fixed: `src/server/rpc-proxy.ts` passes only chain reads and signed raw transactions, rebuilds each request, and is off outside `NEXT_PUBLIC_NETWORK=local`.                                                                                                                                                                                                                                   |
| D2  | Medium (DEMO) | `/api/agent-control` forwarded to the agent control API, whose F5 checks (Host, Origin, custom header) stop web pages but not a script: the proxy rewrote Host, and any client can send the `Origin` header. Anyone with the public URL could run S0 until the vault's daily cap was used up, or S6 to pause the vault.                                                                                                                                                  | Fixed: the route starts a scenario only for a signed-in user whose account holds the demo vault (linked only when its on-chain `owner()` is one of the user's wallets), from the same origin, rate-limited; it forwards nothing from the caller and adds the control API's headers itself. Reads (`health`, `attempts`) stay open. The control API is unchanged: it listens on 127.0.0.1 only. |

## Dependencies (P14)

- `pnpm audit --prod`: 1 advisory left (was 8). `zod` 3.25.76 inside `@x402/core` 2.28.0 (pinned by the project) can exhaust memory on oversized collections; x402 parses only the payment header with it, which Node caps at 16 KB. Our own code uses `zod` 4.6.7 (patched); request bodies are capped at 64 KB.
- The wallet SDKs that `@wagmi/connectors` pulls in (WalletConnect, MetaMask SDK, Coinbase, Safe, Porto, Gemini) are removed with pnpm overrides: the dashboard uses only injected wallets. `ws` is pinned to 8.21.3.

## Residual risks

Operational: every key sits in plain text in `.env.local` on one laptop, and the deployer key holds four roles on Fuji (deployer, x402 `PAY_TO`, the treasury the vault may pay, owner of ERC-8004 agent 295). Acceptable on testnet; a real deployment splits them and keeps the owner key in a hardware wallet.

- Funds up to the daily cap per day can move to allowlisted recipients with a compromised agent key and a Guardian that misjudges a batch. The eval set is synthetic and written by the team; 100% recall on it is not a guarantee.
- An allowlisted protocol is trusted within the approved amount of one batch.
- Fork lag (up to a few minutes) can make a simulation stale.
- DEMO parts (mock oracle, mock router, scripted attacks, 3+3 lookalikes, self-hosted facilitator) are not production components.
