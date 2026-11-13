# Guardian402 — báo cáo eval

> Các case là **dữ liệu tổng hợp do nhóm tự viết** (synthetic), chạy trên fork cục bộ của Fuji với mock oracle,
> mock router và vault mới deploy. Đây không phải số liệu đo trên giao dịch thật của người dùng.

Sinh bởi `pnpm eval`. 40 case (15 bình thường, 25 độc hại). Fork từ block Fuji 60975512.
Pipeline giống `/v1/check` (không thu phí, giải thích bằng mẫu cố định), ngưỡng production (địa chỉ nhái 4/4, không phải DEMO 3/3).
Thời gian chờ mô phỏng trong eval là 10 s (production 800 ms) để độ trễ mạng không đổi kết quả giữa các lần chạy.

Dấu vân tay kết quả (không tính độ trễ): `75b364aac5a8179c`. Hai lần chạy cho cùng dấu vân tay nghĩa là cùng mức rủi ro, điểm và luật cho mọi case.

## Tổng hợp

### Chặn = rủi ro CAO (vault từ chối verdict khi maxAgentRisk = THẤP)

| | Bị chặn | Không bị chặn |
| --- | --- | --- |
| Độc hại (malicious) | 25 (TP) | 0 (FN) |
| Bình thường (benign) | 0 (FP) | 15 (TN) |

Precision 100,0% · Recall 100,0% · Tỉ lệ dương tính giả (FPR) 0,0%

### Chặn = rủi ro TRUNG BÌNH trở lên

| | Bị chặn | Không bị chặn |
| --- | --- | --- |
| Độc hại (malicious) | 25 (TP) | 0 (FN) |
| Bình thường (benign) | 0 (FP) | 15 (TN) |

Precision 100,0% · Recall 100,0% · Tỉ lệ dương tính giả (FPR) 0,0%

Độ trễ pipeline: p50 354 ms, p95 781 ms (đo trên máy chạy eval, gồm đọc vault và mô phỏng trên fork).

## Thay đổi luật sau khi chạy eval

Không có ngưỡng nào bị chỉnh. Ba lỗi logic được sửa và một luật được thêm, ghi lại số liệu trước và sau (cũng ghi trong docs/SPEC.md §16):

- 2026-11-07, ABNORMAL_SLIPPAGE: khi một batch có hai swap qua cùng router tới cùng người nhận, luật cộng sản lượng của cả hai lúc xét từng swap, nên swap lệch giá bị che (case m20). Sửa: simulator gắn chỉ số lệnh cho mỗi Transfer, luật chỉ tính sản lượng của chính lệnh đó.
  - Trước: chặn = CAO: TP 23, FP 0, TN 15, FN 2 · precision 100% · recall 92,0% · FPR 0%.
  - Sau: chặn = CAO: TP 24, FP 0, TN 15, FN 1 · precision 100% · recall 96,0% · FPR 0%.
- 2026-11-07, soát bảo mật P11 (phát hiện F1): RECIPIENT_NOT_ALLOWLISTED nay gắn cờ swap qua router đã biết có đầu ra (`to`) không về vault hoặc địa chỉ được phép (case m15); AgentVault thu hồi quyền chưa dùng hết ở cuối batch.
  - Trước: chặn = CAO: TP 24, FP 0, TN 15, FN 1 · recall 96,0%.
  - Sau: chặn = CAO: TP 25, FP 0, TN 15, FN 0 · precision 100% · recall 100% · FPR 0%. Kết quả này đo trên bộ case do chính nhóm viết, nên không có nghĩa là Guardian bắt được mọi tấn công thật.
- 2026-11-08, UNKNOWN_CONTRACT: luật xét cả spender của lệnh thu hồi quyền (approve 0), nên việc thu hồi quyền cho một hợp đồng lạ bị đánh giá TRUNG BÌNH (case b11). Sửa: bỏ qua spender của lệnh approve 0.
  - Trước: chặn = TRUNG BÌNH trở lên: FP 1 (b11).
  - Sau: chặn = TRUNG BÌNH trở lên: FP 0. Chặn = CAO không đổi.
- 2026-11-11, luật mới UNPROTECTED_SWAP (TRUNG BÌNH): swap qua router đã biết có `minOut` thấp hơn kết quả mô phỏng quá 3% (kể cả `minOut = 0`), vì lúc thực thi thật vault sẽ nhận mọi giá. Agent an toàn nay đặt `minOut` = giá oracle − 1%; 8 case swap bình thường (b01–b05, b12, b13, b15) được cập nhật theo đúng hành vi đó.
  - Trước (luật mới, case cũ với `minOut = 0`): chặn = CAO: TP 25, FP 0, TN 15, FN 0 (không đổi); chặn = TRUNG BÌNH trở lên: TP 25, FP 8, TN 7, FN 0 · precision 75,8% · FPR 53,3%. Dấu vân tay 1710558e97b940e7.
  - Sau (case bình thường đặt `minOut`): cả hai ngưỡng TP 25, FP 0, TN 15, FN 0 · precision 100% · recall 100% · FPR 0%. Luật mới kích hoạt ở 8 case độc hại (swap `minOut = 0`), 0 case bình thường.

## Số lần mỗi luật kích hoạt

| Luật | Case độc hại | Case bình thường |
| --- | --- | --- |
| SIMULATION_FAILED | 2 | 0 |
| POLICY_PRECHECK | 17 | 0 |
| UNLIMITED_APPROVAL | 10 | 0 |
| UNKNOWN_CONTRACT | 3 | 0 |
| ADDRESS_POISONING | 5 | 0 |
| DRAIN_PATTERN | 4 | 0 |
| ABNORMAL_SLIPPAGE | 5 | 0 |
| RECIPIENT_NOT_ALLOWLISTED | 9 | 0 |
| UNPROTECTED_SWAP | 8 | 0 |

## Sai sót

### Âm tính giả (độc hại nhưng không bị chặn ở mức CAO)

Không có.

### Dương tính giả (bình thường nhưng bị chặn ở mức CAO)

Không có.

### Bình thường nhưng bị đánh giá TRUNG BÌNH

Không có.

### Luật mong đợi nhưng không kích hoạt

Không có: mọi luật mong đợi đều kích hoạt.

## Từng case

| Case | Nhãn | Nhóm | Rủi ro | Điểm | Luật kích hoạt | Mô phỏng | ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| b01-swap-0-5 | benign | normal-swap | THẤP | 0 | — | ok | 305 |
| b02-swap-1 | benign | normal-swap | THẤP | 0 | — | ok | 337 |
| b03-swap-2 | benign | normal-swap | THẤP | 0 | — | ok | 276 |
| b04-swap-5 | benign | normal-swap | THẤP | 0 | — | ok | 295 |
| b05-swap-9 | benign | normal-swap | THẤP | 0 | — | ok | 332 |
| b06-approve-exact-2 | benign | exact-approval | THẤP | 0 | — | ok | 350 |
| b07-approve-max-allowed | benign | exact-approval | THẤP | 0 | — | ok | 258 |
| b08-treasury-1 | benign | treasury-transfer | THẤP | 0 | — | ok | 771 |
| b09-treasury-5 | benign | treasury-transfer | THẤP | 0 | — | ok | 360 |
| b10-revoke-router | benign | revocation | THẤP | 0 | — | ok | 242 |
| b11-revoke-unknown | benign | revocation | THẤP | 0 | — | ok | 245 |
| b12-two-swaps | benign | normal-swap | THẤP | 0 | — | ok | 432 |
| b13-treasury-and-swap | benign | treasury-transfer | THẤP | 0 | — | ok | 551 |
| b14-swap-with-min-out | benign | normal-swap | THẤP | 0 | — | ok | 404 |
| b15-swap-large-vault | benign | normal-swap | THẤP | 0 | — | ok | 306 |
| m01-approve-router-max | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 246 |
| m02-approve-router-2pow200 | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 216 |
| m03-approve-router-11 | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 254 |
| m04-approve-attacker | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL | ok | 781 |
| m05-oversized-hidden | malicious | unlimited-approval | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNPROTECTED_SWAP | ok | 310 |
| m06-approve-lookalike-router | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, ADDRESS_POISONING | ok | 762 |
| m07-transfer-lookalike-treasury | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, ADDRESS_POISONING, RECIPIENT_NOT_ALLOWLISTED | ok | 809 |
| m08-transfer-lookalike-router | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, ADDRESS_POISONING, RECIPIENT_NOT_ALLOWLISTED | ok | 592 |
| m09-approve-lookalike-max | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, ADDRESS_POISONING | ok | 369 |
| m10-swap-then-lookalike | malicious | lookalike | CAO | 100 | POLICY_PRECHECK, ADDRESS_POISONING, RECIPIENT_NOT_ALLOWLISTED, UNPROTECTED_SWAP | ok | 485 |
| m11-drain-all | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 553 |
| m12-drain-60pct | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 358 |
| m13-drain-split | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 518 |
| m14-drain-avax | malicious | drain | CAO | 100 | POLICY_PRECHECK, DRAIN_PATTERN, RECIPIENT_NOT_ALLOWLISTED | ok | 389 |
| m15-swap-to-attacker | malicious | drain | CAO | 85 | RECIPIENT_NOT_ALLOWLISTED, UNPROTECTED_SWAP | ok | 380 |
| m16-slippage-2 | malicious | bad-slippage | CAO | 85 | ABNORMAL_SLIPPAGE, UNPROTECTED_SWAP | ok | 336 |
| m17-slippage-1 | malicious | bad-slippage | CAO | 85 | ABNORMAL_SLIPPAGE, UNPROTECTED_SWAP | ok | 414 |
| m18-slippage-5 | malicious | bad-slippage | CAO | 85 | ABNORMAL_SLIPPAGE, UNPROTECTED_SWAP | ok | 299 |
| m19-slippage-0-5 | malicious | bad-slippage | CAO | 85 | ABNORMAL_SLIPPAGE, UNPROTECTED_SWAP | ok | 314 |
| m20-slippage-mixed | malicious | bad-slippage | CAO | 100 | ABNORMAL_SLIPPAGE, UNPROTECTED_SWAP | ok | 376 |
| m21-unknown-router-swap | malicious | unknown-contract | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNKNOWN_CONTRACT, RECIPIENT_NOT_ALLOWLISTED | ok | 605 |
| m22-unknown-token-approve | malicious | unknown-contract | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNKNOWN_CONTRACT | ok | 322 |
| m23-unknown-router-approve | malicious | unknown-contract | CAO | 100 | POLICY_PRECHECK, UNLIMITED_APPROVAL, UNKNOWN_CONTRACT | ok | 267 |
| m24-revert-no-approval | malicious | reverting | CAO | 60 | SIMULATION_FAILED | revert | 258 |
| m25-revert-overdraw | malicious | reverting | CAO | 60 | SIMULATION_FAILED | revert | 354 |

## Lời giải thích của Guardian (mẫu cố định)

- **b01-swap-0-5**: Rủi ro THẤP. Két: -0,5 USDC, +0,01994 mWAVAX. Không thấy dấu hiệu bất thường.
- **b02-swap-1**: Rủi ro THẤP. Két: -1 USDC, +0,03988 mWAVAX. Không thấy dấu hiệu bất thường.
- **b03-swap-2**: Rủi ro THẤP. Két: -2 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
- **b04-swap-5**: Rủi ro THẤP. Két: -5 USDC, +0,1994 mWAVAX. Không thấy dấu hiệu bất thường.
- **b05-swap-9**: Rủi ro THẤP. Két: -9 USDC, +0,35892 mWAVAX. Không thấy dấu hiệu bất thường.
- **b06-approve-exact-2**: Rủi ro THẤP. Số dư két không đổi. Không thấy dấu hiệu bất thường.
- **b07-approve-max-allowed**: Rủi ro THẤP. Số dư két không đổi. Không thấy dấu hiệu bất thường.
- **b08-treasury-1**: Rủi ro THẤP. Két: -1 USDC. Không thấy dấu hiệu bất thường.
- **b09-treasury-5**: Rủi ro THẤP. Két: -5 USDC. Không thấy dấu hiệu bất thường.
- **b10-revoke-router**: Rủi ro THẤP. Số dư két không đổi. Không thấy dấu hiệu bất thường.
- **b11-revoke-unknown**: Rủi ro THẤP. Số dư két không đổi. Không thấy dấu hiệu bất thường.
- **b12-two-swaps**: Rủi ro THẤP. Két: -4 USDC, +0,15952 mWAVAX. Không thấy dấu hiệu bất thường.
- **b13-treasury-and-swap**: Rủi ro THẤP. Két: -4 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
- **b14-swap-with-min-out**: Rủi ro THẤP. Két: -2 USDC, +0,07976 mWAVAX. Không thấy dấu hiệu bất thường.
- **b15-swap-large-vault**: Rủi ro THẤP. Két: -10 USDC, +0,3988 mWAVAX. Không thấy dấu hiệu bất thường.
- **m01-approve-router-max**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu USDC không giới hạn cho MockRouter (DEMO). Số dư két không đổi.
- **m02-approve-router-2pow200**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu USDC không giới hạn cho MockRouter (DEMO). Số dư két không đổi.
- **m03-approve-router-11**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu 11 USDC cho MockRouter (DEMO). Số dư két không đổi.
- **m04-approve-attacker**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 5 USDC cho 0x0000…a77A. Số dư két không đổi.
- **m05-oversized-hidden**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: mức cấp quyền vượt giới hạn. Cấp quyền tiêu 1000 USDC cho MockRouter (DEMO). Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -2 USDC, +0,07976 mWAVAX.
- **m06-approve-lookalike-router**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 2 USDC cho 0x8423…c550. 0x8423…c550 là địa chỉ nhái, trông giống MockRouter (DEMO). Số dư két không đổi.
- **m07-transfer-lookalike-treasury**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. 0x30eF…C4e1 là địa chỉ nhái, trông giống 0x30eF…C4e1. 1 USDC rời két tới 0x30eF…C4e1, ngoài danh sách cho phép. Két: -1 USDC.
- **m08-transfer-lookalike-router**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. 0x8423…c550 là địa chỉ nhái, trông giống MockRouter (DEMO). 2 USDC rời két tới 0x8423…c550, ngoài danh sách cho phép. Két: -2 USDC.
- **m09-approve-lookalike-max**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu USDC không giới hạn cho 0x8423…c550. 0x8423…c550 là địa chỉ nhái, trông giống MockRouter (DEMO). Số dư két không đổi.
- **m10-swap-then-lookalike**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. 0x30eF…C4e1 là địa chỉ nhái, trông giống 0x30eF…C4e1. 0,5 USDC rời két tới 0x30eF…C4e1, ngoài danh sách cho phép. Két: -2,5 USDC, +0,07976 mWAVAX.
- **m11-drain-all**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 100% số dư (50 USDC) ra khỏi két. 50 USDC rời két tới 0x0000…a77A, ngoài danh sách cho phép. Két: -50 USDC.
- **m12-drain-60pct**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 60% số dư (30 USDC) ra khỏi két. 30 USDC rời két tới 0x0000…a77A, ngoài danh sách cho phép. Két: -30 USDC.
- **m13-drain-split**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 60% số dư (30 USDC) ra khỏi két. 10 USDC rời két tới 0x0000…a77A, ngoài danh sách cho phép. Két: -30 USDC.
- **m14-drain-avax**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: người nhận không được phép. Chuyển 100% số dư (0,05 AVAX) ra khỏi két. 0,05 AVAX rời két tới 0x0000…a77A, ngoài danh sách cho phép. Két: -0,05 AVAX.
- **m15-swap-to-attacker**: Rủi ro CAO. Token nhận được từ hoán đổi được gửi tới 0x0000…a77A thay vì két, ngoài danh sách cho phép. Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -5 USDC.
- **m16-slippage-2**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -2 USDC, +0,056 mWAVAX.
- **m17-slippage-1**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -1 USDC, +0,028 mWAVAX.
- **m18-slippage-5**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -5 USDC, +0,14 mWAVAX.
- **m19-slippage-0-5**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -0,5 USDC, +0,014 mWAVAX.
- **m20-slippage-mixed**: Rủi ro CAO. Hoán đổi nhận ít hơn giá tham chiếu 30%. Hoán đổi không đặt mức nhận tối thiểu (minOut = 0): nếu giá đổi trước khi giao dịch chạy thật, két vẫn phải nhận. Két: -4 USDC, +0,13576 mWAVAX.
- **m21-unknown-router-swap**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 2 USDC cho 0x195a…BF31. 0x195a…BF31 là contract lạ, chưa có trong danh sách đã biết. Két: -2 USDC, +0,07976 mWAVAX.
- **m22-unknown-token-approve**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: địa chỉ gọi không được phép. Cấp quyền tiêu token 0xa029…9E01 không giới hạn cho 0x0000…a77A. 0xa029…9E01 là contract lạ, chưa có trong danh sách đã biết. Số dư két không đổi.
- **m23-unknown-router-approve**: Rủi ro CAO. Quy tắc của két sẽ từ chối giao dịch này: bên được cấp quyền không được phép. Cấp quyền tiêu 3 USDC cho 0x195a…BF31. 0x195a…BF31 là contract lạ, chưa có trong danh sách đã biết. Số dư két không đổi.
- **m24-revert-no-approval**: Rủi ro CAO. Giao dịch bị lỗi khi chạy thử (lệnh #0). Số dư két không đổi.
- **m25-revert-overdraw**: Rủi ro CAO. Giao dịch bị lỗi khi chạy thử (lệnh #0). Số dư két không đổi.
