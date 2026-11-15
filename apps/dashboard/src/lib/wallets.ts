// Which browser wallet to connect. wagmi discovers every installed wallet through EIP-6963 (each announces its
// name, icon and reverse-DNS id) next to the generic `injected()` connector. Core, the Avalanche wallet, comes
// first when it is installed; the generic connector is kept only when no wallet announced itself (an older wallet
// that only sets window.ethereum). Pure: no React, so it is tested without a browser.

/** Core's EIP-6963 reverse-DNS id (the Core browser extension). */
export const CORE_RDNS = "app.core.extension";
/** Where to get Core when no wallet is installed. */
export const CORE_INSTALL_URL = "https://core.app";

type ConnectorLike = { id: string; name: string };

export const isCore = (c: ConnectorLike) => c.id === CORE_RDNS || /^core\b/i.test(c.name.trim());

/** Wallets to offer, best first: Core, then the other announced wallets, else the generic injected one. */
export function walletOptions<T extends ConnectorLike>(connectors: readonly T[]): T[] {
  const announced = connectors.filter((c) => c.id !== "injected");
  const list = announced.length > 0 ? announced : connectors.filter((c) => c.id === "injected");
  const seen = new Set<string>();
  return list
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .sort((a, b) => Number(isCore(b)) - Number(isCore(a)));
}

/** "Core" or "MetaMask" for an announced wallet; the generic connector has no useful name. */
export const walletLabel = (c: ConnectorLike) => (c.id === "injected" ? "ví" : c.name);
