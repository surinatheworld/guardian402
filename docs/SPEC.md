# Guardian402 — Technical spec

Version 0.2 · 2026-10-19 · Status: source of truth for the MVP. Change it only with the team's agreement, and note the change in §16.

## 0. MVP scope

The MVP is done when everything in §14 is checked. In short:

- `AgentVault` on Fuji with on-chain policy, verdict checking and full tests.
- Guardian API: simulation on a Fuji fork, rule engine, explainer, signed verdicts, paid per request over x402.
- Demo agent with one normal scenario and five attack/edge scenarios.
- Dashboard in Vietnamese.
- Eval set of at least 40 labelled cases with precision and recall.

The pitch talks about "6 risk signals". In this spec they are the six risk rules in §8; `SIMULATION_FAILED` and `POLICY_PRECHECK` are system checks on top.

## 1. How one checked transaction flows

1. The agent builds a batch of calls it wants its vault to run, e.g. `[approve(router, 2 USDC), router.swapExactIn(...)]`.
2. The agent calls `POST /v1/cosign` on the Guardian. The x402 middleware answers `402 Payment Required` with the price (0.01 USDC on Fuji).
3. The agent's x402 client signs a USDC `transferWithAuthorization` (EIP-3009) and retries. No gas is needed from the agent for this step.
4. The Guardian verifies the payment through the facilitator, then runs its pipeline: simulate on the fork → rules → explanation → sign a verdict for these exact calls.
5. The response is buffered; the middleware settles the payment through the facilitator, then sends the response. If the handler returned ≥ 400, nothing is settled.
6. The agent sends `vault.executeBatch(calls, verdict, signature)` on Fuji.
7. The vault re-checks everything on-chain: who is calling, static policy, the verdict signature, nonce, deadline, risk level, then runs the calls and checks daily caps on the actual outflow.
8. If any check fails, the whole transaction reverts and no token leaves the vault.
9. The owner can pause the agent path or revoke the agent at any time.

## 2. Network constants

| Name | Value | Source / note |
| --- | --- | --- |
| Chain id | `43113` | Avalanche Fuji C-Chain |
| CAIP-2 | `eip155:43113` | used by x402 |
| RPC | `https://api.avax-test.network/ext/bc/C/rpc` | public; use a provider key if rate-limited |
| Explorer | `https://testnet.snowtrace.io` | links in every output |
| USDC (Fuji) | `0x5425890298aed601595a70AB815c96711a31Bc65` | 6 decimals, EIP-712 name `USD Coin`, version `2` (Team1 starter `src/networks.mjs`) |
| USDC faucet | `https://faucet.circle.com` (choose Avalanche Fuji) | needs a human to pass a captcha |
| AVAX faucet | Core testnet faucet, or `https://team1vn.xyz/faucet.html` | for gas |
| x402 facilitator (default) | `https://facilitator.ultravioletadao.xyz` | used by the Team1 starter; pays settlement gas |
| Other facilitators on Avalanche | PayAI, thirdweb, x402-rs (self-hosted) | listed in Avalanche Builder Hub x402 course |
| Self-hosted facilitator | pattern in `vendor/x402-starter/src/facilitator.mjs` | needs `FACILITATOR_PK` with a little AVAX |
| ERC-8004 IdentityRegistry (Fuji) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | official `erc-8004-contracts` README |
| ERC-8004 ReputationRegistry (Fuji) | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | official README |
| ERC-8004 ValidationRegistry (Fuji) | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | listed by QuickNode docs, not by the official README — check `cast code` before using |

x402 packages: `@x402/core`, `@x402/evm`, `@x402/express`, `@x402/fetch` at exactly `2.28.0` (same pin as the Team1 starter). Fuji USDC is **not** a default asset in `@x402/evm` (Avalanche mainnet USDC is), which has two consequences, both handled below: prices must be given as an `AssetAmount` (§6.4), and the client must allow the asset explicitly in `spendControls` (§10).

## 3. Keys and environment

Use fresh keys made only for this project. Fund them only with testnet assets.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DEPLOYER_PK` | contracts scripts | deploys contracts |
| `OWNER_PK` | seed script, demo | vault owner (in the dashboard the owner uses a browser wallet instead) |
| `AGENT_PK` | apps/agent | the agent's session key; calls `executeBatch`; pays x402 fees from its own small USDC balance; needs a little AVAX for gas |
| `GUARDIAN_SIGNER_PK` | apps/guardian | signs verdicts only; holds no funds |
| `PAY_TO` | apps/guardian | address that receives x402 fees |
| `FACILITATOR_URL` | apps/guardian | default Ultravioleta DAO |
| `FACILITATOR_PK` | self-hosted facilitator only | pays settlement gas |
| `FUJI_RPC_URL` | all | real Fuji RPC |
| `CHAIN_RPC_URL` | apps/guardian, apps/agent | chain the vault runs on (Fuji, or the local fork in local mode) |
| `FORK_RPC_URL` | apps/guardian | Anvil fork used for simulation, default `http://127.0.0.1:8545` |
| `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY` | apps/guardian | explainer; `LLM_PROVIDER=none` means template only |
| `DEMO_MODE` | all apps | enables mocks, scripted attacks, demo endpoints and the banner |
| `NETWORK` | all apps | `local` or `fuji`; selects the addresses file |

## 4. Contracts (`contracts/`)

`foundry.toml` essentials:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.28"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200
fs_permissions = [{ access = "read", path = "./test/fixtures" }]

[invariant]
runs = 256
depth = 64

[rpc_endpoints]
fuji = "${FUJI_RPC_URL}"
local = "http://127.0.0.1:8545"
```

- Dependencies (git submodules in `contracts/lib`, pinned in `foundry.lock`): OpenZeppelin Contracts exactly v5.7.0, forge-std v1.17.0.
- `cancun` is used because OpenZeppelin ≥ 5.5 needs `mcopy` (EIP-5656); Fuji has the Cancun EIPs active (ACP-131), blob transactions excluded. Still use the non-transient `ReentrancyGuard`. See §16.

### 4.1 Types and EIP-712

```solidity
struct Call {
    address target;
    uint256 value;
    bytes data;
}

struct Verdict {
    bytes32 callsHash; // keccak256(abi.encode(calls)) with calls typed as Call[]
    uint256 nonce;     // must equal verdictNonce() at execution time
    uint64 deadline;   // unix seconds; valid while block.timestamp <= deadline
    uint8 risk;        // 0 = LOW, 1 = MEDIUM, 2 = HIGH
    bytes32 checkId;   // Guardian check id, for the audit trail
}
```

- EIP-712 domain: name `Guardian402 AgentVault`, version `1`, chainId of the chain, verifyingContract = the vault.
- Type string: `Verdict(bytes32 callsHash,uint256 nonce,uint64 deadline,uint8 risk,bytes32 checkId)`.

### 4.2 AgentVault: roles and state

| Item | Type | Notes |
| --- | --- | --- |
| owner | `Ownable2Step` | the human; full control |
| agent | `address` | the session key; `setAgent(address(0))` revokes it |
| guardian | `address` | verdict signer |
| paused | `bool` | blocks the agent path only |
| verdictNonce | `uint256` | increases by 1 each time a verdict is consumed |
| maxAgentRisk | `uint8` | default 0 (LOW only) |
| token policy | `mapping(address => TokenPolicy)` + `address[] trackedTokens` (max 8) | `TokenPolicy { bool tracked; uint256 dailyCap; uint256 maxApproval; uint256 verdictThreshold; }`, all in token units |
| native policy | `nativeDailyCap`, `nativeVerdictThreshold` | in wei; tracked under `address(0)` |
| allowedTarget | `mapping(address => bool)` | routers and protocols the agent may call |
| allowedSelector | `mapping(address => mapping(bytes4 => bool))` | per allowed target |
| allowedRecipient | `mapping(address => bool)` | allowed recipients of token transfers and native value, and allowed approval spenders |
| spent | `mapping(address => mapping(uint256 => uint256))` | token → day (`block.timestamp / 1 days`) → outflow |

### 4.3 `executeBatch(Call[] calldata calls, Verdict calldata verdict, bytes calldata signature)`

Only the agent may call it. `nonReentrant`. Run these steps in this order:

1. Revert `Paused()` if paused, `NotAgent()` if `msg.sender != agent`, `BadBatch()` if `calls.length == 0 || calls.length > 8`.
2. Static checks on each call:
   - `target` must not be `address(this)` or `address(0)` → `TargetNotAllowed(target)`.
   - If `target` is a tracked token: the selector must be `transfer(address,uint256)` or `approve(address,uint256)`, else `SelectorNotAllowed(target, selector)`.
     - `transfer`: recipient must be an allowed recipient → `RecipientNotAllowed(recipient)`.
     - `approve` with amount 0: always allowed (revocation).
     - `approve` with amount > 0: spender must be an allowed recipient (`RecipientNotAllowed`) and amount ≤ `maxApproval` (`ApprovalTooLarge(token, amount)`). Mark the batch **sensitive**.
   - Else, if `data.length > 0`: `allowedTarget[target]` and `allowedSelector[target][bytes4(data)]` are required (`data.length < 4` → `SelectorNotAllowed`).
   - Else (plain native transfer): `target` must be an allowed recipient.
   - `value > 0` requires the target to be an allowed target or an allowed recipient.
3. If `signature.length > 0`, verify the verdict now:
   - `verdict.callsHash == keccak256(abi.encode(calls))`, else `InvalidVerdict()`;
   - `verdict.nonce == verdictNonce`, else `InvalidVerdict()`;
   - `block.timestamp <= verdict.deadline`, else `VerdictExpired()`;
   - recovered signer (OpenZeppelin `ECDSA` over the EIP-712 digest) `== guardian`, else `BadSignature()`;
   - `verdict.risk <= maxAgentRisk`, else `RiskTooHigh(risk)`.
   Then increment `verdictNonce` **before** any external call.
4. Record the balance of every tracked token and the native balance.
5. Run the calls in order with `call{value: value}(data)`. On failure revert `CallFailed(index, returndata)`.
6. For each tracked token and for native: `outflow = before > after ? before - after : 0`. Add it to `spent[token][today]` and revert `DailyCapExceeded(token, spent, cap)` if the total is above the cap. If `outflow > verdictThreshold`, the batch needs a verdict.
7. If (the batch needs a verdict or is sensitive) and no verdict was verified in step 3 → revert `VerdictRequired()`.
8. Emit `Executed(callsHash, checkId, withVerdict, nonceUsed)`.

### 4.4 Owner functions and views

- `ownerExecute(Call[] calldata calls)` — onlyOwner, no policy: the human override. Emits `OwnerExecuted`.
- `withdraw(address token, address to, uint256 amount)`, `withdrawNative(address payable to, uint256 amount)` — onlyOwner, work while paused.
- `pause()`, `unpause()`, `setAgent(address)`, `setGuardian(address)`, `setMaxAgentRisk(uint8)` (≤ 2).
- `setTokenPolicy(address token, bool tracked, uint256 dailyCap, uint256 maxApproval, uint256 verdictThreshold)`, `setNativePolicy(uint256 dailyCap, uint256 verdictThreshold)`.
- `setAllowedTarget(address, bool)`, `setAllowedSelector(address, bytes4, bool)`, `setAllowedRecipient(address, bool)`.
- Every setter emits an event. `receive()` accepts AVAX.
- Views: `getPolicy()` (one struct with everything the Guardian needs), `remainingToday(address token)`, `hashCalls(Call[] calldata)`, `verdictDigest(Verdict calldata)`.

Custom errors: `Paused`, `NotAgent`, `BadBatch`, `TargetNotAllowed`, `SelectorNotAllowed`, `RecipientNotAllowed`, `ApprovalTooLarge`, `InvalidVerdict`, `VerdictExpired`, `BadSignature`, `RiskTooHigh`, `DailyCapExceeded`, `CallFailed`, `VerdictRequired`, `TooManyTrackedTokens`.

### 4.5 Invariants (Foundry invariant tests)

1. Within any one day, agent-path outflow of each tracked token is ≤ its `dailyCap`; same for native.
2. The agent can never change owner, agent, guardian, policy or pause state.
3. While paused, the agent cannot move any funds.
4. A verdict can be used at most once (`verdictNonce` strictly increases).
5. The owner can always withdraw the full balance, paused or not.
6. A verdict issued for calls A can never authorize calls B.

### 4.6 Mocks (`contracts/src/mocks/`, DEMO)

- `MockERC20`: "Mock Wrapped AVAX" (`mWAVAX`, 18 decimals), owner can mint. A `MockUSDC` (6 decimals) is used only in local unit tests.
- `MockOracle`: owner-set price = USDC (6 decimals) per 1 mWAVAX.
- `MockRouter`:
  - `swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint8 poolId, address to) returns (uint256 amountOut)` pulls `tokenIn` with `transferFrom` and pays `tokenOut` from its own inventory.
  - Quote = oracle price adjusted by pool skew: pool 0 is 30 bps worse than the oracle (normal pool), pool 1 is 3,000 bps worse (the thin, manipulated pool used in scenario S4).
  - `quote(tokenIn, tokenOut, amountIn, poolId)` view. Only the USDC → mWAVAX direction is needed.

### 4.7 Contract tests

- Unit: every error path in §4.3–4.4; happy path with and without a verdict; threshold boundaries (exactly at and one unit above); approval rules incl. revocation; pause and unpause; revoke agent; owner override; nonce replay; expiry; wrong signer; tampered target, value, data, call order; risk above the maximum; daily cap across several batches and across a day boundary (`vm.warp`); native value paths; a reentrancy attempt through a malicious target.
- Fuzz: amounts against caps and thresholds; random batches of allowed calls.
- Invariant: the six invariants in §4.5, with a handler that randomly calls `executeBatch` (as agent), `ownerExecute`, `pause`, `unpause` and warps time.
- Cross-language: §5.
- Coverage target: ≥ 95% lines and branches on `AgentVault`.

### 4.8 Deploy and seed

- `script/Deploy.s.sol` deploys `AgentVault` (owner = OWNER address), `mWAVAX`, `MockOracle`, `MockRouter`, and writes addresses to `packages/shared/src/addresses/{local,fuji}.json`.
- Seed (`script/Seed.s.sol` or `scripts/seed.ts`):
  - USDC tracked: dailyCap 20 USDC, maxApproval 10 USDC, verdictThreshold 1 USDC.
  - Native: dailyCap 0.1 AVAX, verdictThreshold 0.01 AVAX.
  - Router: allowed target with the `swapExactIn` selector, and an allowed recipient (so it can be approved).
  - A team "treasury" address as allowed recipient.
  - Set agent and guardian; `maxAgentRisk = 0`.
  - Oracle price set; router inventory minted with mWAVAX.
  - Owner transfers 50 USDC into the vault. On a local fork, the owner's real Fuji USDC balance is inherited from Fuji.
- Verify contracts on testnet Snowtrace. Look up the current verification instructions (Routescan verifier) in the Avalanche docs; do not guess the URL.

## 5. Verdict encoding (TypeScript and Solidity must match byte for byte)

In `packages/shared/src/verdict.ts`:

```ts
import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

export const CALL_TUPLE = {
  type: "tuple[]",
  components: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
  ],
} as const;

export const hashCalls = (calls: { target: Address; value: bigint; data: Hex }[]) =>
  keccak256(encodeAbiParameters([CALL_TUPLE], [calls]));

export const verdictTypes = {
  Verdict: [
    { name: "callsHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "risk", type: "uint8" },
    { name: "checkId", type: "bytes32" },
  ],
} as const;

export const verdictDomain = (vault: Address, chainId: number) =>
  ({ name: "Guardian402 AgentVault", version: "1", chainId, verifyingContract: vault }) as const;
```

Sign with viem `signTypedData({ domain, types: verdictTypes, primaryType: "Verdict", message })`.

Required cross-check test (`pnpm test:crosscheck`):

1. A TypeScript script writes `contracts/test/fixtures/verdict.json`: calls, verdict, signature, signer address, chain id, vault address.
2. The vault address must be deterministic: deploy from a fixed deployer at nonce 0. Compute it with `vm.computeCreateAddress(deployer, 0)` in Foundry and `getContractAddress({ from: deployer, nonce: 0n })` in viem.
3. `contracts/test/VerdictCrossCheck.t.sol` loads the fixture and asserts the vault accepts the verdict, then mutates each field (and one byte of each call) and asserts rejection.

## 6. Guardian API (`apps/guardian`)

### 6.1 Endpoints

| Method and path | Price | Purpose |
| --- | --- | --- |
| `POST /v1/check` | 0.005 USDC (`amount: "5000"`) | simulate, score, explain |
| `POST /v1/cosign` | 0.01 USDC (`amount: "10000"`) | same as check, plus a signed verdict |
| `GET /v1/health` | free | liveness, fork block, signer address |
| `GET /v1/rules` | free | rule ids, severities, thresholds |
| `GET /v1/stats` | free | checks by risk, payments count and sum, p50/p95 latency |
| `GET /v1/checks?limit=50` | free | recent checks (summaries only) |
| `GET /v1/checks/:checkId` | free | one check |
| `POST /v1/demo/check` | free, only when `DEMO_MODE=true` | for the dashboard "paste a transaction" page; rate-limited |

### 6.2 Schemas (zod, in `packages/shared`)

```ts
CheckRequest = {
  chainId: 43113,
  vault: Address,                                   // the AgentVault that will run the calls
  calls: { target: Address; value: string; data: Hex }[], // 1..8; value in wei as a decimal string
  lang?: "vi" | "en",                               // both languages are always returned
}

CheckResponse = {
  checkId: Hex,                                     // bytes32
  risk: "LOW" | "MEDIUM" | "HIGH",
  riskCode: 0 | 1 | 2,
  score: number,                                    // 0..100
  findings: { ruleId: string; severity: "LOW" | "MEDIUM" | "HIGH"; title: string;
              evidence: Record<string, string | number | boolean> }[],
  simulation: { success: boolean; revertReason?: string; gasUsed: string; forkBlock: string },
  diff: {
    tokenDeltas: { token: Address; symbol: string; decimals: number; delta: string }[],
    nativeDelta: string,                            // excludes gas
    approvals: { token: Address; spender: Address; amount: string; unlimited: boolean }[],
    transfers: { token: Address; from: Address; to: Address; amount: string }[],
  },
  explanation: { vi: string; en: string; source: "llm" | "template" },
  verdict?: { callsHash: Hex; nonce: string; deadline: number; risk: 0 | 1 | 2; checkId: Hex; signature: Hex },
  latencyMs: number,
  demoMode: boolean,
}
```

- Invalid input → `400 { error, details }`. The x402 middleware does not settle when the status is ≥ 400, so the caller is not charged.
- A completed check always returns 200, even when the risk is HIGH.

### 6.3 Pipeline and time budget (target p50 < 1.5 s before settlement)

1. Validate with zod. Compute `callsHash` (§5) and `checkId = keccak256(callsHash, vault, timestampMs, 16 random bytes)`.
2. Read the vault policy and `verdictNonce` from `CHAIN_RPC_URL` (cache policy 10 s; never cache the nonce).
3. Simulate (§7). Budget 800 ms; on timeout → finding `SIMULATION_FAILED`.
4. Rules (§8), pure functions. Budget 20 ms.
5. Explain (§9). Budget 1,500 ms; on timeout → template.
6. `/v1/cosign` only: sign `{ callsHash, nonce, deadline: now + 60 s, risk, checkId }`. Always sign with the true risk; the vault decides what it accepts.
7. Store and respond.

### 6.4 x402 paywall

Use `@x402/express` 2.28.0. This skeleton follows the package README; check every name against the installed types before using it.

```ts
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const FUJI = "eip155:43113";
const USDC_FUJI = "0x5425890298aed601595a70AB815c96711a31Bc65";

// Fuji USDC is not a default asset, so "$0.005" would fail. Name the asset explicitly.
const usdc = (atomic: string) => ({
  asset: USDC_FUJI,
  amount: atomic,
  extra: { name: "USD Coin", version: "2" },
});

const facilitator = new HTTPFacilitatorClient({ url: env.FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator).register(FUJI, new ExactEvmScheme());

resourceServer.onAfterSettle(async (ctx) => {
  // Record payer, amount, settlement tx hash. Read the exact ctx type in node_modules/@x402/core.
});

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(
  paymentMiddleware(
    {
      "POST /v1/check": {
        accepts: { scheme: "exact", price: usdc("5000"), network: FUJI, payTo: env.PAY_TO, maxTimeoutSeconds: 60 },
        description: "Guardian402: simulate and score a transaction",
      },
      "POST /v1/cosign": {
        accepts: { scheme: "exact", price: usdc("10000"), network: FUJI, payTo: env.PAY_TO, maxTimeoutSeconds: 60 },
        description: "Guardian402: check plus a signed verdict for AgentVault",
      },
    },
    resourceServer,
  ),
);
```

- The middleware buffers the response and settles after the handler. If settlement fails, the client does not receive the response, so no verdict leaks unpaid.
- For demos, be able to switch `FACILITATOR_URL` to a self-hosted facilitator built from the starter's `facilitator.mjs` pattern, so the demo does not depend on a third-party service.

### 6.5 Storage

SQLite file `apps/guardian/data/guardian.db` with migrations.

- `checks(checkId, createdAt, endpoint, vault, callsHash, risk, score, findingsJson, diffJson, explanationJson, verdictJson, latencyMs, demo)`
- `payments(id, createdAt, payer, amount, txHash, endpoint, checkId)`

Store no IP addresses and no personal data.

## 7. Simulator (`apps/guardian/src/sim`)

- `pnpm fork` runs `anvil --fork-url "$FUJI_RPC_URL" --chain-id 43113 --port 8545`. The Guardian uses viem `createTestClient({ mode: "anvil" })` plus a public client and a wallet client on `FORK_RPC_URL`.
- Before simulating, make sure the vault exists on the fork (`getCode`). If not, or if the fork is more than 2 minutes behind Fuji, `reset` the fork to the latest block. Also reset every 5 minutes.
- Per check, under a global mutex:
  1. `snapshot()`.
  2. `impersonateAccount(vault)`; `setBalance(vault, current + gas buffer)`.
  3. Read balances of the tracked tokens (from the vault policy, plus tokens touched by the calls) and the native balance.
  4. Send each call as a transaction from the vault address, in order.
  5. Collect receipts: status, gasUsed, effectiveGasPrice, logs. Decode ERC-20 `Transfer` and `Approval`, and `ApprovalForAll`.
  6. Read balances again. Native delta must exclude gas: add back `gasUsed × effectiveGasPrice` of each receipt.
  7. `revert(snapshot)`; stop impersonating.
- This runs the inner calls as if the vault executed them. It does not run the vault's own checks; `POLICY_PRECHECK` (§8) covers that statically.
- The vault is a contract, so a node enforcing EIP-3607 may refuse transactions "from" it. Check `anvil --help` for an option that relaxes this for impersonated accounts. If there is none, set the vault's code to empty inside the snapshot (`setCode(vault, "0x")`) before sending the calls; the snapshot revert restores it. Note this limitation in the code: targets that call back into the vault are not simulated faithfully.
- Decode revert data with the known ABIs (vault, mocks, ERC-20); otherwise return the raw hex.
- Return `forkBlock` with every result.

## 8. Rule engine (`apps/guardian/src/rules`)

Each rule is a pure function `(sim: SimResult, ctx: Context, cfg: RuleConfig) => Finding[]`. Rules never call the chain; `Context` carries the vault policy snapshot, the address book and token metadata.

Aggregation: risk = the highest severity among findings (LOW when there are none); score = min(100, Σ weights) with HIGH = 60, MEDIUM = 25.

| ruleId | Severity | Trigger | Default config |
| --- | --- | --- | --- |
| `SIMULATION_FAILED` | HIGH | simulation reverted or timed out | — |
| `POLICY_PRECHECK` | HIGH | a call would fail the vault's static policy (target, selector, recipient, approval size, remaining daily cap) | — |
| `UNLIMITED_APPROVAL` | HIGH | an approval ≥ 2^128, above the token's `maxApproval`, or to a spender outside the vault allowlist; any `ApprovalForAll(true)` | threshold 2^128 |
| `UNKNOWN_CONTRACT` | MEDIUM; HIGH when the vault approves or sends value to it | target or spender is a contract missing from the known-contracts registry | registry file |
| `ADDRESS_POISONING` | HIGH | a recipient or spender is not in the address book but matches an entry on the first N and last M hex characters | N = 4, M = 4 (DEMO may use 3/3) |
| `DRAIN_PATTERN` | HIGH | outflow of a tracked token, or native, ≥ 50% of the vault's balance before the batch | 50% |
| `ABNORMAL_SLIPPAGE` | MEDIUM ≥ 2%, HIGH ≥ 10% | swap through a known router: realized output vs the MockOracle reference price | 2% / 10% |
| `RECIPIENT_NOT_ALLOWLISTED` | HIGH | any transfer out of the vault, or native value, to an address outside the allowlist | — |

- Address book = vault allowlist + known-contracts registry + addresses the vault has paid before (from the Guardian DB).
- Known-contracts registry: `apps/guardian/config/known-contracts.fuji.json` (USDC, mocks, router, ERC-8004 registries).
- An explorer lookup ("unverified or created < 7 days ago") is optional: behind a flag, cached, 1 s timeout, and never used in tests or eval, so results stay deterministic.
- Thresholds live in `apps/guardian/config/rules.json`.
- Every rule has unit tests with at least one positive and one negative fixture.

## 9. Explainer (`apps/guardian/src/explain`)

- Input: only the normalized diff, the findings and token metadata. Never pass raw calldata, error strings from untrusted contracts, or any text the agent supplied: that is the prompt-injection surface.
- Output: JSON `{ vi: string, en: string }`, each ≤ 400 characters, plain text, validated with zod.
- Instructions to the model: describe what the simulation shows; do not change, soften or contradict the risk level; no investment advice; no price predictions.
- Interface `Explainer.explain(input): Promise<Explanation>` with two implementations:
  - `TemplateExplainer`: deterministic Vietnamese and English templates per ruleId plus one for LOW; amounts formatted with symbol and decimals; addresses shortened `0x1234…abcd`.
  - `LlmExplainer`: provider and model from env; low temperature; 1.5 s timeout.
- Fall back to the template on error, timeout, schema failure, or when the text contradicts the computed risk (e.g. it says "an toàn"/"safe" while risk is HIGH, or "nguy hiểm"/"dangerous" while risk is LOW).
- The dashboard renders explanations as plain text only.
- Architecture test: a vitest test fails if anything under `src/explain/` imports from `src/sign/`, from rule aggregation code, or creates a viem wallet client.

## 10. Demo agent (`apps/agent`)

The agent holds `AGENT_PK` and pays the Guardian with `@x402/fetch`:

```ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const agent = privateKeyToAccount(env.AGENT_PK);

export const payingFetch = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:43113", client: new ExactEvmScheme(agent) }],
  // Spend controls allow only default assets by default; Fuji USDC must be listed.
  // maxAmountPerPayment is in atomic units: 20000 = 0.02 USDC.
  spendControls: {
    allowedAssets: [{ network: "eip155:43113", asset: USDC_FUJI, maxAmountPerPayment: "20000" }],
  },
});
```

Modes:

- `safe`: deterministic rule-based DCA. If the oracle price is below a threshold, swap N USDC into mWAVAX through pool 0 as one batch `[approve(router, N), swapExactIn(..., poolId 0)]`.
- `scripted-attack` (DEMO): simulates a prompt-injected planner. It reads an "injected" instruction from `fixtures/feed.json` and turns it into a malicious call list. No LLM is involved, so the demo is deterministic. Declare this in the pitch.

Scenarios (CLI `pnpm agent scenario <id>`, and a local control API `POST /scenario/:id` bound to localhost, enabled only with `DEMO_MODE=true`):

| Id | What the agent attempts | Expected Guardian result | Expected vault result |
| --- | --- | --- | --- |
| S1 normal-swap | approve 2 USDC + swap via pool 0 | LOW | executes |
| S2 drain-to-attacker | `transfer(attacker, full balance)`, sent without a verdict | HIGH: DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | reverts `RecipientNotAllowed` |
| S3 poisoned-approval | `approve(lookalikeRouter, max uint)` | HIGH: UNLIMITED_APPROVAL, ADDRESS_POISONING | reverts |
| S4 bad-slippage | approve 2 USDC + swap via pool 1 with `minOut = 0`, sent with the HIGH verdict | HIGH: ABNORMAL_SLIPPAGE | reverts `RiskTooHigh` — passes every static rule, so this is the case that proves the Guardian adds value |
| S5 replay | reuse the S1 verdict for other calls; then an expired verdict | — | `InvalidVerdict`, `VerdictExpired` |
| S6 kill-switch | owner pauses, agent retries S1 | — | reverts `Paused` |

- Each scenario prints, in Vietnamese: the Guardian risk and findings, the x402 settlement link, and the vault transaction link (success or revert).
- Every attempt is appended to `apps/agent/data/attempts.jsonl`; the control API serves it at `GET /attempts`.
- Lookalike address for S3: `scripts/mine-lookalike.sh` runs `cast wallet vanity --starts-with <first chars of router> --ends-with <last chars>`. Keep only the address in `apps/agent/fixtures/lookalike.json` and never fund it. If 4+4 characters takes too long, mine 3+3 and set the rule to 3/3 in DEMO mode (declare it).

## 11. Dashboard (`apps/dashboard`, Vietnamese UI)

| Page | Content | Data |
| --- | --- | --- |
| Tổng quan | vault balances, remaining daily caps, policy summary, agent and guardian addresses, DEMO MODE banner | Fuji RPC, `/v1/health` |
| Hoạt động | recent checks with risk badge, findings, explanation; vault `Executed` events | `/v1/checks`, `getLogs` |
| Đã chặn | HIGH checks and reverted attempts with reasons | `/v1/checks`, agent `/attempts` |
| Doanh thu | x402 payments count and sum, settlement links | `/v1/stats` |
| Kiểm tra giao dịch | paste a calls JSON or pick a scenario, see the result | `/v1/demo/check` (DEMO only) |
| Điều khiển | owner actions with wagmi: pause/unpause, revoke agent, change caps; scenario buttons (DEMO only) | AgentVault, agent control API |

- Wallets: injected connector (Core, MetaMask) on Fuji.
- Every owner action opens a confirmation dialog that shows exactly what changes.
- Every tx hash is a Snowtrace link. No secrets in the frontend; no backend of its own.

## 12. Eval (`eval/`)

- Case file `eval/cases/<id>.json`: `{ id, description, calls, setup, label: "benign" | "malicious", expectedRules: string[] }`. `setup` covers balances and allowlist changes applied to the fresh fork before the case runs.
- At least 40 cases: 15 benign (normal swaps of different sizes, exact approvals to the router, transfers to the treasury, revocations), 25 malicious (5 unlimited or oversized approvals, 5 lookalike recipients or spenders, 5 drains, 5 bad-slippage swaps, 3 unknown contracts, 2 reverting calls).
- Runner: deploys the mocks and a vault on a fresh local fork, runs every case through the same pipeline as `/v1/check` (no payment; template explainer), and writes `eval/report.md` and `eval/report.json`:
  - confusion matrix with "blocked" defined as risk = HIGH, and again as risk ≥ MEDIUM;
  - precision, recall, false positive rate;
  - hits per rule; p50/p95 latency.
- The report states that the cases are synthetic and built by the team. If a threshold changes, record before/after numbers in the report.

## 13. Bonus (only after §14 is complete, in this order)

1. **ERC-8004 identity.** Register the Guardian on the Fuji IdentityRegistry with a registration file: `type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"`, `name`, `description`, `services` (web endpoint; MCP if built), `x402Support: true`, `registrations: [{ agentId, agentRegistry: "eip155:43113:<IdentityRegistry address>" }]`. Use the ABIs in `erc-8004-contracts/abis/`. Optional validation flow for HIGH verdicts: the requester calls `validationRequest(validatorAddress, agentId, requestURI, requestHash)`, the Guardian answers `validationResponse(requestHash, response 0..100, responseURI, responseHash, "tx-risk")`. Check that the ValidationRegistry address has code on Fuji first.
2. **MCP server** exposing `check_transaction` and `cosign_transaction` as paid tools with `@x402/mcp` (`createPaymentWrapper`), reusing the Guardian pipeline as a library.
3. **On-chain receipts**: batched hashes of verdicts on C-Chain, or on an own L1 linked by ICM. Skip unless everything else is polished.

## 14. Definition of done (MVP)

- [ ] `forge test` green, including fuzz and invariant tests; AgentVault coverage ≥ 95%.
- [ ] `pnpm test:crosscheck` green (TypeScript-signed verdict accepted by Solidity; every mutation rejected).
- [ ] Contracts deployed and verified on Fuji; addresses committed in `packages/shared`.
- [ ] `/v1/check` and `/v1/cosign` behind x402 on Fuji; at least one real settlement visible on Snowtrace; a test proves a 400 response is not charged.
- [ ] All 8 rules implemented with unit tests.
- [ ] Explainer with LLM and template fallback; the architecture test passes.
- [ ] Scenarios S1–S6 run on the local fork and S1, S2, S4 on Fuji, with links; S4 ends in `RiskTooHigh`.
- [ ] Dashboard pages working against Fuji, with the DEMO MODE banner.
- [ ] Eval: ≥ 40 cases, report generated and reproducible.
- [ ] README (fresh clone to running demo in ≤ 15 minutes), `docs/THREAT_MODEL.md`, `docs/DEMO_RUNBOOK.md`, complete `.env.example` files.
- [ ] A teammate has done the fresh-clone test.

## 15. Out of scope

Mainnet; real user funds; any token; ERC-4337 bundlers and paymasters; EIP-7702; Safe modules; mobile apps; other chains; the x402 `upto` and `batch-settlement` schemes (they need Permit2 or an escrow contract and facilitator support on Avalanche — check before considering them).

## 16. Change log

- 2026-10-19 — v0.1, first version.
- 2026-10-19 — v0.2, P0 deviations agreed by the team:
  - Node requirement raised from >= 22.9 to >= 22.13 (vitest 5 needs ^22.12, ESLint 10 needs ^22.13). TypeScript pinned to 6.0.3 because typescript-eslint 8.71 does not support TypeScript 7.
  - §4 `foundry.toml`: `evm_version` raised from `shanghai` to `cancun`; OpenZeppelin Contracts pinned to exactly v5.7.0. Reason: OZ ≥ 5.5 uses `mcopy` (EIP-5656) via `EIP712 → Strings → Bytes`, which does not compile for shanghai. Fuji has the Cancun EIPs active (ACP-131: EIP-1153, 5656, 6780, 7516, BLOBHASH; blob transactions excluded). AgentVault keeps the non-transient `ReentrancyGuard` (§4.3). To confirm at the start of P1: deploy a minimal contract compiled with these settings to Fuji; if it fails, fall back to OZ v5.4.0 + `shanghai`.
    - Confirmed 2026-10-19 (P1): `contracts/src/smoke/CancunSmoke.sol` executed TSTORE/TLOAD and MCOPY in real Fuji transactions — deploy [0x590d0a0f…3529](https://testnet.snowtrace.io/tx/0x590d0a0f4ef21bc0a9a9d4dee290e6232f2cc6de88573e0fb935630838963529), `checkTransient(402)` [0xb5adee96…4235](https://testnet.snowtrace.io/tx/0xb5adee964f5fdbf4ee78a19156e61db2313fd1268a46787b222d29e3efe94235), `checkMcopy` [0x2996f8c6…fa98](https://testnet.snowtrace.io/tx/0x2996f8c6fb20db3be48d4c9106d2cc3a861bbcc8318f41df72f452f1c662fa98), all status 1; contract [0x0D363882…C426](https://testnet.snowtrace.io/address/0x0D363882aA2DdA271323F91a1a268Cd707D3C426). `cancun` + OZ v5.7.0 stay.
  - §4.8 ownership: after deploy and seed on Fuji (P2), the deployer/OWNER key starts `transferOwnership(0x54A2276F134d3Cfaa7572BC326092fABa6352888)` (Ownable2Step); the team lead accepts from that wallet only after P8, so OWNER_PK stays owner for seeding and the S6 kill-switch scenario until then. Started 2026-10-19 (tx 0xe864b2e2…519d).
  - §4 AgentVault (P1): spec ambiguities resolved with the safest reading.
    - Constructor is `(initialOwner, initialAgent, initialGuardian)`. A zero agent (revoked) or zero guardian (no verdict accepted) is valid; a zero owner is rejected.
    - Tracked-token calls must be exactly `selector + abi.encode(address, uint256)` (68 bytes); anything else reverts `SelectorNotAllowed(token, selector)`. Empty or < 4-byte data to a tracked token → `SelectorNotAllowed(token, 0x00000000)`.
    - `value > 0` to a target that is neither an allowed target nor an allowed recipient → `TargetNotAllowed(target)`.
    - Malformed signatures (any `ECDSA.tryRecover` error) → `BadSignature()`, same as a wrong signer.
    - A verdict sent with a batch that does not need one is still verified and consumes the nonce.
    - `Executed` carries `checkId = 0` and `nonceUsed = 0` when no verdict was sent (`withVerdict` disambiguates).
    - Outflow is net per batch, exactly as §4.3 step 6 defines it; inflows in the same batch offset outflows.
    - `setMaxAgentRisk(x > 2)` → `RiskTooHigh(x)`. `setTokenPolicy` on `address(0)` (native key) or the vault → `TargetNotAllowed`.
    - Untracking a token keeps its `spent` history, so re-tracking it the same day keeps counting towards the cap.
    - `renounceOwnership()` reverts `RenounceDisabled()` (new error): an ownerless vault could never be withdrawn from.
    - Pause events are `VaultPaused` / `VaultUnpaused` (an event named `Paused` would clash with the `Paused()` error).
    - Allowlists are `EnumerableSet`s so `getPolicy()` can return them; `allowedTarget(address)`, `allowedSelector(address,bytes4)`, `allowedRecipient(address)` keep the mapping-getter ABI. `getPolicy()` also returns owner, pendingOwner, day, per-token spentToday and balances. `remainingToday(token)` returns 0 for a token that is not tracked.
    - `withdrawNative` uses OpenZeppelin `Address.sendValue` (reverts `FailedCall()` if the recipient refuses AVAX).
    - Known residual risk for P11: an approval granted with a verdict outlives the batch, so an allowlisted spender could pull up to `maxApproval` later without passing `executeBatch`; bounded by `maxApproval` and the spender allowlist.
  - §4.6 / §4.8 deploy and seed (P2): values the spec leaves open.
    - MockOracle price 25 USDC (25e6) per mWAVAX; MockRouter inventory 1,000 mWAVAX; the router keeps the USDC it receives (owner can `sweep`). Swap output is `amountIn · 1e18 · (10000 − skewBps) / (price · 10000)`.
    - Team treasury = the deployer address `0x64281A1b566EB95Ac50c42282Cc257DBD518fB50` (env `TREASURY` overrides). x402 `PAY_TO` is the same address.
    - All secrets live in the repo-root `.env.local`; `scripts/contracts.mjs` passes them to forge through the environment and refuses any RPC whose chain id is not 43113. The seed tops up gas from the deployer (owner 0.05 AVAX, agent 0.1 AVAX).
    - forge can only write inside `contracts/`, so scripts write `contracts/deployments/<network>.json` (git-ignored) and the wrapper copies it to the committed `packages/shared/src/addresses/<network>.json`.
    - Local fork only: the owner's test USDC is minted through the impersonated USDC masterMinter (`anvil_impersonateAccount`), because the fork inherits the owner's empty Fuji balance.
    - Verification: Routescan's documented Foundry flow (`--verifier-url https://api.routescan.io/v2/network/testnet/evm/<chainId>/etherscan`, `--etherscan-api-key verifyContract`, info.routescan.io article "Deploying and verifying contracts (Foundry)") with chain id 43113, probed before use. Routescan shows mWAVAX with a pre-existing similar-match source ("ERC20Mock", solc 0.8.27) although our exact-source submission returned "Pass - Verified".
  - §5 / §6.2 `packages/shared` (P3):
    - zod is pinned to 3.25.76, the same major that `@x402/core` 2.28.0 depends on (`zod ^3.24.2`), so the workspace has one zod.
    - The package ships TypeScript sources (`exports` point at `src/*.ts`, imports use `.ts` extensions with `allowImportingTsExtensions`); apps run them with tsx, vitest or Next.js transpilation.
    - `signVerdict` lives in `@guardian402/shared/sign` and is not re-exported from the package index, so the explainer can use the schemas and hashing helpers without importing a signer.
    - `CheckRequest` is `.strict()`: unknown fields are rejected with 400 (no agent-supplied free text reaches the pipeline).
  - §7 `pnpm fork`: Anvil may run natively, through WSL2, or through the official Docker image `ghcr.io/foundry-rs/foundry:v1.8.5` (`ANVIL_RUNNER=auto|native|docker`), because Windows Smart App Control can block `anvil.exe`.
