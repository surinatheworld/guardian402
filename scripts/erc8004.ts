// `pnpm erc8004:fuji` (bonus B1, docs/SPEC.md §13.1): register the Guardian on the official ERC-8004
// IdentityRegistry on Avalanche Fuji and store its registration file as the agentURI (base64 JSON data URI).
//
// Safe to run again: it reuses the agentId in packages/shared/src/addresses/erc8004.fuji.json while the
// deployer still owns it, and sends setAgentURI only when the file changed. The deployer key (DEPLOYER_PK in
// the repo-root .env.local) owns the agent NFT and pays gas. Optional GUARDIAN_PUBLIC_URL: the public base URL
// of the Guardian API to advertise; without it the file points at the GitHub repository.
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import {
  ERC8004_FUJI,
  FUJI_CHAIN_ID,
  getErc8004Record,
  guardianRegistration,
  identityRegistryAbi,
  rpcTransport,
  toDataUri,
  txUrl,
  type Erc8004Record,
} from "@guardian402/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = join(ROOT, "packages/shared/src/addresses/erc8004.fuji.json");

if (process.argv[2] !== "fuji") fail("usage: tsx scripts/erc8004.ts fuji");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));
const pk = process.env.DEPLOYER_PK;
if (!/^0x[0-9a-fA-F]{64}$/.test(pk ?? "")) fail("DEPLOYER_PK is missing in .env.local");
const rpc = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";

const account = privateKeyToAccount(pk as Hex);
const transport = rpcTransport(rpc);
const pub = createPublicClient({ chain: avalancheFuji, transport });
const wallet = createWalletClient({ chain: avalancheFuji, transport, account });
const registry = ERC8004_FUJI.identityRegistry;

if ((await pub.getChainId()) !== FUJI_CHAIN_ID) fail(`RPC ${rpc} is not Avalanche Fuji (43113). Refusing.`);
const code = await pub.getCode({ address: registry });
if (!code || code === "0x") fail(`no contract at the IdentityRegistry ${registry} on Fuji`);

// 1. agentId: reuse the recorded one while the deployer still owns it, else register a new agent.
const previous = getErc8004Record();
let agentId: bigint | undefined;
let registerTx = previous?.registerTx as Hex | undefined;
if (previous) {
  const owner = await pub
    .readContract({
      address: registry,
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [BigInt(previous.agentId)],
    })
    .catch(() => undefined);
  if (owner?.toLowerCase() === account.address.toLowerCase()) agentId = BigInt(previous.agentId);
  else
    console.log(
      `[erc8004] recorded agentId ${previous.agentId} is not owned by the deployer; registering again`,
    );
}
if (agentId === undefined) {
  registerTx = await wallet.writeContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "register",
    args: [],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: registerTx });
  if (receipt.status !== "success") fail(`register() reverted: ${txUrl(registerTx)}`);
  const [event] = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: "Registered" });
  if (!event) fail(`no Registered event in ${txUrl(registerTx)}`);
  agentId = event.args.agentId;
  console.log(`[erc8004] registered agentId ${agentId}: ${txUrl(registerTx)}`);
}

// 2. agentURI: the registration file, bound to this agentId.
const agentURI = toDataUri(
  guardianRegistration(Number(agentId), process.env.GUARDIAN_PUBLIC_URL || undefined),
);
const current = await pub.readContract({
  address: registry,
  abi: identityRegistryAbi,
  functionName: "tokenURI",
  args: [agentId],
});
let uriTx = previous?.uriTx as Hex | undefined;
if (current !== agentURI || !uriTx) {
  uriTx = await wallet.writeContract({
    address: registry,
    abi: identityRegistryAbi,
    functionName: "setAgentURI",
    args: [agentId, agentURI],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: uriTx });
  if (receipt.status !== "success") fail(`setAgentURI reverted: ${txUrl(uriTx)}`);
  console.log(`[erc8004] agentURI set: ${txUrl(uriTx)}`);
} else {
  console.log("[erc8004] agentURI already up to date");
}

const stored = await pub.readContract({
  address: registry,
  abi: identityRegistryAbi,
  functionName: "tokenURI",
  args: [agentId],
});
if (stored !== agentURI) fail("tokenURI on chain does not match the registration file");

const record: Erc8004Record = {
  network: "fuji",
  identityRegistry: registry,
  agentId: Number(agentId),
  owner: account.address,
  registerTx: registerTx as Hex,
  uriTx,
  agentURI,
};
writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  `[erc8004] agentId ${agentId} owned by ${account.address}; record written to packages/shared/src/addresses/erc8004.fuji.json`,
);

function fail(message: string): never {
  console.error(`[erc8004] ${message}`);
  process.exit(1);
}
