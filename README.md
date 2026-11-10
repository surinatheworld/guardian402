# Guardian402 — Transaction Firewall for AI Agents

> **"Guardian402 is an on-chain transaction firewall for autonomous AI agents. It helps owners control how agents use their funds through enforceable spending policies, transaction simulation, and cryptographically signed risk verdicts."**
>
> *(Tiếng Việt: Guardian402 là tường lửa giao dịch giúp chủ sở hữu kiểm soát cách AI Agent sử dụng tài sản on-chain, bằng chính sách được cưỡng chế qua smart contract và cơ chế đánh giá rủi ro trước khi thực thi.)*

---

## 1. Vấn đề Guardian402 giải quyết

Giả sử một tổ chức hoặc cá nhân cấp cho AI Agent **500 USDC** để tự động thanh toán dịch vụ, chi trả đối tác hoặc thực hiện token swap.

Nếu Agent:
- Hiểu sai mệnh lệnh hoặc bị **prompt injection** dẫn đến giao dịch độc hại.
- Chuyển nhầm tiền đến địa chỉ lừa đảo hoặc địa chỉ nhái (vanity lookalike).
- Tương tác với router/contract chưa được kiểm chứng.
- Cấp quyền `approve` token không giới hạn (`type(uint256).max`).
- Cố tình chi tiêu vượt hạn mức do Owner thiết lập.

**Ai sẽ ngăn chặn nó?**

Guardian402 đặt một lớp kiểm soát bảo mật chặt chẽ giữa quyết định của Agent và quyền sử dụng tài sản trong Vault.

> [!IMPORTANT]
> **Guardian402 không phải là một AI Agent.** Đây là **hạ tầng bảo mật** (Security Middleware & On-chain Policy Enforcement) phục vụ AI Agent.
> 
> **Luận điểm cốt lõi**: *"An AI agent may be authorized to act, but it should never have unrestricted authority over the owner's funds."* (Một AI Agent có thể được cấp quyền hành động, nhưng không bao giờ được nắm toàn quyền không giới hạn trên tài sản của chủ sở hữu).

```mermaid
flowchart LR
    Owner["👤 Owner\n(Sở hữu & Đặt chính sách)"] -->|Deploy & Cấu hình| Vault["🛡️ AgentVault\n(Cưỡng chế on-chain)"]
    Agent["🤖 AI Agent\n(Tự động thực hiện tác vụ)"] -->|1. Đề xuất Intent| Guardian["🔍 Guardian API\n(Simulate & 8-Rule Engine)"]
    Guardian -->|2. EIP-712 Verdict (LOW)| Agent
    Agent -->|3. executeBatch(calls, verdict)| Vault
    Vault -->|4. Hard Policy Gate| Gate{Đủ điều kiện?}
    Gate -->|Hợp lệ| Exec["✅ Thực thi on-chain\n(Cập nhật số dư)"]
    Gate -->|Vi phạm| Rej["❌ Revert giao dịch\n(Bảo toàn tài sản)"]
```

---

## 2. Ba Use Case Trọng Tâm (UniHack 2026)

| Use Case | Mục tiêu nghiệp vụ | Kịch bản Demo | Kết quả On-chain |
| :--- | :--- | :--- | :--- |
| **1. Agent Payments** *(Primary)* | Agent được cấp ngân sách tự động thanh toán USDC cho các bên được phê duyệt trong hạn mức. | **S0** (chuyển 1.5 USDC cho Treasury)<br>**S2** (chuyển 50 USDC cho ví lạ) | **S0**: Thành công, Vault -1.5 USDC, Treasury +1.5 USDC.<br>**S2**: Revert `RecipientNotAllowed`. |
| **2. DeFi Transaction Guard** | Agent swap token qua DEX Router. Guardian kiểm tra kết quả mô phỏng, trượt giá và điều kiện approve. | **S1** (swap bình thường)<br>**S4** (swap qua pool lệch giá 30%) | **S1**: Thành công, swap 2 USDC sang mWAVAX.<br>**S4**: Revert `RiskTooHigh`. |
| **3. Compromised Agent Containment** | Agent bị lộ private key, prompt injection hoặc cố vượt quyền. Vault chặn đứng mọi vi phạm. | **S2** (drain)<br>**S3** (nhái router)<br>**S5** (replay)<br>**S6** (kill-switch) | **S2, S3**: Revert `RecipientNotAllowed`.<br>**S5**: Revert `InvalidVerdict` / `VerdictExpired`.<br>**S6**: Revert `Paused`. |

---

## 3. Kiến Trúc Hai Lớp Bảo Vệ & Giới Hạn Cưỡng Chế

### Lớp 1 — On-chain Policy Enforcement (`AgentVault.sol`)
Lớp phòng thủ cốt lõi được bảo chứng trực tiếp bằng EVM execution:
- **Authorized Agent**: Chỉ đúng địa chỉ Agent được cấp quyền mới được gọi `executeBatch`.
- **Recipient Allowlist**: Từ chối tuyệt đối mọi địa chỉ nhận tiền ngoài danh sách Owner đã duyệt.
- **Daily Spending Cap**: Hạn mức chi tiêu mỗi ngày cho từng token, tự động reset tại 00:00 UTC.
- **Emergency Pause (Kill-Switch)**: Owner có thể ngắt toàn bộ quyền của Agent ngay lập tức.
- **Verdict Enforcement**: Giao dịch vượt ngưỡng (`> 1.0 USDC`) hoặc có tính chất nhạy cảm bắt buộc phải kèm theo chữ ký verdict hợp lệ của Guardian.
- **Nonce & Deadline**: Chống phát lại (replay attack) bằng `verdictNonce` tuần tự và `deadline` hết hạn theo timestamp block.

### Lớp 2 — Dynamic Transaction Risk Assessment (Guardian API)
Đánh giá rủi ro trước thực thi thông qua mô phỏng trên Anvil Fork và 8 luật an ninh xác định:
- **Swap Risk**: Độ trượt giá và chênh lệch giá so với Oracle tham chiếu (`ABNORMAL_SLIPPAGE`).
- **Address Risk**: Phát hiện địa chỉ nhái (vanity lookalike address) lừa agent (`ADDRESS_POISONING`).
- **Approval Risk**: Phát hiện cấp quyền chi tiêu vô hạn hoặc cho bên không xác thực (`UNLIMITED_APPROVAL`).
- **Outflow Risk**: Phát hiện rút cạn số lượng lớn tài sản bất thường (`DRAIN_PATTERN`).

> [!NOTE]
> **Ranh giới công bố chính xác**: Không nói *"Mọi giao dịch của AI Agent đều được Guardian mô phỏng và phê duyệt"*. Tuyên bố chuẩn xác là:
> *"Guardian402 enforces on-chain spending policies and requires risk-based authorization for transactions that meet its configured conditions."*

---

## 4. Bảng Phân Định Ranh Giới (Threat Model & Out-of-Scope)

| Ngoài phạm vi bảo vệ | Lý do kỹ thuật / Ranh giới thiết kế |
| :--- | :--- |
| **Mọi hợp đồng Web3 tùy ý** | V1 kiểm soát các loại giao dịch được hỗ trợ (ERC-20 transfer, router swap đã biết). Chưa chứng minh phân tích arbitrary calldata tổng quát. |
| **Tổn thất do thị trường** | Giao dịch swap hợp lệ và trượt giá trong ngưỡng cho phép vẫn có thể biến động giá trị theo thị trường. |
| **Lộ Private Key của Owner** | Kẻ tấn công có quyền Owner có thể cập nhật chính sách theo thiết kế phân quyền smart contract. |
| **Mọi biến thể Prompt Injection** | Demo chứng minh việc chặn hành vi giao dịch độc hại sau khi bị inject; không bảo đảm giải quyết mọi cuộc tấn công ở tầng prompt LLM. |
| **Lỗ hổng zero-day ngoài rule engine** | Mô phỏng và 8 luật kiểm tra các mẫu tấn công đã biết; không bảo đảm phát hiện 100% logic bug của contract bên thứ ba. |
| **Giao dịch ngoài AgentVault** | Guardian402 chỉ bảo vệ tài sản nằm bên trong hợp đồng `AgentVault`, không bảo vệ các ví EOA độc lập khác của Owner. |
| **Chênh lệch TOC/TOU (Time-of-Check / Time-of-Use)** | Trạng thái mempool, block và giá có thể dao động giữa lúc simulation và lúc mined vào block. Cần kết hợp slippage cứng on-chain. |
| **Lộ Agent Key cho giao dịch dưới ngưỡng** | Giao dịch nhỏ (`<= 1.0 USDC`) đến đúng địa chỉ cho phép trong hạn mức ngày có thể được thực thi mà không cần gọi Guardian. |

---

## 5. Ba Màn Trải Nghiệm Cho Ban Giám Khảo (Dashboard)

Giao diện Dashboard tại `http://localhost:3000` được thiết kế tập trung vào 3 màn hình cốt lõi:

1. **Vault Overview (`/`)**: Ai kiểm soát tiền?
   - Hiển thị Owner, Agent được ủy quyền, số dư USDC/mWAVAX, hạn mức ngày còn lại và trạng thái Pause khẩn cấp.
2. **Transaction Inspector (`/kiem-tra`)**: Guardian làm gì?
   - Xem chi tiết Intent, luồng thanh toán micropayment x402, kết quả mô phỏng Fork, vi phạm từ 8 luật và chữ ký EIP-712.
3. **Execution Evidence (`/hoat-dong`)**: Xác minh điều đã xảy ra.
   - Transaction hash, block receipt, on-chain event logs (`Executed`), biến động số dư thực tế và link tra cứu Snowtrace.

*Khám phá không cần ví*: Nút **Explore Live Demo** cho phép BGK bấm thử ngay toàn bộ kịch bản mà không cần cài ví hay nạp gas trước.

---

## 6. Tiêu Chí Nghiệm Thu (Acceptance Gate V1 — 8/8)

- [x] **1. On-chain enforcement**: Vault từ chối đúng giao dịch vi phạm policy (S2, S3, S5, S6) kể cả khi Agent cố tình bypass Guardian.
- [x] **2. Safe transfer**: S0 chuyển 1.5 USDC thành công trên Fuji/Fork, có receipt và biến động số dư on-chain (+1.5 Treasury, -1.5 Vault).
- [x] **3. Dynamic risk**: S4 chứng minh risk engine phát hiện trượt giá 30% và Vault từ chối vì `RiskTooHigh`.
- [x] **4. x402 payment**: Thanh toán micropayment thật qua Facilitator, có bằng chứng settlement transaction on-chain.
- [x] **5. Owner permissions**: Ví thường/Agent không thể thay đổi policy của Vault (146 tests Foundry xác nhận).
- [x] **6. Explorer evidence**: BGK kiểm chứng độc lập mọi transaction hash trên Snowtrace/Routescan/Local Explorer.
- [x] **7. Demo usability**: Không cần ví vẫn trải nghiệm được sản phẩm qua Explore Demo; không có nút bấm giả lập.
- [x] **8. Honest disclosure**: Minh bạch các thành phần demo, mock DEX/Oracle và giới hạn kỹ thuật của phiên bản V1.

---

## 7. Cài Đặt & Chạy Thử

### Yêu cầu hệ thống
- Node.js ≥ 22.13, pnpm 10 (`corepack enable pnpm`)
- Foundry 1.8.5 (`foundryup`)
- Git

```bash
git clone --recurse-submodules https://github.com/surinatheworld/guardian402
cd guardian402
pnpm install
cd contracts && forge test && cd ..
pnpm test
```

### Chạy trọn gói trong 1 lệnh duy nhất (Khuyên dùng)

```bash
./run-local.sh
# hoặc: pnpm local
```

Script sẽ tự động:
- Kiểm tra prerequisites và khởi tạo `.env.local`
- Khởi động Anvil Fork Avalanche Fuji (8545), deploy và seed hợp đồng tự động
- Khởi chạy x402 Facilitator (4022), Guardian API (4402), Agent API (4403) và Dashboard (3000)
- Tự động dọn dẹp các tiến trình khi bấm `Ctrl+C`

### Chạy kiểm thử kịch bản (S0–S6):

```bash
# Chạy kịch bản S0 (Safe 1.5 USDC Transfer)
./run-local.sh scenario S0

# Chạy toàn bộ kịch bản bảo mật hồi quy (S0 đến S6)
./run-local.sh scenario all
```

---

## 8. Hợp Đồng Triển Khai Trên Avalanche Fuji Testnet

Avalanche Fuji C-Chain (`chainId: 43113`), đã verify trên [testnet.snowtrace.io](https://testnet.snowtrace.io):

| Hợp đồng | Địa chỉ |
| :--- | :--- |
| **AgentVault** | [`0x3f6a5852788ff6a46d924C407976bB89487f7651`](https://testnet.snowtrace.io/address/0x3f6a5852788ff6a46d924C407976bB89487f7651) |
| **MockRouter (DEMO)** | [`0xe20967C615e442991D468ed7f797edcAeA1771d9`](https://testnet.snowtrace.io/address/0xe20967C615e442991D468ed7f797edcAeA1771d9) |
| **MockOracle (DEMO)** | [`0xeebAac693aA19308bA859b3D668e3794310e66AE`](https://testnet.snowtrace.io/address/0xeebAac693aA19308bA859b3D668e3794310e66AE) |
| **mWAVAX (DEMO)** | [`0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5`](https://testnet.snowtrace.io/address/0xC2439b70B85CF5fBD5A7dA935567e476bFc97ba5) |
| **USDC (Circle)** | [`0x5425890298aed601595a70AB815c96711a31Bc65`](https://testnet.snowtrace.io/address/0x5425890298aed601595a70AB815c96711a31Bc65) |

Guardian đăng ký danh tính ERC-8004 là agent **#295** trên IdentityRegistry:
[`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://testnet.snowtrace.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e).

---

## 9. Minh Bạch Phần Giả Lập (DEMO MODE)

Được công bố công khai khi thuyết trình và hiển thị qua banner DEMO MODE trên Dashboard:
- **MockOracle**: Giá cố định 25 USDC/mWAVAX; **MockRouter** có hai pool thử nghiệm (pool 1 lệch giá 30%) và token **mWAVAX**.
- **Kịch bản tấn công**: Agent bị "prompt injection" được đọc từ fixture xác định (`apps/agent/fixtures/feed.json`) để bảo đảm tính lặp lại (reproducibility) trong buổi demo, không phụ thuộc vào độ trễ hay tính ngẫu nhiên của LLM.
- **Địa chỉ nhái (Vanity Lookalike)**: Sinh địa chỉ trùng 3 ký tự đầu và 3 ký tự cuối của Router hợp lệ; DEMO MODE sử dụng ngưỡng 3/3 để minh họa.
- **x402 Facilitator**: Cung cấp runner Facilitator tự host cục bộ khi cần trình diễn offline hoặc khi dịch vụ công cộng rate-limit.

---

## 10. Giấy phép

[MIT](LICENSE)
