// The demo scenarios (docs/SPEC.md §10) in one catalog, for the "Chạy thử" page and the activity feed.
// `simulate`: a free Guardian check of the scenario's calls (DEMO /v1/demo/check), nothing sent on chain.
// `live`: the demo agent runs it on the test network: pays the x402 fee and sends the transaction to the vault.
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
  live: boolean;
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
  },
  {
    id: "S1",
    title: "Swap 2 USDC sang mWAVAX",
    story: "Agent đổi 2 USDC qua sàn thử nghiệm, có đặt mức nhận tối thiểu.",
    expected: "Rủi ro thấp, két thực hiện.",
    attack: false,
    preset: preset("S1"),
    live: true,
  },
  {
    id: "S2",
    title: "Rút sạch két về ví kẻ tấn công",
    story: "Agent bị chèn lệnh, cố chuyển toàn bộ USDC tới một địa chỉ lạ.",
    expected: "Rủi ro cao, két từ chối.",
    attack: true,
    preset: preset("S2"),
    live: true,
  },
  {
    id: "S3",
    title: "Cấp quyền cho địa chỉ nhái sàn swap",
    story: "Agent cấp quyền rút không giới hạn cho một địa chỉ trông giống sàn swap.",
    expected: "Rủi ro cao, két từ chối.",
    attack: true,
    preset: preset("S3"),
    live: true,
  },
  {
    id: "S4",
    title: "Swap qua pool lệch giá 30%",
    story: "Agent swap 2 USDC qua pool có giá lệch, không đặt mức nhận tối thiểu.",
    expected: "Rủi ro cao, két từ chối.",
    attack: false,
    preset: preset("S4"),
    live: true,
  },
  {
    id: "S5",
    title: "Dùng lại phê duyệt cũ",
    story:
      "Agent lấy phê duyệt của một giao dịch để gửi giao dịch khác, rồi gửi lại khi phê duyệt đã hết hạn.",
    expected: "Két từ chối cả hai lần.",
    attack: true,
    live: true,
  },
  {
    id: "S6",
    title: "Chủ két khoá khẩn cấp",
    story: "Chủ két khoá két, agent thử chi tiêu, rồi chủ két mở khoá lại.",
    expected: "Két từ chối khi đang khoá.",
    attack: false,
    live: true,
    needsOwner: true,
  },
];

export const scenarioTitle = (id: string) => SCENARIOS.find((s) => s.id === id)?.title ?? id;
