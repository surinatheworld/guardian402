// wagmi: one chain (Fuji), injected wallets only (Core, MetaMask). Reads go to RPC_URL, with the other public
// Fuji endpoints as fallback when it is remote (P14, packages/shared/src/rpc.ts).
import { createConfig, injected } from "wagmi";
import { rpcTransport } from "@guardian402/shared";
import { avalancheFuji } from "wagmi/chains";
import { NETWORK, RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [avalancheFuji],
  connectors: NETWORK === "local" ? [] : [injected()],
  transports: {
    [avalancheFuji.id]: rpcTransport(RPC_URL),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
