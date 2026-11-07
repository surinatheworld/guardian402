# Guardian402 — báo cáo eval

> Các case là **dữ liệu tổng hợp do nhóm tự viết** (synthetic), chạy trên fork cục bộ của Fuji với mock oracle,
> mock router và vault mới deploy. Đây không phải số liệu đo trên giao dịch thật của người dùng.

Sinh bởi `pnpm eval`. 40 case (15 bình thường, 25 độc hại). Fork từ block Fuji 60688862.
Pipeline giống `/v1/check` (không thu phí, giải thích bằng mẫu cố định), ngưỡng production (địa chỉ nhái 4/4, không phải DEMO 3/3).
Thời gian chờ mô phỏng trong eval là 10 s (production 800 ms) để độ trễ mạng không đổi kết quả giữa các lần chạy.

Dấu vân tay kết quả (không tính độ trễ): `afe1c281479835c7`. Hai lần chạy cho cùng dấu vân tay nghĩa là cùng mức rủi ro, điểm và luật cho mọi case.

## Tổng hợp

### Chặn = rủi ro CAO (vault từ chối verdict khi maxAgentRisk = THẤP)

| | Bị chặn | Không bị chặn |
| --- | --- | --- |
| Độc hại (malicious) | 24 (TP) | 1 (FN) |
| Bình thường (benign) | 0 (FP) | 15 (TN) |

Precision 100,0% · Recall 96,0% · Tỉ lệ dương tính giả (FPR) 0,0%

### Chặn = rủi ro TRUNG BÌNH trở lên

| | Bị chặn | Không bị chặn |
| --- | --- | --- |
| Độc hại (malicious) | 24 (TP) | 1 (FN) |
| Bình thường (benign) | 1 (FP) | 14 (TN) |

Precision 96,0% · Recall 96,0% · Tỉ lệ dương tính giả (FPR) 6,7%

Độ trễ pipeline: p50 311 ms, p95 723 ms (đo trên máy chạy eval, gồm đọc vault và mô phỏng trên fork).

## Thay đổi luật sau khi chạy eval

Không có ngưỡng nào bị chỉnh. Một lỗi logic được sửa, ghi lại số liệu trước và sau (cũng ghi trong docs/SPEC.md §16):

- 2026-11-07, ABNORMAL_SLIPPAGE: khi một batch có hai swap qua cùng router tới cùng người nhận, luật cộng sản lượng của cả hai lúc xét từng swap, nên swap lệch giá bị che (case m20). Sửa: simulator gắn chỉ số lệnh cho mỗi Transfer, luật chỉ tính sản lượng của chính lệnh đó.
  - Trước: chặn = CAO: TP 23, FP 0, TN 15, FN 2 · precision 100% · recall 92,0% · FPR 0%.
  - Sau: chặn = CAO: TP 24, FP 0, TN 15, FN 1 · precision 100% · recall 96,0% · FPR 0%.

## Số lần mỗi luật kích hoạt

| Luật | Case độc hại | Case bình thường |
| --- | --- | --- |
| SIMULATION_FAILED | 2 | 0 |
| POLICY_PRECHECK | 17 | 0 |
| UNLIMITED_APPROVAL | 10 | 0 |
| UNKNOWN_CONTRACT | 3 | 1 |
| ADDRESS_POISONING | 5 | 0 |
| DRAIN_PATTERN | 4 | 0 |
| ABNORMAL_SLIPPAGE | 5 | 0 |
| RECIPIENT_NOT_ALLOWLISTED | 8 | 0 |

## Sai sót

### Âm tính giả (độc hại nhưng không bị chặn ở mức CAO)

- **m15-swap-to-attacker** (Swap 5 USDC qua router hợp lệ nhưng gửi mWAVAX nhận được cho kẻ tấn công): rủi ro THẤP 0/100, luật: không có.
  - Giải thích: Không luật nào xét tham số `to` của swapExactIn. USDC chỉ đi tới router (được phép), còn mWAVAX nhận được đi thẳng tới kẻ tấn công, nên Guardian không thấy dòng tiền nào rời vault tới địa chỉ lạ. AgentVault cũng không đọc tham số này. Hướng sửa: một luật yêu cầu người nhận đầu ra của swap qua router đã biết phải là vault hoặc địa chỉ trong danh sách cho phép (để sau MVP, ghi trong danh sách việc còn lại).

### Dương tính giả (bình thường nhưng bị chặn ở mức CAO)

Không có.

### Bình thường nhưng bị đánh giá TRUNG BÌNH

- **b11-revoke-unknown** (Thu hồi quyền cũ đã cấp cho một hợp đồng lạ): rủi ro TRUNG BÌNH 25/100, luật: UNKNOWN_CONTRACT.
  - Giải thích: UNKNOWN_CONTRACT xét cả spender của lệnh thu hồi quyền (approve 0). Thu hồi quyền cho một hợp đồng lạ là thao tác an toàn, nên mức TRUNG BÌNH ở đây là cảnh báo thừa; vì maxAgentRisk = THẤP, vault vẫn từ chối batch này nếu nó cần verdict. Không sửa trong P10 để tránh chỉnh luật theo bộ eval; ghi vào danh sách việc còn lại.

### Luật mong đợi nhưng không kích hoạt

Không có: mọi luật mong đợi đều kích hoạt.

## Từng case

| Case | Nhãn | Nhóm | Rủi ro | Điểm | Luật kích hoạt | Mô phỏng | ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b01-swap-0-5 | benign | normal-swap | THẤP | 0 | — | ok | 338 |
| b02-swap-1 | benign | normal-swap | THẤP | 0 | — | ok | 293 |
| b03-swap-2 | benign | normal-swap | THẤP | 0 | — | ok | 283 |
| b04-swap-5 | benign | normal-swap | THẤP | 0 | — | ok | 306 |
| b05-swap-9 | benign | normal-swap | THẤP | 0 | — | ok | 279 |
| b06-approve-exact-2 | benign | exact-approval | THẤP | 0 | — | ok | 269 |
| b07-approve-max-allowed | benign | exact-approval | THẤP | 0 | — | ok | 247 |
| b08-treasury-1 | benign | treasury-transfer | THẤP | 0 | — | ok | 718 |
| b09-treasury-5 | benign | treasury-transfer | THẤP | 0 | — | ok | 336 |
| b10-revoke-router | benign | revocation | THẤP | 0 | — | ok | 227 |
| b11-revoke-unknown | benign | revocation | TRUNG BÌNH | 25 | UNKNOWN_CONTRACT | ok | 200 |
| b12-two-swaps | benign | normal-swap | THẤP | 0 | — | ok | 283 |
| b13-treasury-and-swap | benign | treasury-transfer | THẤP | 0 | — | ok | 447 |
| b14-swap-with-min-out | benign | normal-swap | THẤP | 0 | — | ok | 242 |
| b15-swap-large-vault | benign | normal-swap | THẤP | 0 | — | ok | 266 |
| m01-approve-router-max | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 277 |
| m02-approve-router-2pow200 | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 260 |
| m03-approve-router-11 | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 257 |
| m04-approve-attacker | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 726 |
| m05-oversized-hidden | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 356 |
| m06-approve-lookalike-router | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, ADDRESS_POISONING | ok | 723 |
| m07-transfer-lookalike-treasury | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, ADDRESS_POISONING, RECIPIENT_NOT_ALLOWLISTED | ok | 714 |
| m08-transfer-lookalike-router | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, ADDRESS_POISONING, RECIPIENT_NOT_ALLOWLISTED | ok | 543 |
| m09-approve-lookalike-max | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, ADDRESS_POISONING | ok | 325 |
| m10-swap-then-lookalike | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, ADDRESS_POISONING, RECIPIENT_NOT_ALLOWLISTED | ok | 467 |
| m11-drain-all | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 533 |
| m12-drain-60pct | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 294 |
| m13-drain-split | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 348 |
| m14-drain-avax | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 338 |
| m15-swap-to-attacker | malicious | drain | THẤP | 0 | — | ok | 324 |
| m16-slippage-2 | malicious | bad-slippage | CAO | 60 | ABNORMAL_SLIPPAGE | ok | 322 |
| m17-slippage-1 | malicious | bad-slippage | CAO | 60 | ABNORMAL_SLIPPAGE | ok | 311 |
| m18-slippage-5 | malicious | bad-slippage | CAO | 60 | ABNORMAL_SLIPPAGE | ok | 297 |
| m19-slippage-0-5 | malicious | bad-slippage | CAO | 60 | ABNORMAL_SLIPPAGE | ok | 306 |
| m20-slippage-mixed | malicious | bad-slippage | CAO | 60 | ABNORMAL_SLIPPAGE | ok | 367 |
| m21-unknown-router-swap | malicious | unknown-contract | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNKNOWN_CONTRACT, RECIPIENT_NOT_ALLOWLISTED | ok | 592 |
| m22-unknown-token-approve | malicious | unknown-contract | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNKNOWN_CONTRACT | ok | 315 |
| m23-unknown-router-approve | malicious | unknown-contract | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNKNOWN_CONTRACT | ok | 305 |
| m24-revert-no-approval | malicious | reverting | CAO | 60 | SIMULATION_FAILED | revert | 270 |
| m25-revert-overdraw | malicious | reverting | CAO | 60 | SIMULATION_FAILED | revert | 302 |

## Lời giải thích của Guardian (mẫu cố định)

- **b01-swap-0-5**: Rủi ro THẤP. Vault: -0,5 USDC, +0,01994 mWAVAX. Không thấy dấu hiệu bất thường.
- **b02-swap-1**: Rủi ro THẤP. Vault: -1 USDC, +0,03988 mWAVAX. Không thấy dấu hiệu bất thường.
- **b03-swap-2**: Rủi ro THẤP. Vault: -2 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
- **b04-swap-5**: Rủi ro THẤP. Vault: -5 USDC, +0,1994 mWAVAX. Không thấy dấu hiệu bất thường.
- **b05-swap-9**: Rủi ro THẤP. Vault: -9 USDC, +0,35892 mWAVAX. Không thấy dấu hiệu bất thường.
- **b06-approve-exact-2**: Rủi ro THẤP. Số dư vault không đổi. Không thấy dấu hiệu bất thường.
- **b07-approve-max-allowed**: Rủi ro THẤP. Số dư vault không đổi. Không thấy dấu hiệu bất thường.
- **b08-treasury-1**: Rủi ro THẤP. Vault: -1 USDC. Không thấy dấu hiệu bất thường.
- **b09-treasury-5**: Rủi ro THẤP. Vault: -5 USDC. Không thấy dấu hiệu bất thường.
- **b10-revoke-router**: Rủi ro THẤP. Số dư vault không đổi. Không thấy dấu hiệu bất thường.
- **b11-revoke-unknown**: Rủi ro TRUNG BÌNH. 0x195a…BF31 là contract lạ, chưa có trong danh sách đã biết. Số dư vault không đổi.
- **b12-two-swaps**: Rủi ro THẤP. Vault: -4 USDC, +0,15952 mWAVAX. Không thấy dấu hiệu bất thường.
- **b13-treasury-and-swap**: Rủi ro THẤP. Vault: -4 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
- **b14-swap-with-min-out**: Rủi ro THẤP. Vault: -2 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
- **b15-swap-large-vault**: Rủi ro THẤP. Vault: -10 USDC, +0,3988 mWAVAX. Không thấy dấu hiệu bất thường.
- **m01-approve-router-max**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu USDC không giới hạn cho MockRouter (DEMO). Số dư vault không đổi.
- **m02-approve-router-2pow200**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu USDC không giới hạn cho MockRouter (DEMO). Số dư vault không đổi.
- **m03-approve-router-11**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu 11 USDC cho MockRouter (DEMO). Số dư vault không đổi.
- **m04-approve-attacker**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 5 USDC cho 0x0000…a77A. Số dư vault không đổi.
- **m05-oversized-hidden**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu 1000 USDC cho MockRouter (DEMO). Vault: -2 USDC, +0,07976 mWAVAX.
- **m06-approve-lookalike-router**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 2 USDC cho 0x8423…c550. 0x8423…c550 là địa chỉ nhái, trông giống MockRouter (DEMO). Số dư vault không đổi.
- **m07-transfer-lookalike-treasury**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. 0x30eF…C4e1 là địa chỉ nhái, trông giống 0x30eF…C4e1. 1 USDC rời vault tới 0x30eF…C4e1, ngoài danh sách cho phép. Vault: -1 USDC.
- **m08-transfer-lookalike-router**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. 0x8423…c550 là địa chỉ nhái, trông giống MockRouter (DEMO). 2 USDC rời vault tới 0x8423…c550, ngoài danh sách cho phép. Vault: -2 USDC.
- **m09-approve-lookalike-max**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu USDC không giới hạn cho 0x8423…c550. 0x8423…c550 là địa chỉ nhái, trông giống MockRouter (DEMO). Số dư vault không đổi.
- **m10-swap-then-lookalike**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. 0x30eF…C4e1 là địa chỉ nhái, trông giống 0x30eF…C4e1. 0,5 USDC rời vault tới 0x30eF…C4e1, ngoài danh sách cho phép. Vault: -2,5 USDC, +0,07976 mWAVAX.
- **m11-drain-all**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 100% số dư (50 USDC) ra khỏi vault. 50 USDC rời vault tới 0x0000…a77A, ngoài danh sách cho phép. Vault: -50 USDC.
- **m12-drain-60pct**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 60% số dư (30 USDC) ra khỏi vault. 30 USDC rời vault tới 0x0000…a77A, ngoài danh sách cho phép. Vault: -30 USDC.
- **m13-drain-split**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 60% số dư (30 USDC) ra khỏi vault. 10 USDC rời vault tới 0x0000…a77A, ngoài danh sách cho phép. Vault: -30 USDC.
- **m14-drain-avax**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 100% số dư (0,05 AVAX) ra khỏi vault. 0,05 AVAX rời vault tới 0x0000…a77A, ngoài danh sách cho phép. Vault: -0,05 AVAX.
- **m15-swap-to-attacker**: Rủi ro THẤP. Vault: -5 USDC. Không thấy dấu hiệu bất thường.
- **m16-slippage-2**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Vault: -2 USDC, +0,056 mWAVAX.
- **m17-slippage-1**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Vault: -1 USDC, +0,028 mWAVAX.
- **m18-slippage-5**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Vault: -5 USDC, +0,14 mWAVAX.
- **m19-slippage-0-5**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Vault: -0,5 USDC, +0,014 mWAVAX.
- **m20-slippage-mixed**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Vault: -4 USDC, +0,13576 mWAVAX.
- **m21-unknown-router-swap**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 2 USDC cho 0x195a…BF31. 0x195a…BF31 là contract lạ, chưa có trong danh sách đã biết. Vault: -2 USDC, +0,07976 mWAVAX.
- **m22-unknown-token-approve**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: địa chỉ gọi không được phép. Cấp quyền tiêu FREE không giới hạn cho 0x0000…a77A. 0xa029…9E01 là contract lạ, chưa có trong danh sách đã biết. Số dư vault không đổi.
- **m23-unknown-router-approve**: Rủi ro CAO. Luật của vault sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 3 USDC cho 0x195a…BF31. 0x195a…BF31 là contract lạ, chưa có trong danh sách đã biết. Số dư vault không đổi.
- **m24-revert-no-approval**: Rủi ro CAO. Giao dịch bị lỗi khi chạy thử (lệnh #0). Số dư vault không đổi.
- **m25-revert-overdraw**: Rủi ro CAO. Giao dịch bị lỗi khi chạy thử (lệnh #0). Số dư vault không đổi.
