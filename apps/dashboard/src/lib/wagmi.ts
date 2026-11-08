// wagmi: one chain (Fuji), injected wallets only (Core, MetaMask). Reads go to RPC_URL, with the other public
// Fuji endpoints as fallback when it is remote (P14, packages/shared/src/rpc.ts).
import { createConfig, fallback, http, injected } from "wagmi";
import { rpcUrls } from "@guardian402/shared";
import { avalancheFuji } from "wagmi/chains";
import { RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [avalancheFuji],
  connectors: [injected()],
  transports: {
    [avalancheFuji.id]: fallback(
      rpcUrls(RPC_URL).map((u) => http(u, { retryCount: 1 })),
      { rank: false, retryCount: 1 },
    ),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
