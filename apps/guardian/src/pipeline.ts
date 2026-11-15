// The check pipeline (docs/SPEC.md §6.3): validate → vault context → simulate → rules → explain →
// (cosign only) sign → store → respond. Used by /v1/check, /v1/cosign, /v1/demo/check and the eval runner.
import { randomBytes } from "node:crypto";
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  encodePacked,
  keccak256,
  toHex,
  type Address,
  type PublicClient,
} from "viem";
import { z } from "zod";
import {
  agentVaultAbi,
  checkRequestSchema,
  walletCheckRequestSchema,
  FUJI_CHAIN_ID,
  hashCalls,
  type Call,
  type CheckRequest,
  type CheckResponse,
  type Deployment,
  type WalletCheckRequest,
} from "@guardian402/shared";
import { buildContext, readOracle, readPolicy, withCode } from "./context.ts";
import { toDiff } from "./diff.ts";
import { explainInput } from "./explain-input.ts";
import type { Explainer } from "./explain/types.ts";
import type { ExplorerLookup } from "./explorer.ts";
import { aggregate, defaultRuleConfig, runRules, WALLET_RULE_IDS } from "./rules/index.ts";
import type { KnownContract, OracleReference, PolicySnapshot, RuleConfig } from "./rules/types.ts";
import type { VerdictSigner } from "./sign/index.ts";
import type { SimResult } from "./sim/types.ts";
import type { Store } from "./store.ts";

/** "wallet": a paid wallet check (POST /v1/wallet/check); the free wallet trial is stored as "demo". */
export type Endpoint = "check" | "cosign" | "demo" | "wallet";

/** The simulator as the pipeline sees it (the real one, or a stub in unit tests). */
export type SimulatorLike = {
  simulate(
    vault: Address,
    calls: readonly Call[],
    trackedTokens?: readonly Address[],
    opts?: { anyAccount?: boolean },
  ): Promise<SimResult>;
};

export type PipelineDeps = {
  chain: PublicClient;
  simulator: SimulatorLike;
  explainer: Explainer;
  signer: VerdictSigner;
  store?: Store;
  deployment: Deployment;
  knownContracts: Record<string, KnownContract>;
  /** Explorer facts for UNKNOWN_CONTRACT; used only when ruleConfig.explorerLookup.enabled. */
  explorer?: ExplorerLookup;
  ruleConfig?: RuleConfig;
  demoMode: boolean;
  /** Policy and oracle cache; the vault nonce is never cached (SPEC §6.3 step 2). */
  policyCacheMs?: number;
  now?: () => number;
};

export class InputError extends Error {
  constructor(readonly details: unknown) {
    super("invalid request");
  }
}

/**
 * The simulation could not run (fork or RPC error, timeout): the Guardian's failure, not a finding about the
 * batch. Nothing is scored, signed or stored; the API answers 503 and the payment is not settled. `detail` is
 * internal (it can hold RPC URLs): for the log, never for the caller.
 */
export class UnavailableError extends Error {
  constructor(readonly detail: string) {
    super("simulation unavailable");
  }
}

/** The node answered, and the answer is "no such function here": empty return data or a revert of getPolicy(). */
function isNotAVault(e: unknown): boolean {
  if (!(e instanceof BaseError)) return false;
  return (
    e.walk(
      (x) => x instanceof ContractFunctionZeroDataError || x instanceof ContractFunctionRevertedError,
    ) !== null
  );
}

type Cached<T> = { at: number; value: T };

export class Pipeline {
  readonly #d: PipelineDeps & { ruleConfig: RuleConfig; policyCacheMs: number; now: () => number };
  readonly #policy = new Map<string, Cached<PolicySnapshot>>();
  #oracle: Cached<OracleReference> | undefined;

  constructor(deps: PipelineDeps) {
    this.#d = { ruleConfig: defaultRuleConfig, policyCacheMs: 10_000, now: Date.now, ...deps };
  }

  /** Throws InputError on a body that does not match CheckRequest (→ 400, the payment is not settled). */
  parse(body: unknown): CheckRequest {
    const parsed = checkRequestSchema.safeParse(body);
    if (!parsed.success) throw new InputError(z.flattenError(parsed.error));
    return parsed.data;
  }

  async run(req: CheckRequest, endpoint: Endpoint): Promise<CheckResponse> {
    const d = this.#d;
    const started = performance.now();
    const calls: Call[] = req.calls.map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data }));
    const callsHash = hashCalls(calls);
    const checkId = keccak256(
      encodePacked(
        ["bytes32", "address", "uint256", "bytes16"],
        [callsHash, req.vault, BigInt(d.now()), toHex(randomBytes(16))],
      ),
    );

    // 2. Vault context. A vault this Guardian does not know still gets checked against its own policy.
    const [policy, oracle] = await Promise.all([this.#readPolicy(req.vault), this.#readOracle()]);
    // 3. Simulate (800 ms budget inside the simulator). A call that reverts is a result (SIMULATION_FAILED);
    // a simulation that could not run is not: without one there is nothing true to score or sign.
    const sim = await d.simulator.simulate(
      req.vault,
      calls,
      policy.tokens.map((t) => t.token),
    );
    if (sim.unavailable !== undefined) throw new UnavailableError(sim.unavailable);
    const touched = [
      ...calls.map((c) => c.target),
      ...sim.approvals.map((a) => a.spender),
      ...sim.transfers.map((t) => t.to),
    ];
    const contracts = await withCode(d.chain, touched);
    // Explorer facts only for the contracts UNKNOWN_CONTRACT can report: not known, not the vault itself.
    const unknown = contracts.filter(
      (a) => !d.knownContracts[a.toLowerCase()] && a.toLowerCase() !== req.vault.toLowerCase(),
    );
    const explorer =
      d.explorer && d.ruleConfig.explorerLookup.enabled && unknown.length > 0
        ? await d.explorer(unknown)
        : undefined;
    const ctx = buildContext({
      vault: req.vault,
      policy,
      knownContracts: d.knownContracts,
      contracts,
      ...(explorer ? { explorer } : {}),
      oracle,
      addressBook: d.store?.paidRecipients(req.vault, [policy.agent, policy.owner]) ?? [],
      demoMode: d.demoMode,
    });
    // 4. Rules (pure).
    const findings = runRules(sim, ctx, d.ruleConfig);
    const { risk, riskCode, score } = aggregate(findings, d.ruleConfig);
    // 5. Explain (1.5 s budget inside the explainer; falls back to templates).
    const explanation = await d.explainer.explain(explainInput(sim, findings, risk, ctx));
    // 6. Cosign: always the true risk, nonce read now (never cached).
    let verdict: CheckResponse["verdict"];
    if (endpoint === "cosign") {
      // The vault compares the deadline with block.timestamp. Base it on the later of chain time and this
      // machine's clock: a clock behind the chain would sign verdicts that are already short-lived, and an idle
      // fork's latest block can be minutes old.
      const [nonce, head] = await Promise.all([
        d.chain.readContract({ address: req.vault, abi: agentVaultAbi, functionName: "verdictNonce" }),
        d.chain.getBlock({ blockTag: "latest" }),
      ]);
      verdict = await d.signer.sign({
        vault: req.vault,
        chainId: FUJI_CHAIN_ID,
        callsHash,
        nonce,
        risk,
        checkId,
        now: Math.max(Number(head.timestamp) * 1000, d.now()),
      });
    }
    const res: CheckResponse = {
      checkId,
      risk,
      riskCode,
      score,
      findings,
      simulation: {
        success: sim.success,
        ...(sim.revertReason ? { revertReason: sim.revertReason } : {}),
        gasUsed: sim.gasUsed.toString(),
        forkBlock: sim.forkBlock.toString(),
      },
      diff: toDiff(sim),
      explanation,
      ...(verdict ? { verdict } : {}),
      latencyMs: Math.round(performance.now() - started),
      demoMode: d.demoMode,
    };
    // 7. Store.
    d.store?.insertCheck(endpoint, req.vault, callsHash, res, d.now());
    return res;
  }

  /** Throws InputError on a body that does not match WalletCheckRequest (→ 400, not settled). */
  parseWallet(body: unknown): WalletCheckRequest {
    const parsed = walletCheckRequestSchema.safeParse(body);
    if (!parsed.success) throw new InputError(z.flattenError(parsed.error));
    return parsed.data;
  }

  /**
   * A transaction from any wallet, before it signs (topic 14): simulate it from that address on the fork, score
   * it with the rules that need no vault policy (WALLET_RULE_IDS), explain it. No verdict: no vault enforces one.
   */
  async runWallet(req: WalletCheckRequest, endpoint: Endpoint): Promise<CheckResponse> {
    const d = this.#d;
    const started = performance.now();
    const calls: Call[] = req.calls.map((c) => ({ target: c.target, value: BigInt(c.value), data: c.data }));
    const callsHash = hashCalls(calls);
    const checkId = keccak256(
      encodePacked(
        ["bytes32", "address", "uint256", "bytes16"],
        [callsHash, req.wallet, BigInt(d.now()), toHex(randomBytes(16))],
      ),
    );
    const known = [d.deployment.usdc, d.deployment.mWAVAX];
    // The simulator tops the wallet up with gas: its real AVAX balance is read before.
    const [oracle, nativeBalance] = await Promise.all([
      this.#readOracle(),
      d.chain.getBalance({ address: req.wallet }),
    ]);
    const sim = await d.simulator.simulate(req.wallet, calls, known, { anyAccount: true });
    if (sim.unavailable !== undefined) throw new UnavailableError(sim.unavailable);
    const policy = walletPolicy(req.wallet, sim, nativeBalance);
    const contracts = await withCode(d.chain, [
      ...calls.map((c) => c.target),
      ...sim.approvals.map((a) => a.spender),
      ...sim.transfers.map((t) => t.to),
    ]);
    const unknown = contracts.filter(
      (a) => !d.knownContracts[a.toLowerCase()] && a.toLowerCase() !== req.wallet.toLowerCase(),
    );
    const explorer =
      d.explorer && d.ruleConfig.explorerLookup.enabled && unknown.length > 0
        ? await d.explorer(unknown)
        : undefined;
    const ctx = buildContext({
      vault: req.wallet,
      policy,
      knownContracts: d.knownContracts,
      contracts,
      ...(explorer ? { explorer } : {}),
      oracle,
      addressBook: req.addressBook ?? [],
      demoMode: d.demoMode,
      subject: "wallet",
    });
    const findings = runRules(sim, ctx, d.ruleConfig, WALLET_RULE_IDS);
    const { risk, riskCode, score } = aggregate(findings, d.ruleConfig);
    const explanation = await d.explainer.explain(explainInput(sim, findings, risk, ctx, "wallet"));
    const res: CheckResponse = {
      checkId,
      risk,
      riskCode,
      score,
      findings,
      simulation: {
        success: sim.success,
        ...(sim.revertReason ? { revertReason: sim.revertReason } : {}),
        gasUsed: sim.gasUsed.toString(),
        forkBlock: sim.forkBlock.toString(),
      },
      diff: toDiff(sim),
      explanation,
      latencyMs: Math.round(performance.now() - started),
      demoMode: d.demoMode,
    };
    d.store?.insertCheck(endpoint, req.wallet, callsHash, res, d.now());
    return res;
  }

  async #readPolicy(vault: Address): Promise<PolicySnapshot> {
    const key = vault.toLowerCase();
    const hit = this.#policy.get(key);
    if (hit && this.#d.now() - hit.at < this.#d.policyCacheMs) return hit.value;
    let value: PolicySnapshot;
    try {
      value = await readPolicy(this.#d.chain, vault);
    } catch (e) {
      // No contract there, or one without getPolicy(): the caller named something that is not an AgentVault.
      // That is their input (400, not charged), not a failure of the Guardian (502). RPC errors stay errors.
      if (isNotAVault(e))
        throw new InputError({
          formErrors: [],
          fieldErrors: { vault: ["not an AgentVault on this network"] },
        });
      throw e;
    }
    this.#policy.set(key, { at: this.#d.now(), value });
    return value;
  }

  async #readOracle(): Promise<OracleReference> {
    if (this.#oracle && this.#d.now() - this.#oracle.at < this.#d.policyCacheMs) return this.#oracle.value;
    const value = await readOracle(this.#d.chain, this.#d.deployment);
    this.#oracle = { at: this.#d.now(), value };
    return value;
  }
}

/**
 * The policy view a wallet check runs the rules against: the wallet itself, the tokens the simulation saw with
 * their balances before, its real AVAX balance, and no allowlist (so a large outflow is a drain to anyone).
 */
export function walletPolicy(wallet: Address, sim: SimResult, nativeBalance: bigint): PolicySnapshot {
  return {
    owner: wallet,
    agent: wallet,
    guardian: wallet,
    paused: false,
    verdictNonce: 0n,
    maxAgentRisk: 0,
    day: 0n,
    tokens: sim.tokenDeltas.map((t) => ({
      token: t.token,
      dailyCap: 0n,
      maxApproval: 0n,
      verdictThreshold: 0n,
      spentToday: 0n,
      balance: t.before,
    })),
    nativeDailyCap: 0n,
    nativeVerdictThreshold: 0n,
    nativeSpentToday: 0n,
    nativeBalance,
    targets: [],
    recipients: [],
  };
}
