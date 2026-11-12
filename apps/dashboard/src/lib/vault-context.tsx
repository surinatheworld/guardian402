"use client";
// Which vault the dashboard shows. A signed-in owner sees their own vaults; "Xem két demo" (DEMO, for anyone
// without a wallet, e.g. the judges) shows the seeded demo vault read-only. Both choices last for the browser
// session only.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useMe } from "./account";
import { deployment } from "./config";
import { resolveVault } from "./vault-selection";

const SELECTED_KEY = "guardian402.selectedVault";
const DEMO_KEY = "guardian402.viewDemo";

type VaultContextValue = {
  address: Address;
  ready: boolean;
  /** True while the shown vault is the DEMO vault (chosen with "Xem két demo", or the account has none). */
  viewingDemo: boolean;
  /** The visitor chose "Xem két demo" (as opposed to simply having no vault of their own yet). */
  demoChosen: boolean;
  /** The account owns at least one linked vault. */
  hasOwnVault: boolean;
  setVault: (address: string) => void;
  setViewingDemo: (on: boolean) => void;
};
const VaultContext = createContext<VaultContextValue | null>(null);

const read = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null; // storage is optional
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage is optional */
  }
};

export function VaultProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSelected(read(SELECTED_KEY));
    setDemo(read(DEMO_KEY) === "1");
    setReady(true);
  }, []);
  const vaults = me.data?.vaults ?? [];
  const current = resolveVault(vaults, selected);
  const viewingDemo = demo || !current;
  return (
    <VaultContext.Provider
      value={{
        address: viewingDemo || !current ? deployment.vault : current.address,
        ready,
        viewingDemo,
        demoChosen: demo,
        hasOwnVault: vaults.length > 0,
        setVault: (address) => {
          setSelected(address);
          setDemo(false);
          write(SELECTED_KEY, address);
          write(DEMO_KEY, null);
        },
        setViewingDemo: (on) => {
          setDemo(on);
          write(DEMO_KEY, on ? "1" : null);
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
