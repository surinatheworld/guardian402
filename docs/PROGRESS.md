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

## P2 — Mock, deploy và seed lên Fuji (xong 2026-10-19)

- Mock DEMO trong `contracts/src/mocks/`: `MockERC20` (mWAVAX, 18 decimals, owner mint), `MockOracle` (25 USDC / mWAVAX), `MockRouter` (USDC → mWAVAX, pool 0 lệch 30 bps, pool 1 lệch 3.000 bps). 12 test trong `test/Mocks.t.sol`, có cả kịch bản S1 và S4 qua vault.
- Script: `Deploy.s.sol`, `Seed.s.sol` (chạy lại được nhiều lần), `HandOff.s.sol`; wrapper `scripts/contracts.mjs` (lấy key từ `.env.local`, từ chối nếu chain id khác 43113).
- Ví (testnet, key trong `.env.local`): deployer/treasury/PAY_TO `0x64281A1b566EB95Ac50c42282Cc257DBD518fB50`, owner `0x6678788309Ac06a05c584A05fe52181CcB4E3b72`, agent `0x7bD676072d0e34880F7003d8DA817F54ebB68ff7`, guardian `0xF1ff0D01D4B2fA90BCb234747b8409831A3C2359`.

Local fork (`pnpm fork` → `pnpm deploy:local` → `pnpm seed:local`): thành công; seed lần 2 → `No transactions to broadcast`.

Địa chỉ Fuji (`packages/shared/src/addresses/fuji.json`, trùng địa chỉ local vì cùng nonce deployer):

| Contract | Địa chỉ | Deploy tx | Verify |
| --- | --- | --- | --- |
| AgentVault | [0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99](https://testnet.snowtrace.io/address/0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99) | [0xb1ba847c…eceb](https://testnet.snowtrace.io/tx/0xb1ba847c24bb08024202e730e4443e51063e0b9e4acd98a436b0f7a9035eeceb) | Pass - Verified |
| mWAVAX (MockERC20) | [0x8Ed571d1666FC12D872c352cf53B377B3893f5EF](https://testnet.snowtrace.io/address/0x8Ed571d1666FC12D872c352cf53B377B3893f5EF) | [0xd539175d…8698](https://testnet.snowtrace.io/tx/0xd539175d179f9538325f2541b92bf9a91a346b775953175795d4a05e3b318698) | Pass, nhưng Routescan hiển thị source "ERC20Mock" khớp gần đúng có sẵn |
| MockOracle | [0xeebAac693aA19308bA859b3D668e3794310e66AE](https://testnet.snowtrace.io/address/0xeebAac693aA19308bA859b3D668e3794310e66AE) | [0x04beace0…4c45](https://testnet.snowtrace.io/tx/0x04beace0846becdb89b5bd3eb18babe690fb99577d8d10d4d42af2fb6a9e4c45) | Pass - Verified |
| MockRouter | [0x263a18Df9E627A862880Ec79E11aAC8671509355](https://testnet.snowtrace.io/address/0x263a18Df9E627A862880Ec79E11aAC8671509355) | [0x0bd4d30c…1dd8](https://testnet.snowtrace.io/tx/0x0bd4d30c21ecedbc0e186eb7fe4f2b37177d8a2011433e8b89b90faceedb1dd8) | Pass - Verified |
| CancunSmoke | [0x0D363882aA2DdA271323F91a1a268Cd707D3C426](https://testnet.snowtrace.io/address/0x0D363882aA2DdA271323F91a1a268Cd707D3C426) | (P1) | Pass - Verified |

Seed Fuji: 11 giao dịch, tất cả status 1 (gas cho owner/agent, mint 1.000 mWAVAX cho router, policy, allowlist, agent, guardian). Handoff: [0xe864b2e2…519d](https://testnet.snowtrace.io/tx/0xe864b2e2846874faeb6391d815cf327404ab234f858854c6a2fb694dc1f1519d) → `pendingOwner = 0x54A2276F134d3Cfaa7572BC326092fABa6352888`, chờ accept từ ví đó.

`cast call <vault> "getPolicy()(…)"` trên Fuji:

```
(owner 0x6678…3b72, pendingOwner 0x54A2…2888, agent 0x7bD6…8ff7, guardian 0xF1ff…2359, paused false, nonce 0, maxAgentRisk 0, day 20745,
 tokens [(USDC 0x5425…Bc65, cap 20000000, maxApproval 10000000, threshold 1000000, spentToday 0, balance 0)],
 native cap 1e17, threshold 1e16, spent 0, balance 0,
 targets [(router 0x263a…9355, [0x85e858b9 = swapExactIn])], recipients [router, treasury 0x6428…fB50])
router mWAVAX = 1000000000000000000000 (1.000 mWAVAX) · oracle price = 25000000
```

Nạp vault: team lấy USDC từ faucet (owner 40, agent 20); agent chuyển 10 USDC cho owner ([0xebb51dbf…8b09](https://testnet.snowtrace.io/tx/0xebb51dbf8c64506d2a78ae1a8e8d204e273f76c5a6372fc0689f0b96cb748b09)); `pnpm seed:fuji` chuyển 50 USDC vào vault ([0xb92cf374…2829](https://testnet.snowtrace.io/tx/0xb92cf3748417ee1c7803972c68fda5954edcbabe0c1f2c6cb79ea649f1c72829), status 1).

```
cast call USDC "balanceOf(address)(uint256)" 0x32cb…Ab99   → 50000000   (vault: 50 USDC)
cast call mWAVAX "balanceOf(address)(uint256)" 0x263a…9355 → 1000000000000000000000   (router: 1.000 mWAVAX)
agent 0x7bD6…8ff7: 10 USDC (phí x402), 0.1 AVAX
```

Ownership: OWNER_PK vẫn là owner tới hết P8 (team lead accept sau P8), nên seed và S6 (kill switch) do OWNER_PK chạy. Mock: mWAVAX, MockOracle, MockRouter (DEMO MODE).

## P3 — Package shared và cross-check verdict (xong 2026-10-19)

- `packages/shared`: ABI sinh tự động (`pnpm abi` → `src/abi/*.ts`, `as const`), địa chỉ theo NETWORK (`getAddresses`, `parseNetwork`), hằng số (chain, USDC Fuji, giá x402, rule id, mã rủi ro), schema zod đúng SPEC §6.2 (`CheckRequest`, `CheckResponse`, `Finding`, `Diff`, `Verdict`), `verdict.ts` (`hashCalls`, `verdictTypes`, `verdictDomain`, `recoverVerdictSigner`) và `sign.ts` (`signVerdict`, chỉ export qua `@guardian402/shared/sign`).
- Cross-check: `scripts/gen-verdict-fixture.ts` ký verdict bằng TypeScript và ghi `contracts/test/fixtures/verdict.json`; `VerdictCrossCheck.t.sol` deploy vault từ deployer cố định ở nonce 0 (`vm.computeCreateAddress` = `getContractAddress`), xác nhận vault chấp nhận verdict rồi đột biến từng trường và từng call.

```
pnpm --filter @guardian402/shared test
 Test Files  4 passed (4)
      Tests  33 passed (33)

pnpm test:crosscheck
[crosscheck] vault 0x4CEc0f582a574812244196266BAf1fe0d7565C6d signer 0xdA23b9314AEAF0a70b93697B520e6ee4665cAe9c
[PASS] test_EncodingMatchesTypeScript()      (hashCalls và EIP-712 digest khớp từng byte)
[PASS] test_AcceptsTypeScriptVerdict()
[PASS] test_RejectsMutatedCallsHash / Nonce / Deadline / Risk / CheckId / Signature, test_RejectsExpiredVerdict, test_RejectsOtherChain, test_RejectsReplay
[PASS] test_RejectsOneByteChangeInEachCall, test_RejectsMutatedValue, test_RejectsMutatedTarget, test_RejectsReorderedCalls, test_RejectsDroppedCall
Suite result: ok. 16 passed; 0 failed; 0 skipped

forge test (toàn bộ) → 7 test suites: 141 tests passed, 0 failed · pnpm lint, pnpm typecheck, pnpm format:check → sạch
```

Mock: không có (fixture chỉ dùng key/địa chỉ thử nghiệm, không có tiền).

## Checklist trước demo

- [ ] **Owner accepts ownership from 0x54A2…2888 before the demo** (chỉ làm sau khi P8 xong). Ví `0x54A2276F134d3Cfaa7572BC326092fABa6352888` đã là `pendingOwner` của AgentVault (tx [0xe864b2e2…519d](https://testnet.snowtrace.io/tx/0xe864b2e2846874faeb6391d815cf327404ab234f858854c6a2fb694dc1f1519d)). Các bước:
  1. Trong Core hoặc MetaMask, chọn ví `0x54A2…2888` và mạng Avalanche Fuji C-Chain (chain id 43113). Ví cần một ít AVAX testnet để trả gas.
  2. Mở https://testnet.snowtrace.io/address/0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99 (AgentVault, đã verify), chọn tab **Contract** rồi **Write Contract**.
  3. Bấm **Connect to Web3** và kết nối ví `0x54A2…2888`.
  4. Mở hàm **acceptOwnership** (không có tham số) → **Write** → xác nhận giao dịch trong ví.
  5. Kiểm tra trong tab **Read Contract**: `owner()` = `0x54A2276F134d3Cfaa7572BC326092fABa6352888` và `pendingOwner()` = `0x0000000000000000000000000000000000000000`. Hoặc chạy:
     `cast call 0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99 "owner()(address)" --rpc-url https://api.avax-test.network/ext/bc/C/rpc`
  6. Sau bước này OWNER_PK không còn quyền owner: pause/unpause, đổi cap, revoke agent làm từ ví `0x54A2…2888` (dashboard, trang Điều khiển).
