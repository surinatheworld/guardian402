"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useMe } from "./account";
import { deployment } from "./config";
import { resolveVault } from "./vault-selection";

type VaultContextValue = { address: Address; ready: boolean; setVault: (address: string) => void };
const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setSelected(sessionStorage.getItem("guardian402.selectedVault"));
    } catch {
      // Storage is optional; the active selection still works for this page session.
    }
    setReady(true);
  }, []);
  const vaults = me.data?.vaults ?? [];
  const current = resolveVault(vaults, selected);
  return (
    <VaultContext.Provider
      value={{
        address: current?.address ?? deployment.vault,
        ready,
        setVault: (address) => {
          setSelected(address);
          try {
            sessionStorage.setItem("guardian402.selectedVault", address);
          } catch {
            /* Storage is optional. */
          }
        },
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useSelectedVault() {
  const context = useContext(VaultContext);
  if (!context) throw new Error("VaultProvider is missing");
  return context;
}
