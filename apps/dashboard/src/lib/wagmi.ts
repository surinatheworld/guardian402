// wagmi: one chain (Fuji), injected wallets only (Core, MetaMask). Reads go to RPC_URL.
import { createConfig, http, injected } from "wagmi";
import { avalancheFuji } from "wagmi/chains";
import { RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [avalancheFuji],
  connectors: [injected()],
  transports: { [avalancheFuji.id]: http(RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
