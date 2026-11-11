// `pnpm bench:guardian [runs]`: latency of the Guardian pipeline on the free DEMO endpoint (/v1/demo/check),
// with the S1 batch (approve 2 USDC + swap through pool 0) against the configured vault. Nothing is paid,
// signed or sent on-chain. Needs a Guardian with DEMO_MODE=true on GUARDIAN_URL (default http://127.0.0.1:4402).
import { encodeFunctionData, erc20Abi } from "viem";
import {
  DEMO_ORACLE_PRICE,
  getAddresses,
  minOutUsdcToWavax,
  mockRouterAbi,
  parseNetwork,
} from "@guardian402/shared";

const runs = Number(process.argv[2] ?? 10);
const url = (process.env.GUARDIAN_URL ?? "http://127.0.0.1:4402").replace(/\/$/, "");
const d = getAddresses(parseNetwork(process.env.NETWORK ?? "fuji"));
const calls = [
  {
    target: d.usdc,
    value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [d.router, 2_000_000n] }),
  },
  {
    target: d.router,
    value: "0",
    data: encodeFunctionData({
      abi: mockRouterAbi,
      functionName: "swapExactIn",
      args: [d.usdc, d.mWAVAX, 2_000_000n, minOutUsdcToWavax(2_000_000n, DEMO_ORACLE_PRICE), 0, d.vault],
    }),
  },
];

const times: number[] = [];
const risks = new Map<string, number>();
for (let i = 0; i < runs; i++) {
  const t = performance.now();
  const res = await fetch(`${url}/v1/demo/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: 43113, vault: d.vault, calls }),
  });
  const body = (await res.json()) as { risk?: string; error?: string };
  times.push(performance.now() - t);
  const key = res.ok ? (body.risk ?? "?") : `HTTP ${res.status}`;
  risks.set(key, (risks.get(key) ?? 0) + 1);
}
times.sort((a, b) => a - b);
const pct = (p: number) => Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))] ?? 0);
console.log(`[bench] ${runs} checks on ${url} (vault ${d.vault})`);
console.log(`[bench] p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · max ${Math.round(times.at(-1) ?? 0)} ms`);
console.log(`[bench] results ${JSON.stringify(Object.fromEntries(risks))}`);
