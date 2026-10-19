# Guardian402 — Tiến độ

Mỗi phase: tóm tắt, lệnh đã chạy, kết quả test (output thật), link Fuji, và những gì là mock.

## P0 — Dựng repo và kiểm tra toolchain (xong 2026-10-19)

- Monorepo pnpm 10.34.7: `packages/shared`, `apps/{guardian,agent,dashboard}`, `eval`; TypeScript 6.0.3 strict, vitest 5, ESLint 10, Prettier.
- `contracts/`: Foundry 1.8.5, solc 0.8.28, `evm_version = "cancun"`, OpenZeppelin v5.7.0, forge-std v1.17.0.
- `pnpm fork`: Anvil fork Fuji (native, hoặc Docker `ghcr.io/foundry-rs/foundry:v1.8.5` khi Windows chặn `anvil.exe`).
- `.env.example` cho mọi biến của SPEC §3; starter x402 của Team1 trong `vendor/x402-starter/` (chỉ đọc).
- Lệch khỏi spec: ghi ở SPEC §16 (Node ≥ 22.13, cancun + OZ 5.7.0, anvil qua Docker/WSL2).

Kết quả nghiệm thu:

```
node -v → v24.21.0 · pnpm -v → 10.34.7 · forge 1.8.5 · anvil 1.8.5 (docker)
cast chain-id --rpc-url http://127.0.0.1:8545 → 43113
cast call 0x5425…Bc65 "symbol()(string)" → "USDC"
forge build → Compiler run successful! · pnpm -r test → shared: Tests 1 passed (1)
```

Mock: không có.

## P1 — AgentVault và test (xong 2026-10-19)

### Smoke test Cancun trên Fuji (xong)

Contract `contracts/src/smoke/CancunSmoke.sol` thực thi thật TSTORE/TLOAD (EIP-1153) và MCOPY (EIP-5656) trong giao dịch trên Fuji. Bytecode runtime có `TLOAD`, `TSTORE`, `MCOPY` (`cast disassemble`).

```
forge script script/CancunSmoke.s.sol --sig "deploy()" --rpc-url $FUJI_RPC_URL --broadcast --slow
forge script script/CancunSmoke.s.sol --sig "checkTransient(address)" 0x0D36…C426 --rpc-url $FUJI_RPC_URL --broadcast --slow
forge script script/CancunSmoke.s.sol --sig "checkMcopy(address)" 0x0D36…C426 --rpc-url $FUJI_RPC_URL --broadcast --slow
```

| Giao dịch | Link | Kết quả |
| --- | --- | --- |
| Deploy CancunSmoke | [0x590d0a0f…3529](https://testnet.snowtrace.io/tx/0x590d0a0f4ef21bc0a9a9d4dee290e6232f2cc6de88573e0fb935630838963529) | status 1, block 59672362 |
| `checkTransient(402)` | [0xb5adee96…4235](https://testnet.snowtrace.io/tx/0xb5adee964f5fdbf4ee78a19156e61db2313fd1268a46787b222d29e3efe94235) | status 1, trả về 402 |
| `checkMcopy(65 bytes)` | [0x2996f8c6…fa98](https://testnet.snowtrace.io/tx/0x2996f8c6fb20db3be48d4c9106d2cc3a861bbcc8318f41df72f452f1c662fa98) | status 1, hash khớp |

Đọc lại trên Fuji: `lastTransientValue() = 402`, `peekTransient() = 0` (transient storage đã bị xoá sau giao dịch, đúng EIP-1153), `lastCopyHash() = keccak256(payload)`, `lastCopyLength() = 65`.
Contract: [0x0D363882aA2DdA271323F91a1a268Cd707D3C426](https://testnet.snowtrace.io/address/0x0D363882aA2DdA271323F91a1a268Cd707D3C426). Deployer: `0x64281A1b566EB95Ac50c42282Cc257DBD518fB50`.

Kết luận: giữ `cancun` + OZ v5.7.0, không cần fallback.

### AgentVault (xong 2026-10-19)

- `contracts/src/AgentVault.sol`: Ownable2Step + EIP712 + ReentrancyGuard (không transient), `executeBatch` đúng 8 bước §4.3, owner functions, views (`getPolicy`, `remainingToday`, `hashCalls`, `verdictDigest`), 16 custom error.
- Test: `AgentVault.t.sol` (95 test: mọi error path, mọi happy path, biên ngưỡng, sang ngày, native, owner override, reentrancy), `AgentVault.fuzz.t.sol` (10), `AgentVault.invariant.t.sol` (6 bất biến §4.5 + 1 phụ). Mock test: `MockUSDC`, `MockTarget`, `ReentrantTarget` trong `test/mocks/`.
- Chỗ spec chưa rõ: xử lý theo hướng an toàn nhất, ghi ở SPEC §16.

```
cd contracts && forge build
Compiler run successful!            (không có warning compiler hay lint)

forge test -vvv
Ran 95 tests for test/AgentVault.t.sol:AgentVaultTest            ok. 95 passed; 0 failed
Ran 10 tests for test/AgentVault.fuzz.t.sol:AgentVaultFuzzTest   ok. 10 passed; 0 failed   (256 runs mỗi test)
Ran 1 test for test/AgentVault.invariant.t.sol                   ok. 7 invariants  (runs: 256, calls: 16384, reverts: 0)
Ran 6 tests for test/CancunSmoke.t.sol · 1 test for test/Toolchain.t.sol
Ran 5 test suites: 113 tests passed, 0 failed, 0 skipped

forge coverage --report summary --no-match-coverage "(test|script)/"
| src/AgentVault.sol | 100.00% (196/196) | 100.00% (245/245) | 100.00% (55/55) | 100.00% (34/34) |
```

| Bất biến (§4.5) | Test |
| --- | --- |
| 1. Outflow agent mỗi ngày ≤ dailyCap (token và native) | `invariant_DailyOutflowWithinCap`; `testFuzz_CumulativeDailyCap`, `testFuzz_CapResetsAfterDayBoundary`; `test_RevertWhen_DailyCapExceededAcrossBatches`, `test_DailyCap_ResetsOnNextDay` |
| 2. Agent không đổi được owner/agent/guardian/policy/pause | `invariant_AgentCannotChangeAdminState`; `test_RevertWhen_NonOwnerCallsOwnerFunctions`, `test_Reentrancy_TargetCannotChangeAgent` |
| 3. Khi pause, agent không chuyển được tiền | `invariant_PausedAgentMovesNothing`; `test_RevertWhen_Paused`, `test_RevertWhen_PausedCheckedBeforeCaller` |
| 4. Verdict dùng tối đa 1 lần (nonce tăng dần) | `invariant_VerdictUsedAtMostOnce`; `test_RevertWhen_VerdictReplayed`, `test_FailedBatchDoesNotConsumeNonce` |
| 5. Owner luôn rút được toàn bộ, pause hay không | `invariant_OwnerCanWithdrawEverything`; `test_Withdraw_FullBalanceWhilePaused`, `test_RevertWhen_RenounceOwnership` |
| 6. Verdict cho calls A không mở khoá calls B | `invariant_VerdictBoundToCalls`; `testFuzz_VerdictForOneAmountDoesNotAuthorizeAnother`, `test_RevertWhen_VerdictForOtherCalls_*` (target, value, data, thứ tự) |

Mock: chỉ trong test (`test/mocks/`), không deploy. Rủi ro còn lại cho P11: approval đã cấp (có verdict) vẫn còn sau batch, spender trong allowlist có thể kéo tối đa `maxApproval` sau đó.
