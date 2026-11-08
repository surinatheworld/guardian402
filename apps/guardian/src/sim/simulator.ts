// Simulates an agent's batch on an Anvil fork of Fuji as if the vault executed it (docs/SPEC.md §7).
//
// Per check, under a global mutex: snapshot → impersonate the vault → gas buffer → read balances → send each
// call from the vault → receipts and logs → read balances → revert the snapshot → stop impersonating.
// Fork health (lag, periodic reset) runs in the background via start(); a request only runs local checks.
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
  type Hex,
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
  /** Period of the background fork maintenance started by `start()`. */
  healthCheckIntervalMs?: number;
  /** Called when a background maintenance run fails; the next run retries. */
  onMaintenanceError?: (error: unknown) => void;
  /** Called after each fork reset, outside the mutex, e.g. to warm the fork's cache with a typical batch. */
  onReset?: () => void;
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
/** Lower-case address → storage slots read by the simulated transactions. */
type TouchedState = Map<string, Set<Hex>>;

const SIM_GAS = numberToHex(5_000_000n);
const MAX_PINNED = 100_000;

export class Simulator {
  readonly #opts: Required<
    Omit<SimulatorOptions, "upstreamRpcUrl" | "knownTokens" | "onMaintenanceError" | "onReset">
  > &
    Pick<SimulatorOptions, "upstreamRpcUrl" | "onMaintenanceError" | "onReset"> & {
      knownTokens: readonly Address[];
    };
  readonly #public: PublicClient;
  readonly #test: TestClient<"anvil">;
  readonly #upstream: PublicClient | undefined;
  readonly #mutex = new Mutex();
  readonly #meta = new Map<string, TokenMeta | null>();
  /** Accounts (`address`) and slots (`address:slot`) already read outside a snapshot, see #pin. */
  readonly #pinned = new Set<string>();
  #lastReset: number;
  #lastForkBlock = 0n;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: SimulatorOptions) {
    this.#opts = { ...DEFAULTS, knownTokens: [], ...options };
    // With an upstream, the first check resets the fork: a previous process may have died mid-simulation and
    // left its snapshot unreverted (e.g. an approval still in place).
    this.#lastReset = options.upstreamRpcUrl ? Number.NEGATIVE_INFINITY : Date.now();
    // Concurrent reads (balances, metadata) go out as one JSON-RPC batch.
    const transport = http(options.forkRpcUrl, { batch: { wait: 0 } });
    this.#public = createPublicClient({ chain: fujiChain, transport });
    this.#test = createTestClient({ chain: fujiChain, mode: "anvil", transport });
    this.#upstream = options.upstreamRpcUrl
      ? createPublicClient({ chain: fujiChain, transport: http(options.upstreamRpcUrl) })
      : undefined;
  }

  /** Simulations running or waiting for the fork (one runs at a time). */
  get queueDepth(): number {
    return this.#mutex.size;
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

  /**
   * Startup check (SPEC §7): with an upstream, reset the fork if it lags Fuji, if the reset interval has passed,
   * or if it was never reset by this process; then the vault must have code on the fork.
   */
  async ensureForkHealthy(vault: Address): Promise<void> {
    await this.#mutex.run(async () => {
      await this.#maintain();
      await this.#checkVault(vault);
    });
  }

  /**
   * Runs fork maintenance in the background (only with an upstream): every `healthCheckIntervalMs`, under the
   * mutex, the lag and interval checks of `ensureForkHealthy`. Kept out of `simulate()` so that a request never
   * waits for upstream calls or a reset.
   */
  start(): void {
    if (!this.#upstream || this.#timer) return;
    this.#timer = setInterval(() => {
      this.#mutex
        .run(() => this.#maintain())
        .catch((error: unknown) => this.#opts.onMaintenanceError?.(error));
    }, this.#opts.healthCheckIntervalMs);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** With an upstream: reset when the fork lags Fuji by more than `maxLagSeconds` or is due for a reset. */
  async #maintain(): Promise<void> {
    if (!this.#upstream) return;
    // Blocks Anvil mines itself carry wall-clock timestamps, so the lag is measured on the block the fork was
    // taken from: its Fuji timestamp versus the latest Fuji block.
    const forkedAt = await this.#forkBlockNumber();
    const latest = await this.#upstream.getBlock({ blockTag: "latest" });
    let lagSeconds = Number.POSITIVE_INFINITY;
    if (forkedAt !== undefined) {
      const forkBlock = await this.#upstream.getBlock({ blockNumber: forkedAt });
      lagSeconds = Number(latest.timestamp - forkBlock.timestamp);
    }
    const due = Date.now() - this.#lastReset >= this.#opts.resetIntervalMs;
    if (lagSeconds > this.#opts.maxLagSeconds || due) await this.#reset(latest.number);
  }

  async #reset(blockNumber?: bigint): Promise<void> {
    if (!this.#upstream) return;
    const target = blockNumber ?? (await this.#upstream.getBlockNumber());
    await this.#test.reset({ jsonRpcUrl: this.#opts.upstreamRpcUrl, blockNumber: target });
    this.#lastReset = Date.now();
    this.#pinned.clear(); // the reset emptied the fork's cache
    // We hold the mutex here: let the callback queue its work after it.
    if (this.#opts.onReset) setImmediate(this.#opts.onReset);
  }

  /** Per simulation, with local calls only unless a reset is needed: the vault must have code on the fork. */
  async #checkVault(vault: Address): Promise<void> {
    if (this.#lastReset === Number.NEGATIVE_INFINITY) await this.#reset(); // first use, no startup check ran
    let hasCode = (await this.#public.getCode({ address: vault })) !== undefined;
    if (!hasCode && this.#upstream) {
      await this.#reset();
      hasCode = (await this.#public.getCode({ address: vault })) !== undefined;
    }
    if (!hasCode) throw new Error(`vault ${vault} has no code on the fork`);
    // Mining directly on the fork block makes Anvil fetch from the upstream every time the snapshot is reverted
    // to it (~40 ms per mined block); with one local block on top, mining stays local (~1 ms).
    const [head, forkedAt] = await Promise.all([this.#public.getBlockNumber(), this.#forkBlockNumber()]);
    if (head === forkedAt) await this.#test.mine({ blocks: 1 });
  }

  /** The block the fork was taken from, or undefined when the node is not a fork. */
  async #forkBlockNumber(): Promise<bigint | undefined> {
    const info = (await this.#test.request({ method: "anvil_nodeInfo" } as never)) as {
      forkConfig?: { forkBlockNumber?: number | string };
    };
    const forkedAt = info.forkConfig?.forkBlockNumber;
    return forkedAt === undefined ? undefined : BigInt(forkedAt);
  }

  async #simulateLocked(
    vault: Address,
    calls: readonly Call[],
    trackedTokens: readonly Address[],
    started: number,
  ): Promise<SimResult> {
    await this.#checkVault(vault);
    const forkBlock = await this.#public.getBlockNumber();
    this.#lastForkBlock = forkBlock;
    const snapshot = await this.#test.snapshot();
    const touchedState: TouchedState = new Map();
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

      const logs: Log[][] = []; // per call
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
        await this.#collectPrestate(hash, touchedState);
        gasUsed += receipt.gasUsed;
        gasCost += receipt.gasUsed * receipt.effectiveGasPrice;
        logs.push(receipt.logs);
        if (receipt.status !== "success") {
          // Anvil mines the reverted transaction without its revert data; replay the call on the state just
          // before it (each transaction is mined in its own block) to get the data.
          failedCallIndex = index;
          revertData = await this.#replayRevert(vault, call, receipt.blockNumber - 1n);
          break;
        }
      }

      const perCall = logs.map((l, i) => decodeLogs(l, vault, i));
      const decoded = {
        transfers: perCall.flatMap((x) => x.transfers),
        approvals: perCall.flatMap((x) => x.approvals),
        approvalsForAll: perCall.flatMap((x) => x.approvalsForAll),
      };
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
      // Queued behind this run, so it never delays the result.
      this.#mutex.run(() => this.#pin(touchedState)).catch(() => undefined);
    }
  }

  /** Adds the accounts and storage slots a mined transaction read (prestateTracer) to `into`. */
  async #collectPrestate(hash: Hash, into: TouchedState): Promise<void> {
    try {
      const prestate = (await this.#test.request({
        method: "debug_traceTransaction",
        params: [hash, { tracer: "prestateTracer" }],
      } as never)) as Record<string, { storage?: Record<string, Hex> }>;
      for (const [address, account] of Object.entries(prestate)) {
        const slots = into.get(address) ?? new Set<Hex>();
        for (const slot of Object.keys(account.storage ?? {})) slots.add(slot as Hex);
        into.set(address, slots);
      }
    } catch {
      // Only a cache optimisation (see #pin): the simulation result does not depend on it.
    }
  }

  /**
   * Anvil drops upstream state fetched inside a snapshot when the snapshot is reverted, so every simulation
   * would fetch the same accounts and slots again (~40 ms each). Reading them once outside any snapshot keeps
   * them in the fork's cache for later runs. Pure reads: the fork state does not change.
   */
  async #pin(touched: TouchedState): Promise<void> {
    if (this.#pinned.size > MAX_PINNED) this.#pinned.clear();
    const reads: Promise<unknown>[] = [];
    for (const [address, slots] of touched) {
      const account = address as Address;
      if (!this.#pinned.has(address)) {
        this.#pinned.add(address);
        reads.push(this.#public.getBalance({ address: account }), this.#public.getCode({ address: account }));
      }
      for (const slot of slots) {
        const key = `${address}:${slot}`;
        if (this.#pinned.has(key)) continue;
        this.#pinned.add(key);
        reads.push(this.#public.getStorageAt({ address: account, slot }));
      }
    }
    await Promise.all(reads); // one JSON-RPC batch
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
