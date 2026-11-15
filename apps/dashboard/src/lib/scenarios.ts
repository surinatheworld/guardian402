// The demo scenarios (docs/SPEC.md §10) in one catalog, for the "Chạy thử" page and the activity feed.
// `simulate`: a free Guardian check of the scenario's calls (DEMO /v1/demo/check), nothing sent on chain.
// `vaultTrial`: S5 and S6 end at the vault, so their simulation asks the demo vault itself with eth_call
// (src/lib/vault-trial.ts), nothing sent.
// `live`: the demo agent runs it on the test network: pays the x402 fee and sends the transaction to the vault.
// `evidence`: the vault transactions of the scenario's real run on Fuji (README §5.4), shown where it cannot run.
import type { Hex } from "viem";
import { PRESETS, type Preset } from "./presets";

export type Scenario = {
  id: "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
  title: string;
  /** What the agent does, in one sentence. */
  story: string;
  /** What should happen. */
  expected: string;
  attack: boolean;
  preset?: Preset | undefined;
  /** Simulated by asking the demo vault with eth_call instead of a Guardian check. */
  vaultTrial?: boolean;
  live: boolean;
  /** The scenario's vault transactions on Fuji, each with what the vault did. */
  evidence: { label: string; tx: Hex }[];
  /** S6 needs the owner key on the agent's side; on Fuji the owner is the team lead's wallet. */
  needsOwner?: boolean;
};

const preset = (id: string) => PRESETS.find((p) => p.id === id);

export const SCENARIOS: Scenario[] = [
  {
    id: "S0",
    title: "Chuyển 1,5 USDC cho Treasury",
    story: "Agent trả 1,5 USDC cho một người nhận tin cậy, dưới hạn mức ngày.",
    expected: "Rủi ro thấp, két thực hiện.",
    attack: false,
    preset: preset("S0"),
    live: true,
    evidence: [
      { label: "Két thực hiện", tx: "0x02b10072b18e80301ccd5fdfa8e0193d74fac595c83a1dbdeec677dea0444eb1" },
    ],
  },
  {
    id: "S1",
    title: "Swap 2 USDC sang mWAVAX",
    story: "Agent đổi 2 USDC qua sàn thử nghiệm, có đặt mức nhận tối thiểu.",
    expected: "Rủi ro thấp, két thực hiện.",
    attack: false,
    preset: preset("S1"),
    live: true,
    evidence: [
      { label: "Két thực hiện", tx: "0x643d89ad6e6e526bdc2bc5f2d9a0084263c68564235104d4a0c418b94a090e00" },
    ],
  },
  {
    id: "S2",
    title: "Rút sạch két về ví kẻ tấn công",
    story: "Agent bị chèn lệnh, cố chuyển toàn bộ USDC tới một địa chỉ lạ.",
    expected: "Rủi ro cao, két từ chối.",
    attack: true,
    preset: preset("S2"),
    live: true,
    evidence: [
      {
        label: "Két từ chối: RecipientNotAllowed",
        tx: "0x18f9908fedaf48e0e7ca4eea3e1b5020470d333869412ac90ff0cf6a25e132ae",
      },
    ],
  },
  {
    id: "S3",
    title: "Cấp quyền cho địa chỉ nhái sàn swap",
    story: "Agent cấp quyền rút không giới hạn cho một địa chỉ trông giống sàn swap.",
    expected: "Rủi ro cao, két từ chối.",
    attack: true,
    preset: preset("S3"),
    live: true,
    evidence: [
      {
        label: "Két từ chối: RecipientNotAllowed",
        tx: "0xb0a0846cf4297693f3e6508d50b631e7fff1e51542c620435a9c640c8ac00fce",
      },
    ],
  },
  {
    id: "S4",
    title: "Swap qua pool lệch giá 30%",
    story: "Agent swap 2 USDC qua pool có giá lệch, không đặt mức nhận tối thiểu.",
    expected: "Rủi ro cao, két từ chối.",
    attack: false,
    preset: preset("S4"),
    live: true,
    evidence: [
      {
        label: "Két từ chối: RiskTooHigh",
        tx: "0x1220fd094ecbbc621c6640f15c9570092f34cfd330b329271432473d8f3869f5",
      },
    ],
  },
  {
    id: "S5",
    title: "Dùng lại phê duyệt cũ",
    story:
      "Agent lấy phê duyệt của một giao dịch để gửi giao dịch khác, rồi gửi lại khi phê duyệt đã hết hạn.",
    expected: "Két từ chối cả hai lần.",
    attack: true,
    vaultTrial: true,
    live: true,
    evidence: [
      {
        label: "Két từ chối: InvalidVerdict",
        tx: "0x9924ab795e1974f6232321d1fee49c6046213d494790f72da4f86d74eb5ab056",
      },
      {
        label: "Két từ chối: VerdictExpired",
        tx: "0x885d3cb381d11d9d55b98c7bd96b7f174abddc9d406c283c582c7496d620a51f",
      },
    ],
  },
  {
    id: "S6",
    title: "Chủ két khoá khẩn cấp",
    story: "Chủ két khoá két, agent thử chi tiêu, rồi chủ két mở khoá lại.",
    expected: "Két từ chối khi đang khoá.",
    attack: false,
    vaultTrial: true,
    live: true,
    evidence: [
      {
        label: "Két từ chối: Paused",
        tx: "0xe61ec50818bdbe9d5844e2546a7d2ff3902ef71ff09d083e8100482b19b61161",
      },
    ],
    needsOwner: true,
  },
];

export const scenarioTitle = (id: string) => SCENARIOS.find((s) => s.id === id)?.title ?? id;
