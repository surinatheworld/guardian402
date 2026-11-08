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

Địa chỉ Fuji đang dùng (`packages/shared/src/addresses/fuji.json`). mWAVAX và MockRouter đã được deploy lại ngày 2026-10-19, xem mục "Sửa mWAVAX" bên dưới:

| Contract | Địa chỉ | Deploy tx | Verify |
| --- | --- | --- | --- |
| AgentVault | [0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99](https://testnet.snowtrace.io/address/0x32cb61054E31678E6Afa6731B0DC70D330a1Ab99) | [0xb1ba847c…eceb](https://testnet.snowtrace.io/tx/0xb1ba847c24bb08024202e730e4443e51063e0b9e4acd98a436b0f7a9035eeceb) | Pass - Verified |
| mWAVAX (MockERC20) | [0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5](https://testnet.snowtrace.io/address/0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5) | [0xce77caa0…c8b8](https://testnet.snowtrace.io/tx/0xce77caa0c5c0d9b66626b9dda8dd27def4c6dc105c7cd559494911146e05c8b8) | Pass - Verified (`MockERC20`) |
| MockOracle | [0xeebAac693aA19308bA859b3D668e3794310e66AE](https://testnet.snowtrace.io/address/0xeebAac693aA19308bA859b3D668e3794310e66AE) | [0x04beace0…4c45](https://testnet.snowtrace.io/tx/0x04beace0846becdb89b5bd3eb18babe690fb99577d8d10d4d42af2fb6a9e4c45) | Pass - Verified |
| MockRouter | [0xe20967C615e442991D468ed7f797edcAeA1771d9](https://testnet.snowtrace.io/address/0xe20967C615e442991D468ed7f797edcAeA1771d9) | [0x6028b2f6…a24b](https://testnet.snowtrace.io/tx/0x6028b2f6865c35a64ed441f0e22afb156dc74cb4b0daadf447ce25a3c97ca24b) | Pass - Verified |
| CancunSmoke | [0x0D363882aA2DdA271323F91a1a268Cd707D3C426](https://testnet.snowtrace.io/address/0x0D363882aA2DdA271323F91a1a268Cd707D3C426) | (P1) | Pass - Verified |

Seed Fuji: 11 giao dịch, tất cả status 1 (gas cho owner/agent, mint 1.000 mWAVAX cho router, policy, allowlist, agent, guardian). Handoff: [0xe864b2e2…519d](https://testnet.snowtrace.io/tx/0xe864b2e2846874faeb6391d815cf327404ab234f858854c6a2fb694dc1f1519d) → `pendingOwner = 0x54A2276F134d3Cfaa7572BC326092fABa6352888`, chờ accept từ ví đó.

`cast call <vault> "getPolicy()(…)"` trên Fuji, đọc lúc seed lần đầu (với router cũ). Số liệu hiện tại xem ở mục "Sửa mWAVAX":

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
cast call mWAVAX "balanceOf(address)(uint256)" <router> → 1000000000000000000000   (router: 1.000 mWAVAX; đúng cả với router mới 0xe209…71d9)
agent 0x7bD6…8ff7: 10 USDC (phí x402), 0.1 AVAX
```

Ownership: OWNER_PK vẫn là owner tới hết P8 (team lead accept sau P8), nên seed và S6 (kill switch) do OWNER_PK chạy. Mock: mWAVAX, MockOracle, MockRouter (DEMO MODE).

### Rà soát lại P2 (2026-10-19, theo yêu cầu "phải chuẩn")

- `forge build` sạch, không có cảnh báo. `forge test`: 7 suite, 141 test pass, 0 fail. Coverage: AgentVault, MockERC20, MockOracle, MockRouter đều 100% dòng, câu lệnh và hàm. Phần nhánh (branch) cũng 100%, riêng MockERC20 không có nhánh nào để đo.
- Đọc trực tiếp trên Fuji và so với SPEC §4.8: **26/26 giá trị khớp**. Gồm owner, pendingOwner, agent, guardian, paused, maxAgentRisk; USDC được theo dõi với cap 20, maxApproval 10, threshold 1; vault có 50 USDC; native cap 0,1 và threshold 0,01; router là target duy nhất, chỉ cho selector `swapExactIn`; recipient gồm router và treasury; oracle 25 USDC; router có 1.000 mWAVAX; router trỏ đúng USDC, mWAVAX và oracle; mWAVAX có 18 decimals.
- Giao dịch P2 trên Fuji: **20/20 status 1**. Gồm 4 deploy, 11 seed, 3 lần seed nạp vault (gồm cả nạp gas), 1 handoff và 1 lệnh chuyển 10 USDC từ agent sang owner.
- Verify trên Routescan: AgentVault, MockOracle, MockRouter, CancunSmoke đã verify (solc 0.8.28, cancun). Lúc rà soát còn lệch: mWAVAX cũ hiển thị source "ERC20Mock" (solc 0.8.27) mà Routescan khớp gần đúng từ trước. **Đã sửa** theo quyết định của team, xem mục bên dưới.

### Sửa mWAVAX: deploy lại mWAVAX và MockRouter (2026-10-19)

Team quyết định deploy lại để mWAVAX hiển thị đúng source. Các bước:

1. `MockERC20` có thêm hằng `NOTICE = "DEMO ONLY: Guardian402 testnet mock token, no value"`. Hằng này làm bytecode khác "ERC20Mock", nên Routescan không thể khớp gần đúng như lần trước, và người xem explorer cũng biết đây là token mock.
2. Script mới `contracts/script/RedeployMocks.s.sol`:
   - `deploy()`: deployer tạo mWAVAX và MockRouter mới (dùng lại USDC và MockOracle), mint 1.000 mWAVAX cho router, rồi ghi lại `fuji.json`.
   - `swapAllowlist(oldRouter)`: owner gỡ router cũ khỏi allowlist của vault và cho phép router mới.
   - Lệnh chạy: `pnpm redeploy-mocks:fuji` (verify ngay trong cùng lượt chạy, trước khi có truy vấn nào khác tới địa chỉ mới) và `pnpm swap-router:fuji <oldRouter>`.
3. Chạy thử trước trên fork local, rồi mới làm trên Fuji.

| Bước | Giao dịch | Status |
| --- | --- | --- |
| Deploy mWAVAX mới [0xC2439b70…7ba5](https://testnet.snowtrace.io/address/0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5) | [0xce77caa0…c8b8](https://testnet.snowtrace.io/tx/0xce77caa0c5c0d9b66626b9dda8dd27def4c6dc105c7cd559494911146e05c8b8) | 1 |
| Deploy MockRouter mới [0xe20967C6…71d9](https://testnet.snowtrace.io/address/0xe20967C615e442991D468ed7f797edcAeA1771d9) | [0x6028b2f6…a24b](https://testnet.snowtrace.io/tx/0x6028b2f6865c35a64ed441f0e22afb156dc74cb4b0daadf447ce25a3c97ca24b) | 1 |
| Mint 1.000 mWAVAX cho router mới | [0xbe0731b0…bc5b](https://testnet.snowtrace.io/tx/0xbe0731b0d770a2cc7cfe308402e41e973255a8fc385d77d6800dd9c22f43bc5b) | 1 |
| Gỡ selector `swapExactIn` của router cũ | [0x980dddc0…1974](https://testnet.snowtrace.io/tx/0x980dddc0dd6a197000e7febda2aabab7e4417608912b9ce09b3af7ac44a31974) | 1 |
| Gỡ router cũ khỏi allowed target | [0x38dbc132…6adc](https://testnet.snowtrace.io/tx/0x38dbc132f08d7b6bd874ce9e50303084e0c8cfe896a7e4c295e946b736d73adc) | 1 |
| Gỡ router cũ khỏi allowed recipient | [0x03efadc4…0855](https://testnet.snowtrace.io/tx/0x03efadc47a31dd215565539a3bc8b38ccfbffaf333df891bb95898cc7d550855) | 1 |
| Cho phép router mới làm target | [0x3c4b2a79…0a4d](https://testnet.snowtrace.io/tx/0x3c4b2a793eb7fecfe9fca27e92a1c28519beb55cbed0396e7cf3e172e8dd0a4d) | 1 |
| Cho phép selector `swapExactIn` của router mới | [0xec487ef9…150f](https://testnet.snowtrace.io/tx/0xec487ef914739819b89930164622976bada7c00411ca7fb6b9f9b7dc77c8150f) | 1 |
| Cho phép router mới làm recipient | [0x38ffb64f…d7d1](https://testnet.snowtrace.io/tx/0x38ffb64fc94f7efc5940edf31492ff2739d3024c653229ffbfdb00cb04aad7d1) | 1 |
| `pnpm seed:fuji` (chỉ nạp bù 0,00003 AVAX gas cho owner) | [0x281e1e91…1a3d](https://testnet.snowtrace.io/tx/0x281e1e91281d6614d55dfbdc8a10508fe0011defaab5a90fc6cba17ca2871a3d) | 1 |

Kiểm tra lại sau khi sửa:

- Đọc trực tiếp trên Fuji: **30/30 giá trị khớp**. Gồm toàn bộ §4.8; allowed target chỉ còn router mới, và chỉ cho selector `swapExactIn`; recipient gồm treasury và router mới; router cũ không còn là allowed target, allowed selector hay recipient; vault không còn allowance nào cho router cũ; router mới trỏ đúng USDC, mWAVAX mới và oracle; router mới có 1.000 mWAVAX; vault vẫn có 50 USDC.
- Giao dịch sửa lỗi: **10/10 status 1** (đã kiểm tra bằng `eth_getTransactionReceipt` trên node Fuji).
- Verify trên Routescan: **cả 5 contract hiện dùng đều đúng source của repo**: AgentVault, `MockERC20` (mWAVAX), MockOracle, MockRouter, CancunSmoke (solc 0.8.28, cancun).
- `forge test`: 141 test pass. `pnpm abi` đã sinh lại ABI (có thêm `NOTICE`). `packages/shared`: 33 test pass.
- Contract cũ vẫn còn trên chain nhưng vault không dùng nữa: mWAVAX [0x8Ed571d1…f5EF](https://testnet.snowtrace.io/address/0x8Ed571d1666FC12D872c352cf53B377B3893f5EF), MockRouter [0x263a18Df…9355](https://testnet.snowtrace.io/address/0x263a18Df9E627A862880Ec79E11aAC8671509355).

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

## P4 — Simulator (code xong 2026-10-30, nhánh `feat/p4-simulator`, chưa merge)

- `apps/guardian/src/sim`: `Simulator.simulate(vault, calls, trackedTokens)` theo SPEC §7.
  - Chạy dưới mutex. Các bước: snapshot → impersonate vault → thêm gas → đọc số dư → gửi từng call từ vault, mỗi call một block → receipt và log → đọc số dư → revert → bỏ impersonate.
  - Giải mã Transfer, Approval và ApprovalForAll. Native delta không tính gas.
  - Khi call bị revert, chạy lại bằng `eth_call` ở block trước để lấy lý do (custom error của vault/mock, `Error(string)`, hoặc hex thô).
  - Timeout 800 ms thì trả `success: false, timedOut: true`.
- Anvil 1.8.5 chấp nhận giao dịch từ vault đang bị impersonate (không vướng EIP-3607), nên **không dùng** cách dự phòng `setCode(vault, "0x")`.
- Các lỗi tìm ra và đã sửa khi làm tiếp:
  - Test reset cũ so sánh với block Fuji lấy *sau* khi reset, nên kết quả không ổn định. Test mới so với block lấy *trước* khi reset, và kiểm tra riêng từng trường hợp reset: do tụt hơn 2 phút, do hết chu kỳ 5 phút, và do timer chạy nền.
  - `pnpm fork` thêm `--hardfork cancun`. Mặc định của Anvil là hardfork mới nhất, không giống Fuji, và mỗi block mine đều gọi lên RPC Fuji (~180 ms).
  - Việc kiểm tra fork tụt sau Fuji (gọi RPC Fuji ~500 ms) trước đây chạy ngay trong request, cứ 15 giây một lần. Nay nó chạy nền qua `start()`/`stop()`, nên request chỉ còn các kiểm tra local.
  - Nếu process chết giữa lúc mô phỏng, snapshot không được revert (ví dụ allowance còn lại trên fork). Sửa: lần kiểm tra đầu tiên của mỗi process luôn reset fork, và test luôn bắt đầu từ fork sạch.
  - Anvil làm mất cache các slot đã đọc trong snapshot khi revert (~40 ms mỗi slot, mỗi lần). Sửa: lấy danh sách slot bằng `prestateTracer`, sau khi revert thì đọc lại các slot đó ở ngoài snapshot. Ngoài ra luôn giữ một block local phía trên block được fork.

Cách chạy: `pnpm fork` (cần Docker Desktop đang chạy trên máy này), rồi `pnpm --filter @guardian402/guardian test:fork`.

Lần chạy đủ trên code hiện tại, 2026-10-30 (sau lần này chỉ đổi một dòng comment đầu file):

```
[latency] runs (ms): 278 295 251 324 295 376 259 279 292 275 289 296 295 295 309 278 287 300 323 279
[latency] simulate() over 20 runs: p50 292 ms, p95 324 ms
      Tests  13 passed (13)
```

Lần chạy cuối, sau 20 phút chờ RPC mở lại: 12/13 pass, p50 261 ms, p95 297 ms. Test `start(): background maintenance…` lỗi vì RPC công khai `api.avax-test.network` lại chặn IP giữa chừng (HTTP 429, Cloudflare 1015), không phải lỗi logic.

Các kiểm tra khác: unit test guardian 10/10, shared 33/33, `forge test` 141/141. `pnpm typecheck`, `pnpm lint`, `pnpm format:check` sạch.

Câu hỏi mở:
- RPC công khai của Fuji giới hạn tần suất, và một lần chạy suite fork (có reset) đã có thể vượt giới hạn đó. Khi demo, sau mỗi lần reset 5 phút fork cũng phải tải lại state. Nên dùng một RPC Fuji riêng (cần API key) đặt trong `FUJI_RPC_URL`.

Mock: không có. Simulator chạy trên fork của Fuji thật và dùng deployment đã seed trên Fuji.

## P5 — Rule engine (xong 2026-11-07, nhánh `feat/p5-rules`)

- `apps/guardian/src/rules`: 8 rule của SPEC §8, mỗi rule là hàm thuần `(sim, ctx, cfg) => Finding[]` (`checks.ts`), `aggregate()` (HIGH = 60, MEDIUM = 25, tối đa 100), `runRules()` chạy theo thứ tự `RULE_IDS`.
- Ngưỡng ở `apps/guardian/config/rules.json`. Registry contract đã biết: `config/known-contracts.{fuji,local}.json`, sinh bằng `pnpm known-contracts` từ địa chỉ đã deploy (USDC, mWAVAX, oracle, router, vault, hai registry ERC-8004).
- `apps/guardian/src/context.ts`: đọc `getPolicy()`, giá MockOracle và danh sách địa chỉ có code. Đây là chỗ duy nhất đầu vào của rule chạm tới chain; rule không gọi mạng (có test kiến trúc).
- Tra explorer cho `UNKNOWN_CONTRACT`: tắt mặc định (`explorerLookup.enabled = false`), chỉ đọc `ctx.explorer` do pipeline điền; test và eval không bật.
- Fixture: 14 `SimResult` thật chụp trên fork bằng `pnpm --filter @guardian402/guardian fixtures:rules` (`apps/guardian/test/fixtures/rules/*.json`). Hai fixture chỉnh context (ghi rõ trong file): `medium-slippage` (giá tham chiếu hạ 4,7%) và `cap-nearly-spent` (đã tiêu 19/20 USDC trong ngày).

Kết quả trên fixture thật:

| Fixture | Risk | Rule bắn |
| --- | --- | --- |
| normal-swap (S1) | LOW | — |
| bad-slippage (S4) | HIGH | ABNORMAL_SLIPPAGE (3000 bps), không rule tĩnh nào |
| drain-to-attacker (S2) | HIGH | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED |
| poisoned-approval (S3) | HIGH | POLICY_PRECHECK, UNLIMITED_APPROVAL, ADDRESS_POISONING |
| medium-slippage | MEDIUM | ABNORMAL_SLIPPAGE (498 bps) |
| reverting-swap | HIGH | SIMULATION_FAILED |
| unknown-contract-call / -approval | HIGH | POLICY_PRECHECK, UNKNOWN_CONTRACT (MEDIUM / HIGH) |

| ruleId | test trên fixture | dương / âm |
| --- | --- | --- |
| SIMULATION_FAILED | 3 (+ timeout, không lộ chuỗi revert) | 1 / 2 |
| POLICY_PRECHECK | 11 (+ pause, thu hồi agent, hạn mức ngày) | 6 / 5 |
| UNLIMITED_APPROVAL | 6 (+ ApprovalForAll, giải mã calldata khi mô phỏng lỗi) | 3 / 3 |
| UNKNOWN_CONTRACT | 5 (+ MEDIUM/HIGH, EOA, cờ explorer) | 2 / 3 |
| ADDRESS_POISONING | 4 (+ 3/3 ở DEMO) | 1 / 3 |
| DRAIN_PATTERN | 4 (+ biên đúng 50%) | 2 / 2 |
| ABNORMAL_SLIPPAGE | 4 (+ MEDIUM, thiếu oracle) | 2 / 2 |
| RECIPIENT_NOT_ALLOWLISTED | 4 | 2 / 2 |

```
pnpm --filter @guardian402/guardian exec vitest run
 Test Files  2 passed (2)
      Tests  74 passed (74)      (rules 64, decode 10)
pnpm typecheck, pnpm lint, pnpm format:check → sạch
```

Mock: không có (rule chỉ đọc kết quả mô phỏng và context).

## P6 — Explainer (xong 2026-11-07, nhánh `feat/p6-explainer`)

- `apps/guardian/src/explain`: interface `Explainer`, `TemplateExplainer` (mẫu câu tiếng Việt và tiếng Anh cho từng ruleId và cho LOW; số tiền có ký hiệu và số thập phân, địa chỉ rút gọn `0x1234…abcd`, contract đã biết hiện tên), `LlmExplainer` (≤ 400 ký tự mỗi ngôn ngữ, timeout 1,5 s, kiểm tra JSON bằng zod, quay về mẫu câu khi lỗi, quá giờ, JSON sai, hoặc câu chữ trái với mức rủi ro).
- Nhà cung cấp: `LLM_PROVIDER=none` (chỉ mẫu câu, mặc định) hoặc `anthropic` (SDK chính thức `@anthropic-ai/sdk` 1.3.0, model mặc định `claude-opus-5-5`, structured output JSON, effort `low`, không retry).
- Đầu vào của LLM chỉ gồm diff đã chuẩn hoá, findings và nhãn tin cậy (`src/explain-input.ts`); không có calldata, chuỗi revert hay chữ do agent gửi (có test).
- Test kiến trúc: `src/explain` không import signer, phần gộp rủi ro, và không tạo wallet client.

Ví dụ từ `TemplateExplainer` trên fixture thật:

```
[LOW normal-swap]
 vi: Rủi ro THẤP. Vault: -2 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
 en: LOW risk. Vault: -2 USDC, +0.07976 mWAVAX. No warning signs found.
[MEDIUM medium-slippage]
 vi: Rủi ro TRUNG BÌNH. Hoán đổi nhận ít hơn giá tham chiếu 4,98%. Vault: -2 USDC, +0,07976 mWAVAX.
 en: MEDIUM risk. The swap returns 4.98% less than the reference price. Vault: -2 USDC, +0.07976 mWAVAX.
[HIGH drain-to-attacker]
 vi: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 100% số dư (50 USDC) ra khỏi vault. 50 USDC rời vault tới 0x0000…a77A, ngoài danh sách cho phép. Vault: -50 USDC.
 en: HIGH risk. The vault policy would reject it: recipient not allowed. Moves 100% of the balance (50 USDC) out of the vault. 50 USDC leaves the vault to 0x0000…a77A, outside the allowlist. Vault: -50 USDC.
```

```
pnpm --filter @guardian402/guardian exec vitest run
 Test Files  3 passed (3)
      Tests  87 passed (87)      (explain 13, rules 64, decode 10)
```

Chưa thử với LLM thật: `.env.local` chưa có `LLM_API_KEY` (đang `LLM_PROVIDER=none`). Các nhánh lỗi của `LlmExplainer` đã test bằng LLM giả.
Mock: không có.

## P7 — Guardian API có thu phí x402 (xong 2026-11-07, nhánh `feat/p7-api`)

- `apps/guardian/src`: `pipeline.ts` (zod → policy, cache 10 s, nonce đọc mới mỗi lần → mô phỏng 800 ms → rule → giải thích → ký verdict khi cosign → lưu → trả lời), `app.ts` (Express 5, các endpoint §6.1), `x402.ts` (`paymentMiddleware` + `x402ResourceServer` + `HTTPFacilitatorClient` + `ExactEvmScheme` của `@x402/*` 2.28.0, giá Fuji USDC dạng AssetAmount), `sign/` (khoá `GUARDIAN_SIGNER_PK`, luôn ký mức rủi ro thật, hạn 60 s), `store.ts` (SQLite có migration, không lưu IP), `facilitator.ts` (facilitator tự chạy theo mẫu của starter), `server.ts`.
- Mỗi khoản thanh toán được lưu kèm `checkId`, lấy từ body phản hồi trong hook `onAfterSettle`.
- `/v1/demo/check` chỉ có khi `DEMO_MODE=true`, giới hạn 30 lần/phút. CORS chỉ cho `DASHBOARD_ORIGIN`.
- Sau mỗi lần reset fork (5 phút một lần), Guardian chạy thử một batch S1 để nạp sẵn dữ liệu. Không có bước này, lần check đầu sau reset bị quá 800 ms và ra HIGH (`SIMULATION_FAILED`).

Lệnh: `pnpm dev:guardian`, `pnpm facilitator`, `pnpm --filter @guardian402/guardian pay-check [check|cosign]`.

Test:

```
pnpm --filter @guardian402/guardian exec vitest run          → Tests 94 passed (api 7, explain 13, rules 64, decode 10)
pnpm --filter @guardian402/guardian test:fork (api.fork.test.ts, facilitator tự chạy trỏ vào fork)
  ✓ /v1/check: 402 khi chưa trả, 200 sau khi trả 0,005 USDC cho PAY_TO; có dòng payment kèm checkId
  ✓ body sai → 400, không có USDC nào bị chuyển (không tính phí)
  ✓ /v1/cosign S1 (LOW): executeBatch với verdict chạy thành công trên fork
  ✓ /v1/cosign S4 (HIGH, trượt giá): vault revert RiskTooHigh
  [latency] /v1/check có trả phí (402 + ký + verify + pipeline + settle), 20 lần: p50 828 ms, p95 1284 ms
  [latency] riêng pipeline (latencyMs), cùng 20 lần: p50 307 ms, p95 362 ms
  Tests 5 passed (5)
```

Fuji thật:

- Facilitator công khai `facilitator.ultravioletadao.xyz` lỗi lúc thử (3 lần trả `502 upstream_rpc_unavailable`). Không có giao dịch nào lên chain, agent không mất tiền.
- Chuyển sang facilitator tự chạy trên Fuji. Ví trả gas mới `0x9e857D50D16405D150F3fcE1d22f3FC43821F911` (khoá `FACILITATOR_PK` trong `.env.local`), nạp 0,05 AVAX từ ví deploy: [0xc4deb438…687e](https://testnet.snowtrace.io/tx/0xc4deb4389cbdfc965f258bb4c7a2cde82cf666de01b4230aed0bd09a47b4687e).
- Một `/v1/check` có trả phí từ ví agent, kết quả LOW, settlement: [0xaba2f279…cb7d](https://testnet.snowtrace.io/tx/0xaba2f279d559eea89db94801abef1359e2abb6400fd5071c252325e9d448cb7d). Trước khi có bước nạp sẵn dữ liệu, một lần trả phí khác cũng settle ([0xbabac703…8dd9](https://testnet.snowtrace.io/tx/0xbabac70371951b8b17ed41add8da1e508b577e1fc0110e781261aef403b68dd9)) nhưng mô phỏng quá giờ.

Mock: facilitator tự chạy (DEMO), dùng khi facilitator công khai không chạy được.

## P8 — Agent demo và kịch bản S1–S6 (xong 2026-11-07, nhánh `feat/p8-agent`)

- `apps/agent/src`: `planner.ts` (DCA an toàn theo luật cố định; planner "bị chèn lệnh" DEMO đọc `fixtures/feed.json`, không dùng LLM), `guardian.ts` (gọi `/v1/check` và `/v1/cosign` qua `@x402/fetch`, trần 0,02 USDC mỗi lần), `vault.ts` (gửi `executeBatch`; batch sẽ bị từ chối vẫn được gửi để thấy revert trên explorer, lý do revert đọc trước bằng `eth_call`), `scenarios.ts` (S1–S6, so với bảng §10, ghi `apps/agent/data/attempts.jsonl`), `cli.ts`, `server.ts` (control API 127.0.0.1:4403, chỉ khi `DEMO_MODE=true`).
- `scripts/mine-lookalike.sh`: đào địa chỉ nhái MockRouter bằng `cast wallet vanity`, 3+3 ký tự (DEMO). Kết quả `0xE20b…d1d9` trong `apps/agent/fixtures/lookalike.json`, khoá bị bỏ, không bao giờ nạp tiền.
- Sửa Guardian: hạn verdict = max(thời gian block mới nhất, đồng hồ máy) + 60 s. Trước đó S1 trên fork bị `VerdictExpired` vì đồng hồ fork lệch với đồng hồ máy.

Lệnh: `pnpm agent scenario <S1..S6|all>`, `pnpm dev:agent`, `pnpm mine-lookalike`.

Test:

```
pnpm --filter @guardian402/agent test                → Tests 6 passed (planner, bảng mong đợi)
pnpm --filter @guardian402/guardian exec vitest run  → Tests 94 passed
pnpm typecheck                                       → xong, không lỗi
```

Fork (`NETWORK=local DEMO_MODE=true pnpm agent scenario all`, Guardian + facilitator tự chạy trỏ vào fork): cả 6 kịch bản khớp bảng §10.

| Kịch bản | Guardian | Vault |
| --- | --- | --- |
| S1 | THẤP 0/100 | thực hiện |
| S2 | CAO 100/100 · POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | `RecipientNotAllowed` |
| S3 | CAO 100/100 · POLICY_PRECHECK, UNLIMITED_APPROVAL, ADDRESS_POISONING | `RecipientNotAllowed` |
| S4 | CAO 60/100 · ABNORMAL_SLIPPAGE | `RiskTooHigh` |
| S5 | THẤP (verdict của S1) | `InvalidVerdict`, rồi `VerdictExpired` |
| S6 | CAO 60/100 · POLICY_PRECHECK | `Paused` |

Fuji thật (Guardian `NETWORK=fuji`, facilitator tự chạy trên Fuji):

- S1: phí x402 [0x6f89455b…6379](https://testnet.snowtrace.io/tx/0x6f89455b0bab097d256085877d7be649276b07356830aa692c0ef03d507b6379), vault thực hiện [0x44910d57…cdd0](https://testnet.snowtrace.io/tx/0x44910d57e3e684c35e7bad39b20f613ec433cb31775e8a52ddfa0bbfca09cdd0).
- S2: phí [0x0b3b9bbe…c90a](https://testnet.snowtrace.io/tx/0x0b3b9bbed9b85bd2fc679825fed1e050b442750e7e9531373037823f6b7fc90a), vault từ chối `RecipientNotAllowed` [0x4f5f7efa…315b](https://testnet.snowtrace.io/tx/0x4f5f7efa2ed37f093af3521895c7019abff4b90c23dc9b7e810e19dbde98315b).
- S4: phí [0x4ddbb816…b906](https://testnet.snowtrace.io/tx/0x4ddbb816b786a6b02a7d024ffcb66e13571ceb00197ab7b3e9345c056efdb906), vault từ chối `RiskTooHigh` [0x05c4d7ba…fcb7](https://testnet.snowtrace.io/tx/0x05c4d7baab719f31c036aacf112c550480cba96aa14214b170c8b7613997fcb7).

Mock (DEMO): planner bị chèn lệnh (kịch bản cố định), bản tin `feed.json`, địa chỉ nhái 3+3 ký tự, facilitator tự chạy.

## P9 — Dashboard (xong 2026-11-07, nhánh `feat/p9-dashboard`)

- `apps/dashboard`: Next.js 16 (App Router), wagmi 2 (chỉ connector injected: Core, MetaMask), TanStack Query, Tailwind 4. Giao diện tiếng Việt, chạy được ở bề ngang điện thoại, sáng và tối theo hệ điều hành. Không có backend riêng, không có khoá nào trong frontend.
- 6 trang: Tổng quan (số dư, hạn mức còn lại, chính sách, vai trò, trạng thái Guardian và kiểm tra khoá ký có khớp guardian của vault), Hoạt động (check gần đây + sự kiện `Executed`), Đã chặn (check CAO + lần thử agent bị vault từ chối), Doanh thu (`/v1/stats`), Kiểm tra giao dịch (`/v1/demo/check`, chọn S1–S4 hoặc dán JSON), Điều khiển (pause/unpause, thu hồi agent, đổi hạn mức USDC qua hộp xác nhận "hiện tại → sau giao dịch"; nút chạy kịch bản S1–S6 khi control API của agent chạy).
- Rủi ro hiển thị bằng màu, hình và chữ (THẤP / TRUNG BÌNH / CAO). Lời giải thích hiển thị dạng văn bản thuần. Mọi tx hash là link testnet.snowtrace.io (trên fork thì chỉ hiện chữ, kèm "(fork)").
- Banner DEMO MODE hiện khi Guardian báo `demoMode` hoặc control API của agent trả lời.
- RPC công khai của Fuji chỉ cho `eth_getLogs` tối đa 100 block, nên sự kiện `Executed` trên Fuji lấy từ API của Routescan (máy chủ phía sau testnet.snowtrace.io).
- Guardian: `GET /v1/checks` trả thêm `ruleIds`, `explanation`, `paymentTx`.

Lệnh: `pnpm dev:dashboard` (http://localhost:3000), `pnpm --filter @guardian402/dashboard build`.

Test:

```
pnpm --filter @guardian402/dashboard test   → Tests 6 passed (định dạng số, nhãn luật, preset hợp lệ, địa chỉ nhái khớp fixture)
pnpm --filter @guardian402/guardian exec vitest run → Tests 94 passed
pnpm --filter @guardian402/dashboard build  → build xong, 6 trang
Lighthouse 13.5.0, accessibility, trang Tổng quan → 100
```

Chạy thật với Guardian `NETWORK=fuji` và agent control API trên Fuji: cả 6 trang tải dữ liệu thật, không có lỗi console. Ở bề ngang 375 px, trang không cuộn ngang. Nút S1 trên trang Điều khiển chạy kịch bản thật trên Fuji: Guardian THẤP, phí x402 [0x967ded2c…ba07](https://testnet.snowtrace.io/tx/0x967ded2c6f53c3fac0c6660887d2df13980f1372fbd466105310b27e123eba07), vault thực hiện [0xf1ebe5ab…9030](https://testnet.snowtrace.io/tx/0xf1ebe5ab338d802e3af19954490a3f8e1061d667adea7ab9ee7c19ff93009030).

Chưa kiểm tra: thao tác của chủ ví (pause, thu hồi agent, đổi hạn mức) với một ví thật. Trình duyệt dùng để kiểm tra không có ví, nên chỉ thấy các nút bị khoá đúng khi chưa kết nối ví owner. Owner hiện tại là ví của OWNER_PK; ví `0x54A2…2888` phải `acceptOwnership` trước (checklist bên dưới).

## P10 — Bộ eval (xong 2026-11-07, nhánh `feat/p10-eval`)

- `eval/cases/*.json`: 40 case do nhóm tự viết (dữ liệu tổng hợp). 15 bình thường (swap nhiều cỡ, cấp quyền đúng mức, chuyển về treasury, thu hồi quyền), 25 độc hại (5 cấp quyền vô hạn hoặc quá mức, 5 địa chỉ nhái, 5 rút cạn, 5 trượt giá, 3 hợp đồng lạ, 2 lệnh revert).
- `eval/src`: `fork.ts` (reset fork, deploy vault và mock từ khoá eval cố định, seed theo §4.8), `cases.ts` (đọc và mã hoá case), `metrics.ts`, `report.ts`, `run.ts`. Pipeline chính là `Pipeline` của Guardian, giải thích bằng mẫu cố định, không thu phí.
- Eval tìm ra một lỗi thật trong ABNORMAL_SLIPPAGE (hai swap cùng router trong một batch che nhau). Đã sửa, có test hồi quy, số liệu trước/sau ghi trong báo cáo và SPEC §16. Không chỉnh ngưỡng nào.

Lệnh: `pnpm eval` (cần `pnpm fork` và `forge build`; eval reset fork, nên tắt Guardian đang dùng fork trước).

Kết quả (`eval/report.md`):

```
blocked = HIGH:   TP 24 FP 0 TN 15 FN 1 · precision 100,0% · recall 96,0% · FPR 0,0%
blocked ≥ MEDIUM: TP 24 FP 1 TN 14 FN 1 · precision 96,0%  · recall 96,0% · FPR 6,7%
latency p50 ~320 ms · p95 ~730 ms
fingerprint afe1c281479835c7 (3 lần chạy liên tiếp cho cùng giá trị)
```

Còn sót:

- m15 (âm tính giả): swap qua router hợp lệ nhưng gửi mWAVAX cho kẻ tấn công. Không luật nào và cả AgentVault đều không xét tham số `to` của swap.
- b11 (TRUNG BÌNH với case bình thường): thu hồi quyền của một hợp đồng lạ vẫn bị UNKNOWN_CONTRACT gắn cờ.

Test:

```
pnpm --filter @guardian402/eval test                       → Tests 5 passed (đủ cơ cấu case, mã hoá, địa chỉ nhái, chỉ số)
pnpm --filter @guardian402/guardian exec vitest run        → Tests 96 passed (thêm test hồi quy slippage và gắn chỉ số lệnh)
pnpm --filter @guardian402/guardian exec vitest run --config vitest.fork.config.ts test/simulator.fork.test.ts → Tests 13 passed
```

## P11 — Soát bảo mật, tài liệu, chạy thử từ repo sạch (xong 2026-11-07, nhánh `feat/p11-hardening`)

Soát bảo mật AgentVault, đóng vai kiểm toán viên bên ngoài (làm trong phiên này, không phải một phiên riêng như PROMPTS.md gợi ý). Chi tiết trong `docs/THREAT_MODEL.md`, phần "Findings of the P11 review".

| Mã | Mức | Vấn đề | Xử lý |
| --- | --- | --- | --- |
| F1 | Trung bình | Quyền approve cấp qua đường agent còn sót sau batch. Agent dùng phần còn sót để swap ở mức ≤ ngưỡng verdict mà không cần verdict, và đầu ra swap (`to`) có thể gửi đi bất cứ đâu, tới hạn mức ngày, mỗi ngày. Guardian cũng không xét `to` (eval m15 bị sót). | Đã sửa: vault thu hồi mọi quyền batch đã cấp ở cuối batch; RECIPIENT_NOT_ALLOWLISTED gắn cờ đầu ra swap không về vault. Test `test_Audit_F1_*` (fail trước khi sửa), test luật, eval m15. |
| F2 | Thấp | Hạn mức ngày tính theo ngày UTC: quanh 00:00 UTC có thể chi gấp đôi hạn mức trong vài phút. | Chấp nhận; test `test_Audit_F2_*` ghi lại hành vi. |
| F3 | Thông tin | Verdict gửi kèm batch không cần verdict vẫn dùng hết nonce. Chỉ agent gọi được `executeBatch`. | Chấp nhận (SPEC §16). |
| F4 | Thông tin | Owner có thể cho phép một token không theo dõi làm target thường, khi đó chuyển token đó không có hạn mức. | Chấp nhận: do owner cấu hình. |

Tài liệu mới: `README.md` (tiếng Anh + tóm tắt tiếng Việt, sơ đồ mermaid, quickstart, địa chỉ Fuji, danh sách mock, bảng "luật cuộc thi → nơi áp dụng → test chứng minh", ghi chú pháp lý Việt Nam), `docs/THREAT_MODEL.md`, `docs/DEMO_RUNBOOK.md`.

Chạy thử từ repo sạch (clone vào thư mục tạm, làm đúng theo README):

```
clone --recurse-submodules: 13 s · pnpm install: 36 s · forge build + forge test: 21 s (146 passed) · pnpm test: 6 s (147 passed)
pnpm eval: 32 s, cùng dấu vân tay bda43f738452d6ea với máy chính
Phần B (5 khoá dùng một lần, chỉ trên fork): deploy:local + seed:local 9 s, mine-lookalike 2 s, `pnpm agent scenario all`: 6/6 khớp bảng §10 (86 s)
```

Lỗi tìm thấy khi chạy thử và đã sửa trong `scripts/contracts.mjs`: (1) `deploy:local` hỏng vì thư mục `contracts/deployments/` không có trong repo sạch; (2) facilitator tự chạy không có AVAX trên fork nên mọi lần thu phí thất bại (Guardian trả 402, không ai bị trừ tiền); (3) agent không có USDC trên fork để trả phí. Ngoài ra dashboard đọc địa chỉ nhái từ fixture thay vì chép cứng.

Test:

```
cd contracts && forge test                          → 146 passed (thêm 5 test audit)
forge coverage (src/AgentVault.sol)                 → 100% dòng, câu lệnh, nhánh, hàm
pnpm -r test                                        → shared 33, agent 6, dashboard 6, guardian 97, eval 5 — tất cả pass
pnpm eval (3 lần)                                   → TP 25 FP 0 TN 15 FN 0, cùng dấu vân tay bda43f738452d6ea
```

### Việc còn lại (đã biết)

Cập nhật 2026-11-09 sau P14.

1. Chưa kiểm tra thao tác của chủ ví trên dashboard (pause, thu hồi agent, đổi hạn mức) bằng một ví thật.
2. Mục "A teammate has done the fresh-clone test" trong SPEC §14 cần một thành viên trong nhóm tự làm.
3. Chưa bật LLM thật cho phần giải thích (`LLM_PROVIDER=none`); hiện dùng mẫu cố định.
4. Ví `0x54A2…2888` cần `acceptOwnership` trên vault mới (xem checklist bên dưới).
5. Nạp thêm USDC cho vault trước demo (còn khoảng 32 USDC).
6. Fork mô phỏng có thể chậm hơn Fuji vài phút, nên số dư trong lời giải thích có thể lệch vài giao dịch gần nhất.

## P12 — Deploy lại vault có bản sửa F1, sửa b11, license (xong 2026-11-08, nhánh `feat/p12-finish`)

- Lệnh mới `pnpm redeploy-vault:fuji` (`contracts/script/RedeployVault.s.sol`): nếu OWNER_PK còn là owner của vault cũ thì rút hết USDC/AVAX về owner và tạm dừng vault cũ, rồi deploy AgentVault mới (giữ nguyên mock) và verify ngay. Địa chỉ mới được gộp vào `packages/shared/src/addresses/fuji.json` (thêm `previousVault`, `startBlock` mới).
- `Seed.s.sol`: nếu owner không đủ USDC thì nạp phần đang có (trước đây bỏ qua hẳn).
- Fuji:
  - Vault cũ `0x32cb…Ab99`: rút 46 USDC [0xe513b1bd…a336](https://testnet.snowtrace.io/tx/0xe513b1bd226971a6b42f15df9020f9c26ceaef0878c68aba51d5a2320ffca336), pause [0x9f3cad3f…4dd5](https://testnet.snowtrace.io/tx/0x9f3cad3fe9bf6f64e306058e59fbd33eaeb110b3b4608ef1f75343031cd64dd5).
  - Vault mới [0x3f6a5852788ff6a46d924C407976bB89487f7651](https://testnet.snowtrace.io/address/0x3f6a5852788ff6a46d924C407976bB89487f7651): deploy [0x47cca265…4414](https://testnet.snowtrace.io/tx/0x47cca26546583d555096da7ed2ba1d2683f91cc21813f5b9490e1176a6664414), Routescan `Pass - Verified`.
  - Seed: 12 giao dịch, tất cả status 1; vault có 46 USDC (owner chỉ có 46, cần 50: nạp thêm 4 USDC từ faucet nếu muốn đủ). Handoff [0xed5a391b…b28e](https://testnet.snowtrace.io/tx/0xed5a391be502ad3f2d042885e5871bea507ac1fa3a0d1784a001a27bc5c4b28e) → `pendingOwner = 0x54A2…2888`.
- Kịch bản trên Fuji với vault mới (Guardian `NETWORK=fuji`, facilitator tự chạy):
  - S1: lần đầu `SIMULATION_FAILED` (fork lạnh, quá 800 ms, đúng như runbook dặn chạy khởi động); lần hai rủi ro THẤP, phí [0xe21ebd45…ba95](https://testnet.snowtrace.io/tx/0xe21ebd45e773418f9e2dbfbc45f9060f2d4b9922795d0658098a916999eeba95), vault [0xa046887e…b0](https://testnet.snowtrace.io/tx/0xa046887ef2b6ddc4af133bb33fbd0f849721dcda6c13b49ea9ffb4e3236918b0). Sau đó `allowance(vault, router) = 0`: bản sửa F1 chạy đúng trên Fuji.
  - S2: CAO 100/100, phí [0xdca222ed…8927](https://testnet.snowtrace.io/tx/0xdca222edb902d3215dba0f0c202aa2cad2ade981558dfa260b7ebbbf4db78927), vault revert `RecipientNotAllowed` [0x32e5db9c…cfa](https://testnet.snowtrace.io/tx/0x32e5db9c8713220fec298b21ca56527db38ea33ffb1be6c51914f648fc123cfa).
  - S4: CAO 60/100 (ABNORMAL_SLIPPAGE), phí [0x063d0c65…421d](https://testnet.snowtrace.io/tx/0x063d0c651f88c26294d07868a6fa7c8a8518bc605ee75c4d32315333ba27421d), vault revert `RiskTooHigh` [0x78e1a302…e9b](https://testnet.snowtrace.io/tx/0x78e1a302154ba01a96e34b9a87504695ec7e4d8bb55ca7bab47e65cfc8fc4e9b).
- UNKNOWN_CONTRACT bỏ qua spender của lệnh thu hồi quyền (approve 0); thêm test trong `rules.test.ts`. Eval: b11 từ TRUNG BÌNH xuống THẤP.
- License MIT (`LICENSE`), khớp header SPDX của Solidity.

Test:

```
pnpm --filter @guardian402/guardian test  → 98 passed
pnpm eval (2 lần)                         → chặn = CAO: TP 25 FP 0 TN 15 FN 0; chặn ≥ TRUNG BÌNH: TP 25 FP 0 TN 15 FN 0
                                            cùng dấu vân tay e33a546d912896a1
```

## B1 — Danh tính ERC-8004 (xong 2026-11-09, nhánh `feat/b1-erc8004`)

- Registry chính thức trên Fuji (README của `erc-8004/erc-8004-contracts`, mục "Avalanche Testnet"): IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`, có code (proxy), `name()` = "AgentIdentity". ABI chép từ `abis/IdentityRegistry.json` của repo chính thức, commit `b9e466c2`, vào `packages/shared/src/erc8004/identityRegistryAbi.ts`.
- `packages/shared/src/erc8004/registration.ts`: schema zod của file `registration-v1` (theo `ERC8004SPEC.md`), hàm tạo file của Guardian, mã hoá/giải mã data URI. Test `packages/shared/test/erc8004.test.ts` (6 test): đủ trường bắt buộc, `agentRegistry` = `eip155:43113:<IdentityRegistry>`, đọc lại được từ data URI, từ chối file thiếu trường, và file đã lưu khớp agentId.
- Lệnh `pnpm erc8004:fuji` (`scripts/erc8004.ts`): `register()` bằng ví deployer, rồi `setAgentURI(agentId, data:application/json;base64,…)`. Chạy lại không gửi giao dịch nếu không có gì đổi.
- Kết quả trên Fuji: **agentId 295**, chủ sở hữu `0x6428…fB50` (deployer). Đăng ký [0x6d22083e…](https://testnet.snowtrace.io/tx/0x6d22083e006da209338f289b5389f1486902233f859bcfe00b179512b8658001), agentURI [0xf6f78bcf…](https://testnet.snowtrace.io/tx/0xf6f78bcf70ab3d62eb2eaa04d5f202e042cd5c83d1736a93cb1c029bda2471e1). `cast call … "tokenURI(uint256)(string)" 295` giải mã ra đúng file; lần chạy thứ hai in "agentURI already up to date".
- Dashboard: thẻ "Danh tính ERC-8004" ở trang Tổng quan (agentId, registry, chủ sở hữu, dịch vụ, link giao dịch).
- Chưa làm: luồng ValidationRegistry cho verdict CAO (tuỳ chọn trong SPEC §13.1). Endpoint công bố đang là link GitHub vì Guardian chưa có địa chỉ công khai; repo đang private nên người ngoài chưa mở được link này.

## P13 — Vá lỗ hổng sau soát lần hai (xong 2026-11-09, nhánh `fix/p13-hardening`)

- F5 (thấp): API điều khiển agent (cổng 4403) chạy kịch bản với bất kỳ POST nào; một trang web lạ đang mở trên máy có thể bấm hộ. Sửa: Host phải là máy này; POST phải có Origin của dashboard và header `X-Guardian402-Demo` (buộc CORS preflight, chỉ dashboard qua được). Code tách ra `apps/agent/src/control.ts`; dashboard gửi header này.
- F6 (thấp): mọi lượt kiểm tra xếp hàng chung một fork; gửi dồn dập làm người khác bị timeout. Sửa: quá `MAX_QUEUED_CHECKS` (8) lượt đang chờ thì trả 503 + `Retry-After`, trước bước thu phí nên không ai bị trừ tiền.
- F7 (thông tin): lỗi 502 trả nguyên thông báo nội bộ; Guardian nhận mọi Host. Sửa: 502 không kèm chi tiết (chỉ ghi log); Host phải nằm trong `ALLOWED_HOSTS` (mặc định: máy này trên `GUARDIAN_PORT`).
- Kiểm tra trên dịch vụ đang chạy: Host giả (`evil.example`) → 403 ở cả 4402 và 4403; POST từ Origin lạ → 403; POST từ Origin dashboard nhưng thiếu header → 403; bấm S1 trên dashboard → rủi ro THẤP, khớp bảng kịch bản.

Test:

```
pnpm -r test → shared 39, agent 13 (+7 control.test.ts), dashboard 6, guardian 103 (+5 hardening.test.ts), eval 5
```

Còn lại (vận hành, không sửa bằng code): mọi khoá nằm dạng chữ thường trong `.env.local`; ví deployer giữ 4 vai trên Fuji.

## P14 — Tối ưu độ tin cậy, tốc độ, thư viện và MCP server (xong 2026-11-09, nhánh `feat/p14-polish`)

- **Lỗi CAO oan khi fork lạnh.** Đồng hồ 800 ms trước đây tính từ lúc yêu cầu tới, kể cả lúc chờ fork (bảo trì 15 giây/lần gọi Fuji trong khoá, khởi động sau mỗi lần reset). Log cũ: mọi lần khởi động fork sau reset đều timeout (802–815 ms, `ok:false`). Sửa (`apps/guardian/src/sim/budget.ts`): 800 ms tính từ lúc lượt chạy giữ fork; một lần thử lại sau timeout; tối đa 10 giây cho cả chờ lẫn chạy; bảo trì gọi Fuji ngoài khoá. Sau sửa: khởi động lại Guardian rồi chạy S1 ngay → THẤP từ lần đầu; khởi động fork thành công (4,4 s và 5,9 s).
- **RPC dự phòng** (`packages/shared/src/rpc.ts`): đọc trạng thái mới nhất (Guardian, agent, facilitator, dashboard) tự chuyển sang endpoint công cộng khác khi lỗi. Đo 20 yêu cầu dồn: PublicNode trung vị 174 ms, RPC chính thức 355 ms. Không dùng PublicNode cho fork: nó không giữ trạng thái cũ (`test:fork` báo "missing trie node").
- `pnpm bench:guardian`: RPC chính thức p50 733 ms / p95 1176 ms → Guardian đọc qua PublicNode p50 253 ms / p95 727 ms (15/15 THẤP). `simulate()` trên fork p50 77 ms (P4: 292 ms). Eval p50 119 ms, cùng dấu vân tay `e33a546d912896a1`.
- **Thư viện:** `pnpm audit --prod` từ 8 cảnh báo (4 cao) xuống 1 (zod 3 nằm trong `@x402/core` 2.28.0, bị giới hạn bởi header 16 KB). zod 4.6.7 cho mã của nhóm; bỏ các SDK ví thừa của wagmi (dashboard chỉ dùng ví trình duyệt); `ws` 8.21.3. Lockfile bớt khoảng 4.300 dòng. Dashboard build được.
- **Bonus B2, MCP server** (`apps/guardian-mcp`): `check_transaction` (0,005 USDC) và `cosign_transaction` (0,01 USDC) qua `@x402/mcp` 2.28.0, chạy pipeline ngay trong tiến trình. Lõi Guardian tách thành `apps/guardian/src/core.ts` dùng chung cho API và MCP. `FORK_PORT` cho fork thứ hai. Client mẫu trên Fuji: được hỏi 0,005 USDC, trả, nhận THẤP; thanh toán [0x64a5e6bb…](https://testnet.snowtrace.io/tx/0x64a5e6bb319f77d9a55b31cb29ed8554323a6c031852bfc7766a1783ef9f68cf) (status 1).
- **Lỗi có từ P12:** `local.json` vẫn trỏ vault cũ nên `test:fork` tự deploy bộ hợp đồng khác, router mới bị UNKNOWN_CONTRACT → 3 test fail. Sửa: `local.json` theo Fuji, tạo lại known-contracts; `redeploy-vault` từ nay tự cập nhật `local.json`.
- Kịch bản trên Fuji với code P14 (chạy ngay sau khi khởi động Guardian):
  - S1 THẤP: phí [0x643a46ff…](https://testnet.snowtrace.io/tx/0x643a46ffd11aec599ca2a98bc4e589d891e7943acbb0f5fba048dfc9b9f0c38e), vault [0xe139c1f6…](https://testnet.snowtrace.io/tx/0xe139c1f6e6082d8aa6a661200bd873adc5e7cb40de179d9a5fb646aa531a093d).
  - S2 CAO 100/100: phí [0xf097b317…](https://testnet.snowtrace.io/tx/0xf097b317ea7295801d326cebfb1497c525a3bef2c8fe64c684790ebd3c56f916), vault revert `RecipientNotAllowed` [0x90fffa1b…](https://testnet.snowtrace.io/tx/0x90fffa1b5c8d5b37e7f54b90867a3b154de346629f90fb27030f3b717700e4d4).
  - S4 CAO 60/100: phí [0x345c2a59…](https://testnet.snowtrace.io/tx/0x345c2a5961389cc4f802ecb8a44ccbb55071eff8e8d2e65f348231cc93743432), vault revert `RiskTooHigh` [0x398c7fd0…](https://testnet.snowtrace.io/tx/0x398c7fd03c7cd066f21ba47eb0236adb36fe410b0e6dba9cf031208e5c30337b).

Test:

```
forge test                                  → 146 passed
pnpm -r test                                → shared 41, agent 13, dashboard 6, guardian 108, guardian-mcp 6, eval 5
pnpm --filter @guardian402/guardian test:fork → 18 passed
pnpm eval                                   → TP 25 FP 0 TN 15 FN 0 (cả hai ngưỡng), dấu vân tay e33a546d912896a1
```

Ví sau P14: vault khoảng 32 USDC (mỗi S1 tốn 2 USDC), agent khoảng 9,8 USDC. Nạp thêm USDC cho owner từ faucet Circle rồi `pnpm seed:fuji` nếu muốn vault đủ 50.

## Checklist trước demo

- [ ] **Owner accepts ownership from 0x54A2…2888 before the demo** (chỉ làm sau khi P8 xong). Ví `0x54A2276F134d3Cfaa7572BC326092fABa6352888` đã là `pendingOwner` của AgentVault mới `0x3f6a5852788ff6a46d924C407976bB89487f7651` (tx [0xed5a391b…b28e](https://testnet.snowtrace.io/tx/0xed5a391be502ad3f2d042885e5871bea507ac1fa3a0d1784a001a27bc5c4b28e)). Vault cũ `0x32cb…Ab99` đã rút hết tiền và tạm dừng, không cần accept nữa. Các bước:
  1. Trong Core hoặc MetaMask, chọn ví `0x54A2…2888` và mạng Avalanche Fuji C-Chain (chain id 43113). Ví cần một ít AVAX testnet để trả gas.
  2. Mở https://testnet.snowtrace.io/address/0x3f6a5852788ff6a46d924C407976bB89487f7651 (AgentVault, đã verify), chọn tab **Contract** rồi **Write Contract**.
  3. Bấm **Connect to Web3** và kết nối ví `0x54A2…2888`.
  4. Mở hàm **acceptOwnership** (không có tham số) → **Write** → xác nhận giao dịch trong ví.
  5. Kiểm tra trong tab **Read Contract**: `owner()` = `0x54A2276F134d3Cfaa7572BC326092fABa6352888` và `pendingOwner()` = `0x0000000000000000000000000000000000000000`. Hoặc chạy:
     `cast call 0x3f6a5852788ff6a46d924C407976bB89487f7651 "owner()(address)" --rpc-url https://api.avax-test.network/ext/bc/C/rpc`
  6. Sau bước này OWNER_PK không còn quyền owner: pause/unpause, đổi cap, revoke agent làm từ ví `0x54A2…2888` (dashboard, trang Điều khiển).
