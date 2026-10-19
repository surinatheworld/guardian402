# Guardian402 — Bộ prompt cho coding agent

Bộ này gồm 3 file. `CLAUDE.md` là bối cảnh và luật mà agent đọc ở mọi phiên. `docs/SPEC.md` là spec kỹ thuật, nguồn sự thật duy nhất. File này chứa các prompt dán lần lượt theo từng giai đoạn.

Prompt viết bằng tiếng Anh để agent làm chính xác hơn, nhưng agent sẽ báo cáo bằng tiếng Việt (đã dặn trong `CLAUDE.md`).

## Cách dùng

1. Tạo repo `guardian402`. Chép `CLAUDE.md` và `PROMPTS.md` vào gốc repo, `SPEC.md` vào `docs/`.
2. Vào [team1vn.xyz/demos.html](https://team1vn.xyz/demos.html), tải ZIP của starter "Pay per request with x402 on Avalanche", giải nén vào `vendor/x402-starter/`. Đây là code tham khảo, agent không được sửa.
3. Mở coding agent ở thư mục repo. Với Claude Code thì `CLAUDE.md` được đọc tự động. Với Cursor hoặc Codex, tạo thêm `AGENTS.md` có một dòng "Read and follow CLAUDE.md".
4. Dán **Prompt mở phiên**, rồi dán prompt của phase đang làm. Mỗi phase một phiên mới để agent không bị rối ngữ cảnh.
5. Chỉ sang phase sau khi mọi tiêu chí nghiệm thu (Acceptance) đều đạt. Commit, push, rồi tick checklist ở `docs/SPEC.md` §14.

## Chia việc

| Phase | Nội dung | Người làm | Thời gian | Cần có trước |
| --- | --- | --- | --- | --- |
| P0 | Dựng repo, kiểm tra toolchain | Cả team | 19/10–25/10 | — |
| P1 | AgentVault + test | A (Solidity) | 26/10–05/11 | P0 |
| P2 | Mock, deploy, seed lên Fuji | A | 05/11–07/11 | P1 |
| P3 | Package shared + cross-check verdict | B (backend) | 02/11–05/11 | P0 (ABI tạm từ P1) |
| P4 | Simulator | B | 05/11–09/11 | P2, P3 |
| P5 | Rule engine | B | 09/11–11/11 | P4 |
| P6 | Explainer | C (frontend/product) | 06/11–10/11 | P3 |
| P7 | Guardian API + x402 | B | 11/11–14/11 | P4, P5, P6 |
| P8 | Agent demo + kịch bản tấn công | A | 12/11–15/11 | P2, P7 |
| P9 | Dashboard | C | 10/11–17/11 | P3, P7 |
| P10 | Bộ eval | C | 15/11–18/11 | P5 |
| P11 | Soát bảo mật, tài liệu, chạy thử từ repo sạch | Cả team | 18/11–20/11 | tất cả |

Mốc phải giữ: **15/11 chạy end-to-end trên Fuji (S1 và S4)**, 19/11 đóng băng tính năng, 21/11 23:59 nộp bài.

## Luật khi làm việc với agent

- Không dán private key vào khung chat. Key chỉ nằm trong `.env.local`.
- Đọc diff trước khi commit. Agent hay sửa luôn những chỗ không được yêu cầu.
- Agent nói "đã chạy được" mà không dán output thật thì coi như chưa chạy.
- Thấy agent dùng hàm hoặc tham số lạ của x402 hay ERC-8004, dán ngay prompt **Chống bịa API**.
- Spec có chỗ sai hoặc thiếu: sửa `docs/SPEC.md` trước, ghi vào §16, rồi mới bảo agent làm theo.

---

## Prompt mở phiên

Dán ở đầu mỗi phiên mới, thay `<Px>` bằng phase sắp làm.

```text
Read CLAUDE.md and the sections of docs/SPEC.md that phase <Px> in PROMPTS.md depends on.
Then run `git log --oneline -15` and `git status`.
Tell me in Vietnamese, in at most 8 lines: what is already done (check docs/SPEC.md §14), what phase <Px> needs, and any blocker you see.
Do not change any file yet. Wait for the phase prompt.
```

---

## P0 — Dựng repo và kiểm tra toolchain

```text
Phase P0 — repository skeleton and toolchain check. Read CLAUDE.md and docs/SPEC.md fully first.

Set up the monorepo exactly as in CLAUDE.md "Repo layout":
1. pnpm workspace with packages/shared, apps/guardian, apps/agent, apps/dashboard, eval. Shared TypeScript strict base config, vitest, eslint and prettier.
2. contracts/ as a Foundry project with OpenZeppelin Contracts v5 installed and foundry.toml as in SPEC §4.
3. Root scripts: `fork` (Anvil fork of Fuji as in SPEC §7), `test`, `lint`.
4. .env.example at the root and in each app, listing every variable from SPEC §3 with a one-line comment. .gitignore covering .env.local, .env*.local, contracts/out, contracts/cache, contracts/broadcast, apps/*/data, node_modules.
5. No business logic yet.

Then read vendor/x402-starter (README.md and src/) without modifying it, and summarise in Vietnamese in at most 10 lines: how its seller, buyer and facilitator work, which @x402 packages and versions it pins, and anything specific to Fuji.

Acceptance (paste the real output of each):
- `node -v` is >= 22.13; `pnpm -v`; `forge --version`; `anvil --version`.
- `pnpm fork` starts; in another terminal `cast chain-id --rpc-url http://127.0.0.1:8545` prints 43113.
- `cast call 0x5425890298aed601595a70AB815c96711a31Bc65 "symbol()(string)" --rpc-url http://127.0.0.1:8545` prints "USDC".
- `cd contracts && forge build` succeeds; `pnpm -r test` runs.
- Update the Commands section of CLAUDE.md. Report in Vietnamese.
```

---

## P1 — Contract AgentVault và test

```text
Phase P1 — AgentVault and its tests. Read docs/SPEC.md §4 and §5 first. Implement nothing outside them.

Implement contracts/src/AgentVault.sol:
- Types Call and Verdict, EIP-712 domain ("Guardian402 AgentVault", "1") and the type string exactly as in SPEC §4.1.
- Roles and storage as in §4.2. executeBatch following steps 1–8 of §4.3 in that order. Owner functions, views, custom errors and events as in §4.4.
- Use OpenZeppelin v5: Ownable2Step, EIP712, ECDSA, SafeERC20, ReentrancyGuard (not the transient variant). Batch calls use a low-level call; bubble up failures as CallFailed(index, returndata).
- Increment verdictNonce before any external call.

Write the tests listed in SPEC §4.7:
- contracts/test/AgentVault.t.sol: every error path and every happy path, threshold boundaries (exactly at and one unit above), day rollover with vm.warp, native value paths, owner override, reentrancy attempt through a malicious target.
- contracts/test/AgentVault.fuzz.t.sol: amounts against caps and thresholds; random batches of allowed calls.
- contracts/test/AgentVault.invariant.t.sol: a handler that randomly calls executeBatch as the agent, ownerExecute, pause, unpause and warps time; assert all six invariants of §4.5.
- Use MockUSDC (6 decimals), a MockTarget and a ReentrantTarget in test/mocks/. Sign verdicts with vm.sign from a fixed guardian key, and assert that verdictDigest() equals a digest you compute independently in the test.

Acceptance (paste outputs):
- `forge build` with no new warnings.
- `forge test -vvv` all green (paste the summary lines).
- `forge coverage --report summary`: AgentVault >= 95% lines and branches.
- In Vietnamese: a table "invariant → test that covers it", and every point where the spec was ambiguous and how you resolved it. If you think the spec is wrong somewhere, stop and tell me instead of changing it.
```

---

## P2 — Mock, script deploy và seed

```text
Phase P2 — mocks, deploy and seed. Read docs/SPEC.md §4.6 and §4.8.

1. Implement MockERC20 (mWAVAX, 18 decimals, owner mint), MockOracle (owner-set price, USDC 6 decimals per 1 mWAVAX) and MockRouter (swapExactIn, quote, pool 0 = 30 bps skew, pool 1 = 3000 bps skew, USDC → mWAVAX only), each with unit tests. Mark every mock with a NatSpec "DEMO ONLY" notice.
2. script/Deploy.s.sol: deploys AgentVault (owner from env) and the mocks; writes packages/shared/src/addresses/{local,fuji}.json depending on the network.
3. Seed (Seed.s.sol or scripts/seed.ts): exactly the values in SPEC §4.8.
4. Root scripts: deploy:local, seed:local, deploy:fuji, seed:fuji.
5. Verify the contracts on testnet Snowtrace. Find the current verification instructions (Routescan verifier) in the Avalanche docs. Do not guess the verifier URL; if you cannot find it, tell me.

Before sending any transaction on Fuji, print which key sends it, to which contract and what it does, and wait for my "ok".

Acceptance (paste outputs):
- deploy:local and seed:local succeed against `pnpm fork`; `cast call <vault> "getPolicy()"` matches the seed values.
- deploy:fuji and seed:fuji succeed; paste every address with its testnet.snowtrace.io link and the verification status.
- The vault holds 50 USDC on Fuji and the router holds mWAVAX inventory (paste cast output).
```

---

## P3 — Package shared và cross-check verdict

```text
Phase P3 — packages/shared and the verdict cross-check. Read docs/SPEC.md §5 and §6.2.

1. `pnpm abi`: a script that extracts ABIs from contracts/out into packages/shared/src/abi/*.ts as `as const` exports for viem.
2. Address loader keyed by NETWORK (local | fuji).
3. Constants: chain, USDC (address, decimals, EIP-712 name and version), prices in atomic units, rule ids, risk codes.
4. zod schemas and inferred types: CheckRequest, CheckResponse, Finding, Diff, Verdict — exactly the shapes in SPEC §6.2.
5. verdict.ts: hashCalls, verdictTypes, verdictDomain (as in SPEC §5), signVerdict (viem signTypedData), recoverVerdictSigner.
6. Cross-check:
   - scripts/gen-verdict-fixture.ts writes contracts/test/fixtures/verdict.json (calls, verdict, signature, signer, chainId, vault address).
   - The vault address is deterministic: fixed deployer, nonce 0 (vm.computeCreateAddress in Foundry, getContractAddress in viem).
   - contracts/test/VerdictCrossCheck.t.sol loads the fixture, calls vm.chainId(fixture.chainId), deploys the vault from that deployer with the fixture's signer as guardian, asserts the verdict is accepted, then mutates each verdict field and one byte of each call and asserts every mutation is rejected with the expected error.
   - `pnpm test:crosscheck` runs the generator and then the forge test.

Acceptance (paste outputs): vitest for packages/shared green; `pnpm test:crosscheck` green.
```

---

## P4 — Simulator

```text
Phase P4 — the simulator in apps/guardian/src/sim. Read docs/SPEC.md §7 and the SimResult-related parts of §6.2.

Implement a Simulator with simulate(vault, calls): Promise<SimResult>:
- viem createTestClient({ mode: "anvil" }) + public and wallet clients on FORK_RPC_URL.
- Global mutex; snapshot → impersonate the vault → set a gas buffer → read balances → send each call from the vault address → read receipts → read balances → revert → stop impersonating, exactly as in SPEC §7. If Anvil refuses to send from the vault because it has code (EIP-3607), use the fallback described in SPEC §7 and tell me which one you used.
- Decode ERC-20 Transfer and Approval and ApprovalForAll logs. Native delta excludes gas (add back gasUsed × effectiveGasPrice per receipt).
- Decode revert data with the vault, mock and ERC-20 ABIs; fall back to raw hex.
- Fork health: if the vault has no code on the fork, or the fork is more than 2 minutes behind Fuji, reset to the latest block; also reset every 5 minutes. Return forkBlock.
- Timeout 800 ms per simulation; on timeout return a result the rules can turn into SIMULATION_FAILED.

Integration tests (vitest, file suffix .fork.test.ts, need `pnpm fork` running; reuse the deploy and seed scripts on the fork):
- normal swap via pool 0: USDC delta and mWAVAX delta are exact;
- transfer to an attacker address: transfer decoded, delta exact;
- approve max uint: approval decoded with unlimited = true;
- a reverting call: success = false and the decoded reason;
- a native transfer: native delta exact, gas excluded.

Acceptance (paste outputs): `pnpm --filter guardian test:fork` green; print p50 and p95 simulation latency over 20 runs (target p50 < 800 ms).
```

---

## P5 — Rule engine

```text
Phase P5 — the rule engine in apps/guardian/src/rules. Read docs/SPEC.md §8.

- Implement all 8 rules as pure functions (sim, ctx, cfg) => Finding[]. Rules must never call the chain or the network.
- aggregate(findings) => { risk, riskCode, score } with the weights in §8.
- Config in apps/guardian/config/rules.json; known contracts in apps/guardian/config/known-contracts.fuji.json (and a .local.json generated from the local deploy).
- POLICY_PRECHECK reads only the vault policy snapshot in ctx.
- The explorer lookup for UNKNOWN_CONTRACT sits behind a flag, has a cache and a 1 s timeout, and is off in tests.
- Fixtures in apps/guardian/test/fixtures/rules/*.json, built from real SimResult objects captured in P4 (save them with a small script).
- Tests: at least one positive and one negative fixture per rule, plus aggregation tests (no findings, mixed severities, score cap at 100).

Acceptance (paste outputs): vitest green; a table "ruleId → number of tests → positive/negative fixtures".
```

---

## P6 — Explainer

```text
Phase P6 — the explainer in apps/guardian/src/explain. Read docs/SPEC.md §9. The explainer writes text only; it can never change a risk level.

- Explainer interface; TemplateExplainer with Vietnamese and English templates per ruleId plus one for LOW (amounts with symbol and decimals, addresses shortened 0x1234…abcd).
- LlmExplainer: provider and model from env (LLM_PROVIDER, LLM_MODEL, LLM_API_KEY), low temperature, 1.5 s timeout, strict JSON output validated with zod, ≤ 400 characters per language.
- The LLM input is built only from the normalized diff, findings and token metadata. Never pass raw calldata, untrusted revert strings, or any text supplied by the agent.
- Fallback to the template on error, timeout, invalid JSON, or text that contradicts the risk (vi: "an toàn", "rủi ro thấp" vs "nguy hiểm", "rủi ro cao"; en: "safe", "low risk" vs "dangerous", "high risk").
- Architecture test: fails if anything in src/explain imports src/sign, rule aggregation code, or creates a viem wallet client.
- Tests with a fake LLM: valid JSON, invalid JSON, timeout, contradicting risk.

Acceptance (paste outputs): tests green; three example explanations from the TemplateExplainer (LOW, MEDIUM, HIGH) in Vietnamese and English.
```

---

## P7 — Guardian API có thu phí x402

```text
Phase P7 — the Guardian API in apps/guardian. Read docs/SPEC.md §6 in full, and vendor/x402-starter/src/server.mjs and facilitator.mjs.

- Express app: zod validation → vault context (policy cached 10 s, nonce never cached) → Simulator → rules → explainer → (cosign only) signer → store → respond, with the time budgets of §6.3.
- x402 exactly as in SPEC §6.4 with @x402/express 2.28.0. Before writing code, open node_modules/@x402/express and node_modules/@x402/core type definitions and confirm every name you use (paymentMiddleware, x402ResourceServer, HTTPFacilitatorClient, ExactEvmScheme, onAfterSettle and its context type). Fuji USDC must be priced as an AssetAmount.
- src/sign: holds GUARDIAN_SIGNER_PK; signs { callsHash, nonce read from the vault at request time, deadline = now + 60 s, true risk, checkId }.
- Free endpoints of §6.1. /v1/demo/check only when DEMO_MODE=true, rate-limited, CORS limited to the dashboard origin.
- SQLite store per §6.5 with migrations. pino logs; never log keys or payment signatures.

Tests:
- Unit: handler with mocked dependencies — LOW, MEDIUM, HIGH paths; 400 on bad input.
- E2E on the local fork with a self-hosted facilitator built from the starter's pattern, its RPC pointed at the fork:
  - a client with @x402/fetch (spendControls allowing Fuji USDC, as in SPEC §10) calls /v1/check → 200; USDC moved from the agent to PAY_TO on the fork; the payment row is stored;
  - an invalid body → 400 and no USDC moved;
  - /v1/cosign → verdict; executeBatch on the fork with it succeeds for a LOW case and reverts RiskTooHigh for the S4 case.
- Then on real Fuji with the public facilitator: one paid /v1/check from the agent wallet.

Acceptance (paste outputs): all tests green; the Fuji settlement link on testnet.snowtrace.io; p50 and p95 latency of /v1/check over 20 calls on the fork.
```

---

## P8 — Agent demo và các kịch bản

```text
Phase P8 — the demo agent in apps/agent. Read docs/SPEC.md §10.

- payingFetch exactly as in SPEC §10 (spendControls cap 0.02 USDC per payment).
- Modes safe and scripted-attack. Scenarios S1–S6 with the expected results in the §10 table.
- CLI: `pnpm agent scenario <S1..S6>`. Control API bound to 127.0.0.1, only with DEMO_MODE=true: POST /scenario/:id, GET /attempts.
- scripts/mine-lookalike.sh with `cast wallet vanity` against the deployed router address. Save only the address to apps/agent/fixtures/lookalike.json. Never fund it.
- Append every attempt to apps/agent/data/attempts.jsonl.
- Print in Vietnamese: Guardian risk and findings, the x402 settlement link, the vault tx link (success or revert reason).
- If a scenario's result differs from the §10 table, stop and report; do not change the expected result to make it pass.

Acceptance (paste outputs): S1–S6 on the local fork; S1, S2 and S4 on Fuji with Snowtrace links. S4 must end with RiskTooHigh.
```

---

## P9 — Dashboard

```text
Phase P9 — the dashboard in apps/dashboard. Read docs/SPEC.md §11.

- Next.js App Router, Tailwind, wagmi 2 with an injected connector (Core, MetaMask) on Fuji. Vietnamese UI, works on a phone width, light and dark.
- The six pages of §11 with the listed data sources. No backend of its own, no secrets in the frontend.
- A clear DEMO MODE banner whenever the Guardian reports demoMode or the agent control API answers.
- Owner actions (pause/unpause, revoke agent, change caps) open a confirmation dialog that shows exactly what changes, then send the transaction from the connected wallet.
- Render explanations as plain text. Every tx hash is a testnet.snowtrace.io link. Show risk with both colour and a word (THẤP / TRUNG BÌNH / CAO).
- Empty, loading and error states for every page.

Acceptance: `pnpm dev:dashboard` works against the Fuji deployment and the Guardian; a short screen recording or screenshots of each page; scenario buttons work in DEMO mode; Lighthouse accessibility >= 90 on Tổng quan.
```

---

## P10 — Bộ eval

```text
Phase P10 — the eval set in eval/. Read docs/SPEC.md §12.

- At least 40 cases with the exact mix in §12, each with a one-line description and the rules expected to fire.
- Runner `pnpm eval`: fresh local fork, deploy mocks and a vault, apply each case's setup, run the same pipeline as /v1/check (no payment, TemplateExplainer), write eval/report.md and eval/report.json.
- Report: confusion matrix with blocked = HIGH and again with blocked = MEDIUM or above; precision, recall, false positive rate; hits per rule; p50/p95 latency; a Vietnamese explanation of every false positive and false negative; a note that the cases are synthetic.
- Do not tune thresholds silently to the eval set. If you change one, record before/after numbers in the report and in docs/SPEC.md §16.

Acceptance (paste outputs): `pnpm eval` twice gives identical numbers; paste the summary table.
```

---

## P11 — Soát bảo mật, tài liệu, chạy thử từ repo sạch

```text
Phase P11 — hardening and docs.

1. Security review of AgentVault in a fresh session, acting as an adversarial auditor who did not write the code: list findings by severity, each with a failing test that demonstrates it. Fix them and keep the tests.
2. docs/THREAT_MODEL.md: assets, actors, trust assumptions; attacks and mitigations for agent key compromise, Guardian signer compromise, simulation divergence between check and execution, facilitator downtime, Guardian downtime, a malicious allowlisted protocol, LLM prompt injection; residual risks.
3. docs/DEMO_RUNBOOK.md: exact commands for the 3-minute demo on Fuji; a pre-demo checklist (agent AVAX and USDC, vault USDC, router mWAVAX, facilitator reachable, fork running); fallback plan (self-hosted facilitator, pre-recorded video).
4. README.md (English, plus a short Vietnamese summary): what it is, a mermaid architecture diagram, quickstart from a fresh clone, env setup, commands, deployed Fuji addresses, the list of everything mocked (DEMO MODE), a table "hackathon rule → where it is enforced → which test proves it", and the Vietnamese-law notes (crypto is not legal tender in Vietnam; the product holds no user funds and gives no financial advice).
5. Fresh-clone test: clone into a temp directory, follow the README exactly, record every step that breaks and fix the docs.

Acceptance: all tests green; README quickstart verified end to end; a list of remaining known issues in Vietnamese.
```

---

## Bonus B1 — ERC-8004 (chỉ làm khi P11 xong)

```text
Bonus B1 — ERC-8004 identity for the Guardian. Read docs/SPEC.md §13.1.

- Get the ABIs from https://github.com/erc-8004/erc-8004-contracts (folder abis/). Run `cast code` on each Fuji registry address in SPEC §2 and stop if any has no code.
- Registration file as in §13.1 (type registration-v1, services: web endpoint, MCP if built; x402Support: true; registrations with agentRegistry "eip155:43113:<IdentityRegistry>"). Host it, or use a base64 data: URI.
- Register with IdentityRegistry.register(agentURI); store the agentId in packages/shared addresses.
- Optional: the validation flow for HIGH verdicts as described in §13.1.
- Dashboard: a badge linking to the registration on Snowtrace.

Acceptance: register tx link; `cast call` shows the stored URI; a test validating the registration file against the spec fields.
```

## Bonus B2 — MCP server

```text
Bonus B2 — MCP server in apps/guardian-mcp. Read docs/SPEC.md §13.2 and node_modules/@x402/mcp README and types.

- Tools check_transaction (0.005 USDC) and cosign_transaction (0.01 USDC) wrapped with createPaymentWrapper, using the same resource-server config as the API (Fuji AssetAmount).
- Reuse the Guardian pipeline as a library, not over HTTP.
- Example client with createx402MCPClient, autoPayment, and an onPaymentRequested check that refuses anything above 0.02 USDC.

Acceptance: the example client call succeeds on the local fork and the settlement is visible.
```

---

## Prompt tiện ích

**Chống bịa API** — khi agent dùng hàm, tham số lạ:

```text
Stop. You used <name>. Show me where it is defined in node_modules (file path and the exact type signature) or in the official repo. If you cannot find it, remove it and rewrite that part using only APIs you have located. Do not continue until this is resolved.
```

**Debug:**

```text
Here is the error: <paste the full output>.
1. Reproduce it with the smallest command possible and show me that command.
2. Find the root cause and explain it in Vietnamese in 3 lines.
3. Propose the fix and a regression test. Do not change code until I reply "ok".
```

**Review trước khi commit:**

```text
Review the uncommitted diff as a strict reviewer who did not write it. Check it against docs/SPEC.md and the non-negotiable rules in CLAUDE.md. List problems by severity with file and line. Do not fix anything yet.
```

**Cắt scope khi trễ hạn:**

```text
Today is <date>. The end-to-end milestone is 15/11 and code freeze is 19/11. Compare the current state with docs/SPEC.md §14. Propose in Vietnamese what to cut or simplify so that S1 and S4 run end to end on Fuji by the milestone, with the cost of each cut for the judging criteria. Do not change code.
```
