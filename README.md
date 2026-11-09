# Guardian402

Tường lửa giao dịch cho ví của AI agent trên Avalanche Fuji. Dự án dự thi Team1 Vietnam UniHack 2026.
Chỉ chạy trên testnet: không có token, không dùng tiền thật, không giữ tiền của người dùng.

## Giới thiệu

Tiền của AI agent nằm trong **AgentVault**, một hợp đồng do chủ ví kiểm soát. Trước khi agent gửi giao dịch,
**Guardian**:

1. mô phỏng giao dịch trên bản fork của Fuji,
2. chấm rủi ro bằng 8 luật cố định,
3. giải thích kết quả bằng tiếng Việt và tiếng Anh (LLM chỉ viết lời giải thích, không quyết định rủi ro),
4. ký một verdict EIP-712 gắn với đúng giao dịch đó.

Vault chỉ chạy giao dịch khi qua được luật on-chain (danh sách cho phép, hạn mức ngày, nút tạm dừng) và, khi cần,
có verdict rủi ro thấp. Mỗi lần kiểm tra trả phí bằng USDC qua **x402**.

## Cài đặt

Cần Node ≥ 22.13, pnpm 10 (`corepack enable pnpm`), Foundry 1.8.5 (`foundryup`) và Git. Trên Windows nên dùng
WSL2, hoặc bật Docker Desktop nếu `anvil.exe` bị chặn.

```bash
git clone --recurse-submodules https://github.com/surinatheworld/guardian402
cd guardian402
pnpm install
cd contracts && forge build && forge test && cd ..
pnpm test
```

## Chạy demo

1. Tạo 5 ví thử bằng `cast wallet new` (chỉ dùng cho testnet).
2. `cp .env.example .env.local`, điền `DEPLOYER_PK`, `OWNER_PK`, `AGENT_PK`, `GUARDIAN_SIGNER_PK`,
   `FACILITATOR_PK`, đặt `PAY_TO` là địa chỉ ví deployer, giữ `NETWORK=local`.
3. Mỗi lệnh dưới đây chạy trong một terminal riêng:

```bash
pnpm fork
```

```bash
pnpm deploy:local && pnpm seed:local && pnpm known-contracts && pnpm mine-lookalike local
```

```bash
FACILITATOR_RPC_URL=http://127.0.0.1:8545 pnpm facilitator
```

```bash
FACILITATOR_URL=http://127.0.0.1:4022 DEMO_MODE=true pnpm dev:guardian
```

```bash
DEMO_MODE=true pnpm agent scenario all
```

Dashboard: thêm `NEXT_PUBLIC_NETWORK=local` vào `apps/dashboard/.env.local`, chạy `DEMO_MODE=true pnpm dev:agent`
và `pnpm dev:dashboard`, rồi mở http://localhost:3000.

Kịch bản demo 3 phút trên Fuji: [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md).

## Hợp đồng trên Fuji

Avalanche Fuji C-Chain (chain id 43113), đã verify trên [testnet.snowtrace.io](https://testnet.snowtrace.io).

| Hợp đồng          | Địa chỉ                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| AgentVault        | [`0x3f6a5852788ff6a46d924C407976bB89487f7651`](https://testnet.snowtrace.io/address/0x3f6a5852788ff6a46d924C407976bB89487f7651) |
| MockRouter (DEMO) | [`0xe20967C615e442991D468ed7f797edcAeA1771d9`](https://testnet.snowtrace.io/address/0xe20967C615e442991D468ed7f797edcAeA1771d9) |
| MockOracle (DEMO) | [`0xeebAac693aA19308bA859b3D668e3794310e66AE`](https://testnet.snowtrace.io/address/0xeebAac693aA19308bA859b3D668e3794310e66AE) |
| mWAVAX (DEMO)     | [`0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5`](https://testnet.snowtrace.io/address/0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5) |
| USDC (Circle)     | [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65) |

Guardian đăng ký danh tính ERC-8004 là agent **#295** trên IdentityRegistry
[`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.snowtrace.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e).

## Phần giả lập (DEMO MODE)

Được khai báo khi bắt đầu thuyết trình và hiện banner DEMO MODE trên dashboard:

- **MockOracle** (giá cố định 25 USDC/mWAVAX), **MockRouter** với hai pool giả (pool 1 lệch giá 30%) và token giả
  **mWAVAX**.
- **Tấn công theo kịch bản**: agent "bị prompt injection" đọc từ `apps/agent/fixtures/feed.json`, không dùng LLM, để
  demo lặp lại được.
- **Địa chỉ nhái** giống 3+3 ký tự của router; ở DEMO MODE luật nhận diện dùng ngưỡng 3/3 (bình thường 4/4).
- **Facilitator x402 tự host**, dùng khi facilitator công khai không hoạt động.
- **`/v1/demo/check`**: endpoint kiểm tra miễn phí cho dashboard, chỉ bật khi `DEMO_MODE=true`.

## Giấy phép

[MIT](LICENSE)
