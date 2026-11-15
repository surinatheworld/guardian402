// What the policy builder offers for this deployment: the contracts and functions an agent can be allowed
// to call, and the starting templates. Names come from here and from the
// owner's address book.
import { getAbiItem, toFunctionSelector, type Address, type Hex } from "viem";
import { mockRouterAbi } from "@guardian402/shared";
import { deployment, knownName, tokenMeta } from "./config";
import { EMPTY_SPEC, type Naming, type PolicySpec } from "./policy-spec";

export type CatalogFunction = { selector: Hex; name: string; signature: string; hint: string };
export type CatalogContract = { address: Address; name: string; demo: boolean; functions: CatalogFunction[] };

const swapItem = getAbiItem({ abi: mockRouterAbi, name: "swapExactIn" });
const swapSelector = toFunctionSelector(swapItem);
export const CONTRACTS: CatalogContract[] = [
  {
    address: deployment.router,
    name: "Sàn swap thử nghiệm",
    demo: true,
    functions: [
      {
        selector: swapSelector,
        name: "swapExactIn",
        signature: "swapExactIn(address,address,uint256,uint256,uint8,address)",
        hint: "Đổi một token lấy token khác qua pool của sàn demo.",
      },
    ],
  },
];

/** Names for the summary: address book first, then the deployment's known contracts. */
export function naming(contacts: { name: string; address: string }[]): Naming {
  const book = new Map(contacts.map((c) => [c.address.toLowerCase(), c.name]));
  return {
    asset: (token) => tokenMeta(token),
    name: (a) => book.get(a.toLowerCase()) ?? knownName(a),
    fn: (contract, selector) =>
      CONTRACTS.find((c) => c.address.toLowerCase() === contract.toLowerCase())?.functions.find(
        (f) => f.selector === selector.toLowerCase(),
      )?.name,
  };
}

export type TemplateId = "payments" | "swap" | "custom";
export const TEMPLATES: { id: TemplateId; name: string; description: string }[] = [
  {
    id: "payments",
    name: "Thanh toán",
    description: "Chi USDC cho người nhận bạn chọn.",
  },
  {
    id: "swap",
    name: "Swap có kiểm soát",
    description: "Swap qua sàn thử nghiệm, quyền rút có giới hạn.",
  },
  {
    id: "custom",
    name: "Tự cấu hình",
    description: "Bắt đầu với mọi quyền chi tiêu tắt.",
  },
];

const usdc = (n: number) => String(n * 1_000_000);

/** A template only pre-fills the builder; every field stays editable. */
export function templateSpec(id: TemplateId, recipients: Address[]): PolicySpec {
  if (id === "payments")
    return {
      ...EMPTY_SPEC,
      tokens: [{ token: deployment.usdc, dailyCap: usdc(100), maxApproval: "0", verdictThreshold: usdc(10) }],
      recipients: recipients.slice(0, 5),
      maxRisk: 0,
    };
  if (id === "swap")
    return {
      ...EMPTY_SPEC,
      tokens: [
        { token: deployment.usdc, dailyCap: usdc(20), maxApproval: usdc(10), verdictThreshold: usdc(1) },
      ],
      spenders: [deployment.router],
      contracts: [{ address: deployment.router, selectors: [swapSelector] }],
      maxRisk: 0,
    };
  return { ...EMPTY_SPEC };
}
