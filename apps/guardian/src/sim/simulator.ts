// Simulates an agent's batch on an Anvil fork of Fuji as if the vault executed it (docs/SPEC.md §7).
//
// Per check, under a global mutex: snapshot → impersonate the vault → gas buffer → read balances → send each
// call from the vault → receipts and logs → read balances → revert the snapshot → stop impersonating.
//
// Limitation: the calls run directly from the vault address, so the vault's own checks (policy, verdict, caps)
// are not executed here; POLICY_PRECHECK covers them statically. Anvil 1.8.5 accepts transactions from an
// impersonated contract account (no EIP-3607 rejection), so the vault keeps its code during the simulation and
// a target that calls back into the vault meets the real vault code, with the agent-path guards it implies.
import {
  getAddress,
  createPublicClient,
  createTestClient,
  erc20Abi,
  http,
  numberToHex,
  type Address,
  type BaseError,
  type Log,
  type PublicClient,
  type TestClient,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { fujiChain, type Call } from "@guardian402/shared";
import { decodeLogs, decodeRevert, extractRevertData, netTransferDelta } from "./decode.ts";
import { Mutex } from "./mutex.ts";
import type { SimResult, TokenDelta } from "./types.ts";

export type SimulatorOptions = {
  /** Anvil fork used for simulation. */
  forkRpcUrl: string;
  /**
   * Real Fuji RPC, for fork health (lag check and periodic reset). Leave undefined when the fork is also the
   * chain the vault runs on (local mode): resetting would erase the local deployment.
   */
  upstreamRpcUrl?: string;
  timeoutMs?: number;
  maxLagSeconds?: number;
  resetIntervalMs?: number;
  healthCheckIntervalMs?: number;
  /** Tokens whose balance is always read (e.g. USDC, mWAVAX), besides tracked tokens and call targets. */
  knownTokens?: readonly Address[];
  gasBuffer?: bigint;
};

const DEFAULTS = {
  timeoutMs: 800,
  maxLagSeconds: 120,
  resetIntervalMs: 5 * 60_000,
  healthCheckIntervalMs: 15_000,
  gasBuffer: 10n ** 18n, // 1 AVAX for gas, added to the vault's own balance inside the snapshot
};

type TokenMeta = { symbol: string; decimals: number };

const SIM_GAS = numberToHex(5_000_000n);

export class Simulator {
  readonly #opts: Required<Omit<SimulatorOptions, "upstreamRpcUrl" | "knownTokens">> &
    Pick<SimulatorOptions, "upstreamRpcUrl"> & { knownTokens: readonly Address[] };
  readonly #public: PublicClient;
  readonly #test: TestClient<"anvil">;
  readonly #upstream: PublicClient | undefined;
  readonly #mutex = new Mutex();
  readonly #meta = new Map<string, TokenMeta | null>();
  #lastHealthCheck = 0;
  #lastReset = Date.now();
  #lastForkBlock = 0n;

  constructor(options: SimulatorOptions) {
    this.#opts = { ...DEFAULTS, knownTokens: [], ...options };
    // Concurrent reads (balances, metadata) go out as one JSON-RPC batch.
    const transport = http(options.forkRpcUrl, { batch: { wait: 0 } });
    this.#public = createPublicClient({ chain: fujiChain, transport });
    this.#test = createTestClient({ chain: fujiChain, mode: "anvil", transport });
    this.#upstream = options.upstreamRpcUrl
      ? createPublicClient({ chain: fujiChain, transport: http(options.upstreamRpcUrl) })
      : undefined;
  }

  /**
   * Never throws: a timeout or any error becomes `success: false`, which the rules turn into
   * SIMULATION_FAILED. On timeout the run keeps the mutex until its snapshot is reverted.
   */
  async simulate(
    vault: Address,
    calls: readonly Call[],
    trackedTokens: readonly Address[] = [],
  ): Promise<SimResult> {
    const started = performance.now();
    const run = this.#mutex.run(() => this.#simulateLocked(vault, calls, trackedTokens, started));
    run.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.#opts.timeoutMs);
    });
    try {
      const outcome = await Promise.race([run, timeout]);
      if (outcome === "timeout") {
        return this.#failure(
          vault,
          calls,
          started,
          `simulation timed out after ${this.#opts.timeoutMs} ms`,
          true,
        );
      }
      return outcome;
    } catch (error) {
      return this.#failure(vault, calls, started, `simulation error: ${(error as Error).message}`, false);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Makes sure the vault exists on the fork and, with an upstream, that the fork is fresh (SPEC §7). */
  async ensureForkHealthy(vault: Address): Promise<void> {
    await this.#mutex.run(() => this.#checkFork(vault, true));
  }

  async #checkFork(vault: Address, force: boolean): Promise<void> {
    const now = Date.now();
    let hasCode = (await this.#public.getCode({ address: vault })) !== undefined;
    // The vault code check is cheap and runs every time; the upstream lag check is throttled.
    const checkUpstream = force || now - this.#lastHealthCheck >= this.#opts.healthCheckIntervalMs;
    if (this.#upstream && (checkUpstream || !hasCode)) {
      this.#lastHealthCheck = now;
      // Blocks Anvil mines itself carry wall-clock timestamps, so the lag is measured on the block the fork
      // was taken from: its Fuji timestamp versus the latest Fuji block.
      const info = (await this.#test.request({ method: "anvil_nodeInfo" } as never)) as {
        forkConfig?: { forkBlockNumber?: number | string };
      };
      const forkedAt = info.forkConfig?.forkBlockNumber;
      const latest = await this.#upstream.getBlock({ blockTag: "latest" });
      let lagSeconds = Number.POSITIVE_INFINITY;
      if (forkedAt !== undefined) {
        const forkBlock = await this.#upstream.getBlock({ blockNumber: BigInt(forkedAt) });
        lagSeconds = Number(latest.timestamp - forkBlock.timestamp);
      }
      const stale = now - this.#lastReset >= this.#opts.resetIntervalMs;
      if (!hasCode || lagSeconds > this.#opts.maxLagSeconds || stale) {
        await this.#test.reset({ jsonRpcUrl: this.#opts.upstreamRpcUrl, blockNumber: latest.number });
        this.#lastReset = Date.now();
        hasCode = (await this.#public.getCode({ address: vault })) !== undefined;
      }
    }
    if (!hasCode) throw new Error(`vault ${vault} has no code on the fork`);
  }

  async #simulateLocked(
    vault: Address,
    calls: readonly Call[],
    trackedTokens: readonly Address[],
    started: number,
  ): Promise<SimResult> {
    await this.#checkFork(vault, false);
    const forkBlock = await this.#public.getBlockNumber();
    this.#lastForkBlock = forkBlock;
    const snapshot = await this.#test.snapshot();
    // With automine on, Anvil answers receipts ~240 ms late; mining each call explicitly takes a few ms.
    // Automine is node configuration (not reverted by the snapshot), so it is restored in `finally`.
    const automine = await this.#test.getAutomine();
    if (automine) await this.#test.setAutomine(false);
    try {
      await this.#test.impersonateAccount({ address: vault });
      const own = await this.#public.getBalance({ address: vault });
      await this.#test.setBalance({ address: vault, value: own + this.#opts.gasBuffer });

      const candidates = unique([...trackedTokens, ...this.#opts.knownTokens, ...calls.map((c) => c.target)]);
      const before = await this.#balances(candidates, vault);
      const nativeBefore = await this.#public.getBalance({ address: vault });

      const logs: Log[] = [];
      let gasUsed = 0n;
      let gasCost = 0n;
      let failedCallIndex: number | undefined;
      let revertData: `0x${string}` | undefined;
      let sendError: string | undefined;
      for (const [index, call] of calls.entries()) {
        let hash: `0x${string}`;
        try {
          hash = await this.#send(vault, call);
        } catch (error) {
          failedCallIndex = index;
          revertData = extractRevertData(error);
          if (!revertData) sendError = (error as BaseError).shortMessage ?? String(error);
          break;
        }
        await this.#test.mine({ blocks: 1 }); // one block per call, so a revert can be replayed on block − 1
        const receipt = await this.#receipt(hash);
        gasUsed += receipt.gasUsed;
        gasCost += receipt.gasUsed * receipt.effectiveGasPrice;
        logs.push(...receipt.logs);
        if (receipt.status !== "success") {
          // Anvil mines the reverted transaction without its revert data; replay the call on the state just
          // before it (each transaction is mined in its own block) to get the data.
          failedCallIndex = index;
          revertData = await this.#replayRevert(vault, call, receipt.blockNumber - 1n);
          break;
        }
      }

      const decoded = decodeLogs(logs, vault);
      const touched = unique([...candidates, ...decoded.transfers.map((t) => t.token)]);
      const after = await this.#balances(touched, vault);
      const nativeAfter = await this.#public.getBalance({ address: vault });
      const tokenDeltas = await this.#deltas(touched, before, after, decoded.transfers, vault);
      const success = failedCallIndex === undefined;

      return {
        vault,
        calls: [...calls],
        success,
        timedOut: false,
        ...(failedCallIndex === undefined
          ? {}
          : {
              failedCallIndex,
              revertReason: sendError ?? decodeRevert(revertData),
              ...(revertData ? { revertData } : {}),
            }),
        gasUsed,
        forkBlock,
        tokenDeltas,
        nativeBefore,
        nativeAfter,
        // Native delta excludes gas: add back gasUsed × effectiveGasPrice of every receipt.
        nativeDelta: nativeAfter + gasCost - nativeBefore,
        approvals: decoded.approvals,
        approvalsForAll: decoded.approvalsForAll,
        transfers: decoded.transfers,
        durationMs: performance.now() - started,
      };
    } finally {
      await this.#test.revert({ id: snapshot });
      if (automine) await this.#test.setAutomine(true);
      await this.#test.stopImpersonatingAccount({ address: vault });
    }
  }

  /**
   * eth_sendTransaction from the impersonated vault with a fixed gas limit, so Anvil does not run an extra
   * estimation pass. Gas is excluded from the native delta, so the limit only needs to be high enough.
   */
  async #send(vault: Address, call: Call): Promise<Hash> {
    return this.#public.request({
      method: "eth_sendTransaction",
      params: [
        { from: vault, to: call.target, value: numberToHex(call.value), data: call.data, gas: SIM_GAS },
      ],
    } as never);
  }

  /** The call was just mined; retry briefly in case the node has not indexed the receipt yet. */
  async #receipt(hash: Hash): Promise<TransactionReceipt> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#public.getTransactionReceipt({ hash });
      } catch (error) {
        if (attempt >= 400) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  async #replayRevert(vault: Address, call: Call, blockNumber: bigint): Promise<`0x${string}` | undefined> {
    try {
      await this.#public.call({
        account: vault,
        to: call.target,
        value: call.value,
        data: call.data,
        blockNumber,
      });
      return undefined;
    } catch (error) {
      return extractRevertData(error);
    }
  }

  /** balanceOf for every candidate; addresses that are not ERC-20 tokens are left out. */
  async #balances(tokens: readonly Address[], account: Address): Promise<Map<string, bigint>> {
    const out = new Map<string, bigint>();
    await Promise.all(
      tokens.map(async (token) => {
        if (!(await this.#tokenMeta(token))) return;
        try {
          const balance = await this.#public.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account],
          });
          out.set(token.toLowerCase(), balance);
        } catch {
          // not an ERC-20 after all
        }
      }),
    );
    return out;
  }

  async #deltas(
    tokens: readonly Address[],
    before: Map<string, bigint>,
    after: Map<string, bigint>,
    transfers: SimResult["transfers"],
    vault: Address,
  ): Promise<TokenDelta[]> {
    const out: TokenDelta[] = [];
    for (const token of tokens) {
      const key = token.toLowerCase();
      const meta = await this.#tokenMeta(token);
      const afterBalance = after.get(key);
      if (!meta || afterBalance === undefined) continue;
      // A token first seen in the logs has no "before" read; reconstruct it from the net transfers.
      const beforeBalance = before.get(key) ?? afterBalance - netTransferDelta(transfers, token, vault);
      const delta = afterBalance - beforeBalance;
      if (delta === 0n && !before.has(key)) continue;
      out.push({ token, ...meta, before: beforeBalance, after: afterBalance, delta });
    }
    return out;
  }

  async #tokenMeta(token: Address): Promise<TokenMeta | null> {
    const key = token.toLowerCase();
    if (this.#meta.has(key)) return this.#meta.get(key) ?? null;
    let meta: TokenMeta | null;
    try {
      const [symbol, decimals] = await Promise.all([
        this.#public.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        this.#public.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      meta = { symbol, decimals };
    } catch {
      meta = null;
    }
    this.#meta.set(key, meta);
    return meta;
  }

  #failure(
    vault: Address,
    calls: readonly Call[],
    started: number,
    reason: string,
    timedOut: boolean,
  ): SimResult {
    return {
      vault,
      calls: [...calls],
      success: false,
      timedOut,
      revertReason: reason,
      gasUsed: 0n,
      forkBlock: this.#lastForkBlock,
      tokenDeltas: [],
      nativeBefore: 0n,
      nativeAfter: 0n,
      nativeDelta: 0n,
      approvals: [],
      approvalsForAll: [],
      transfers: [],
      durationMs: performance.now() - started,
    };
  }
}

/** Checksummed and de-duplicated. */
function unique(addresses: readonly Address[]): Address[] {
  return [...new Set(addresses.map((a) => getAddress(a)))];
}
