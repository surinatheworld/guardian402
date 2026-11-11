"use client";
import { Toast } from "@heroui/react/toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { VaultProvider } from "@/lib/vault-context";
import { wagmiConfig } from "@/lib/wagmi";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <VaultProvider>
          {children}
          <Toast.Provider placement="bottom end" />
        </VaultProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
