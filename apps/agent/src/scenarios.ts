// Scenarios S1–S6 (docs/SPEC.md §10). Each one checks its result against the expected row of the spec table;
// a mismatch is reported as such, never hidden by changing the expectation.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, erc20Abi, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  fujiChain,
  getAddresses,
  mockOracleAbi,
  RULE_IDS,
  type Call,
  type Deployment,
  type RiskLevel,
  type RuleId,
} from "@guardian402/shared";
import { AGENT_DIR, type AgentEnv } from "./env.ts";
import { askGuardian, payingFetchFor, type GuardianResult } from "./guardian.ts";
import { approve, planFromInjection, planSafeDca, swap } from "./planner.ts";
import { executeBatch, setPaused, type VaultOutcome } from "./vault.ts";

export const SCENARIO_IDS = ["S1", "S2", "S3", "S4", "S5", "S6"] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

type Expected = { risk?: RiskLevel; rules?: RuleId[]; vault: VaultOutcome["status"]; revert?: string[] };

/** The table of docs/SPEC.md §10. S5 sends two batches (other calls, then an expired verdict). */
export const EXPECTED: Record<ScenarioId, Expected> = {
  S1: { risk: "LOW", vault: "success" },
  S2: {
    risk: "HIGH",
    rules: ["DRAIN_PATTERN", "RECIPIENT_NOT_ALLOWLISTED"],
    vault: "reverted",
    revert: ["RecipientNotAllowed"],
  },
  S3: { risk: "HIGH", rules: ["UNLIMITED_APPROVAL", "ADDRESS_POISONING"], vault: "reverted" },
  S4: { risk: "HIGH", rules: ["ABNORMAL_SLIPPAGE"], vault: "reverted", revert: ["RiskTooHigh"] },
  S5: { vault: "reverted", revert: ["InvalidVerdict", "VerdictExpired"] },
  S6: { vault: "reverted", revert: ["Paused"] },
};

export const NAMES: Record<ScenarioId, string> = {
  S1: "normal-swap",
  S2: "drain-to-attacker",
  S3: "poisoned-approval",
  S4: "bad-slippage",
  S5: "replay",
  S6: "kill-switch",
};

export type Attempt = {
  at: string;
  scenario: ScenarioId;
  name: string;
  network: string;
  mode: "safe" | "scripted-attack";
  guardian?: {
    endpoint: string;
    status: number;
    risk?: string;
    findings?: RuleId[];
    checkId?: string;
    paymentTx?: string;
    explanationVi?: string;
  };
  vault: VaultOutcome[];
  expected: Expected;
  matched: boolean;
  mismatch?: string;
};

export const ATTEMPTS_FILE = join(AGENT_DIR, "data/attempts.jsonl");

export function readAttempts(limit = 100): Attempt[] {
  if (!existsSync(ATTEMPTS_FILE)) return [];
  const lines = readFileSync(ATTEMPTS_FILE, "utf8").trim().split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => JSON.parse(l) as Attempt)
    .reverse();
}

function compare(exp: Expected, g: GuardianResult | undefined, outcomes: VaultOutcome[]): string | undefined {
  if (exp.risk && g?.response?.risk !== exp.risk)
    return `Guardian risk ${g?.response?.risk ?? g?.status} ≠ ${exp.risk}`;
  const fired = new Set(g?.response?.findings.map((f) => f.ruleId));
  const missing = (exp.rules ?? []).filter((r) => !fired.has(r));
  if (missing.length) return `rules not fired: ${missing.join(", ")}`;
  const last = outcomes.at(-1);
  if (last?.status !== exp.vault) return `vault ${last?.status} ≠ ${exp.vault}`;
  if (exp.revert) {
    const got = outcomes.map((o) => o.revert);
    if (exp.revert.some((r, i) => got[i] !== r))
      return `vault reverts ${got.join(", ")} ≠ ${exp.revert.join(", ")}`;
  }
  return undefined;
}

export type Runner = ReturnType<typeof createRunner>;

export function createRunner(env: AgentEnv, print: (line: string) => void = console.log) {
  const d: Deployment = getAddresses(env.NETWORK);
  const agent = privateKeyToAccount(env.AGENT_PK);
  const chain = createPublicClient({ chain: fujiChain, transport: http(env.CHAIN_RPC_URL) }) as PublicClient;
  const wallet = createWalletClient({ account: agent, chain: fujiChain, transport: http(env.CHAIN_RPC_URL) });
  const owner = env.OWNER_PK
    ? createWalletClient({
        account: privateKeyToAccount(env.OWNER_PK),
        chain: fujiChain,
        transport: http(env.CHAIN_RPC_URL),
      })
    : undefined;
  const payingFetch = payingFetchFor(agent);
  const link = (hash: string) =>
    env.NETWORK === "fuji" ? `https://testnet.snowtrace.io/tx/${hash}` : `${hash} (fork)`;
  const ask = (endpoint: "check" | "cosign", calls: Call[]) =>
    askGuardian(payingFetch, env.GUARDIAN_URL, endpoint, d.vault, calls);

  const printGuardian = (g: GuardianResult) => {
    if (!g.response) {
      print(`  Guardian trả HTTP ${g.status}: ${g.error ?? ""}`);
      return;
    }
    const r = g.response;
    const label = { LOW: "THẤP", MEDIUM: "TRUNG BÌNH", HIGH: "CAO" }[r.risk];
    print(
      `  Guardian: rủi ro ${label} (${r.score}/100)${r.findings.length ? ` · ${[...new Set(r.findings.map((f) => f.ruleId))].join(", ")}` : ""}`,
    );
    print(`  Giải thích: ${r.explanation.vi}`);
    print(
      g.paymentTx ? `  Phí x402 (${g.endpoint}): ${link(g.paymentTx)}` : "  Phí x402: không có biên nhận",
    );
  };
  const printVault = (o: VaultOutcome) => {
    if (o.status === "success") print(`  Vault: đã thực hiện · ${link(o.tx ?? "")}`);
    else
      print(
        `  Vault: bị từ chối (${o.revert}${o.revertArgs ? `: ${o.revertArgs}` : ""}) · ${o.tx ? link(o.tx) : "không gửi"}`,
      );
  };
  const usdcBalance = () =>
    chain.readContract({ address: d.usdc, abi: erc20Abi, functionName: "balanceOf", args: [d.vault] });
  const safeS1 = async (amount = 2_000_000n) => {
    const price = await chain.readContract({ address: d.oracle, abi: mockOracleAbi, functionName: "price" });
    return planSafeDca(d, { price, maxPrice: 30_000_000n, amount });
  };

  // Waits until chain time passes the deadline (the vault compares with block.timestamp). On the fork no block
  // is mined while idle, so one is mined per poll; the clock itself is never moved, because a fork clock ahead of
  // the wall clock would also expire the x402 payment authorizations the agent signs afterwards.
  async function waitPast(deadline: number) {
    print(`  Chờ thời gian trên chain vượt hạn verdict (${deadline})…`);
    for (;;) {
      if (env.NETWORK === "local") await chain.request({ method: "evm_mine", params: [] } as never);
      const head = await chain.getBlock({ blockTag: "latest" });
      if (Number(head.timestamp) > deadline + 1) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async function run(id: ScenarioId): Promise<Attempt> {
    const exp = EXPECTED[id];
    let mode: Attempt["mode"] = "safe";
    let g: GuardianResult | undefined;
    const outcomes: VaultOutcome[] = [];
    print(`\n[${id} ${NAMES[id]}] mạng ${env.NETWORK}`);

    switch (id) {
      case "S1": {
        const calls = await safeS1();
        g = await ask("cosign", calls);
        printGuardian(g);
        // Safe mode follows the Guardian: it sends only what came back LOW, with the verdict.
        if (g.response?.risk === "LOW")
          outcomes.push(await executeBatch(chain, wallet, d.vault, calls, g.response.verdict));
        else outcomes.push({ status: "not-sent", revert: `Guardian ${g.response?.risk ?? g.status}` });
        break;
      }
      case "S2":
      case "S3": {
        mode = "scripted-attack";
        const calls = planFromInjection(d, id === "S2" ? "drain" : "poison", await usdcBalance());
        print(`  Planner bị chèn lệnh (DEMO) đề xuất ${calls.length} lệnh từ bản tin.`);
        g = await ask("check", calls);
        printGuardian(g);
        print("  Agent bị chiếm quyền phớt lờ Guardian và gửi thẳng, không có verdict:");
        outcomes.push(await executeBatch(chain, wallet, d.vault, calls, undefined));
        break;
      }
      case "S4": {
        mode = "scripted-attack";
        const calls = [approve(d, d.router, 2_000_000n), swap(d, 2_000_000n, 1, 0n)];
        g = await ask("cosign", calls);
        printGuardian(g);
        print("  Agent gửi kèm verdict HIGH (mọi luật tĩnh đều qua):");
        outcomes.push(await executeBatch(chain, wallet, d.vault, calls, g.response?.verdict));
        break;
      }
      case "S5": {
        mode = "scripted-attack";
        const calls = await safeS1();
        g = await ask("cosign", calls);
        printGuardian(g);
        const v = g.response?.verdict;
        print("  Dùng lại verdict của S1 cho lệnh khác (3 USDC thay vì 2):");
        outcomes.push(await executeBatch(chain, wallet, d.vault, await safeS1(3_000_000n), v));
        printVault(outcomes[0] as VaultOutcome);
        if (v) await waitPast(v.deadline);
        print("  Gửi đúng lệnh S1 nhưng verdict đã hết hạn:");
        outcomes.push(await executeBatch(chain, wallet, d.vault, calls, v));
        break;
      }
      case "S6": {
        if (!owner) throw new Error("S6 needs OWNER_PK");
        print(`  Chủ ví bấm tạm dừng: ${link(await setPaused(chain, owner, d.vault, true))}`);
        try {
          const calls = await safeS1();
          g = await ask("cosign", calls);
          printGuardian(g);
          print("  Agent thử lại S1 khi vault đang tạm dừng:");
          outcomes.push(await executeBatch(chain, wallet, d.vault, calls, g.response?.verdict));
        } finally {
          print(`  Chủ ví mở lại: ${link(await setPaused(chain, owner, d.vault, false))}`);
        }
        break;
      }
    }
    for (const o of id === "S5" ? outcomes.slice(1) : outcomes) printVault(o);

    const mismatch = compare(exp, g, outcomes);
    print(mismatch ? `  KHÔNG KHỚP bảng §10: ${mismatch}` : "  Khớp kết quả mong đợi trong bảng §10.");
    const r = g?.response;
    const attempt: Attempt = {
      at: new Date().toISOString(),
      scenario: id,
      name: NAMES[id],
      network: env.NETWORK,
      mode,
      ...(g
        ? {
            guardian: {
              endpoint: g.endpoint,
              status: g.status,
              ...(r
                ? {
                    risk: r.risk,
                    findings: RULE_IDS.filter((x) => r.findings.some((f) => f.ruleId === x)),
                    checkId: r.checkId,
                    explanationVi: r.explanation.vi,
                  }
                : {}),
              ...(g.paymentTx ? { paymentTx: g.paymentTx } : {}),
            },
          }
        : {}),
      vault: outcomes,
      expected: exp,
      matched: !mismatch,
      ...(mismatch ? { mismatch } : {}),
    };
    mkdirSync(join(AGENT_DIR, "data"), { recursive: true });
    appendFileSync(ATTEMPTS_FILE, `${JSON.stringify(attempt)}\n`);
    return attempt;
  }

  return { run, deployment: d, agent: agent.address };
}

export type { Hex };
