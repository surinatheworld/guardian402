// Fresh local fork for the eval (docs/SPEC.md §12): reset to the latest Fuji block, deploy the mocks and a vault
// from fixed eval keys (nonce forced to 0, so every run gets the same addresses), and seed them with the values
// of SPEC §4.8. Test USDC comes from the impersonated USDC masterMinter, which is possible on a fork only.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  toBytes,
  toFunctionSelector,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentVaultAbi, fujiChain, FUJI_RPC_URL, USDC_FUJI, type Deployment } from "@guardian402/shared";

export const ROOT = join(import.meta.dirname, "../..");

/** Fixed eval keys: derived from public labels, so anyone can reproduce the addresses. Fork only, never funded. */
export const evalKey = (label: string): Hex => keccak256(toBytes(`guardian402-eval-${label}`));
export const EVAL = {
  deployer: privateKeyToAccount(evalKey("deployer")),
  stranger: privateKeyToAccount(evalKey("stranger")), // deploys the "unknown" contracts
  agent: privateKeyToAccount(evalKey("agent")).address,
  guardian: evalKey("guardian"),
  treasury: privateKeyToAccount(evalKey("treasury")).address,
  attacker: "0x000000000000000000000000000000000000a77A" as Address,
  sink: "0x000000000000000000000000000000000000dEaD" as Address,
};

// SPEC §4.8 seed values (same as contracts/script/Seed.s.sol).
export const SEED = {
  usdcDailyCap: 20_000_000n,
  usdcMaxApproval: 10_000_000n,
  usdcVerdictThreshold: 1_000_000n,
  nativeDailyCap: 10n ** 17n,
  nativeVerdictThreshold: 10n ** 16n,
  vaultUsdc: 50_000_000n,
  oraclePrice: 25_000_000n,
  routerInventory: 1_000n * 10n ** 18n,
};

type Artifact = { abi: Abi; bytecode: { object: Hex } };
function artifact(name: string): Artifact {
  const path = join(ROOT, "contracts/out", `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) throw new Error(`${path} not found: run \`cd contracts && forge build\` first`);
  return JSON.parse(readFileSync(path, "utf8")) as Artifact;
}

const usdcAdminAbi = parseAbi([
  "function masterMinter() view returns (address)",
  "function configureMinter(address minter, uint256 allowance) returns (bool)",
  "function mint(address to, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const mintAbi = parseAbi(["function mint(address to, uint256 amount)"]);

export type EvalFork = {
  client: PublicClient;
  rpc: (method: string, params?: unknown[]) => Promise<unknown>;
  deployment: Deployment;
  unknownRouter: Address;
  unknownToken: Address;
  forkBlock: bigint;
};

export async function setUpFork(forkRpcUrl: string, upstreamRpcUrl = FUJI_RPC_URL): Promise<EvalFork> {
  const client = createPublicClient({ chain: fujiChain, transport: http(forkRpcUrl) }) as PublicClient;
  const rpc = (method: string, params: unknown[] = []) => client.request({ method, params } as never);
  const chainId = await client.getChainId();
  if (chainId !== 43113) throw new Error(`fork chain id ${chainId}, expected 43113`);

  // Fresh fork at the latest Fuji block. Anything another process deployed on this fork is erased.
  await rpc("anvil_reset", [{ forking: { jsonRpcUrl: upstreamRpcUrl } }]);
  // The Guardian's simulator turns automine off inside its snapshots; a process killed mid-simulation leaves it
  // off, and a reset does not turn it back on.
  await rpc("evm_setAutomine", [true]);
  const forkBlock = await client.getBlockNumber();

  const tenAvax = `0x${(10n ** 19n).toString(16)}`;
  for (const a of [EVAL.deployer.address, EVAL.stranger.address]) {
    await rpc("anvil_setBalance", [a, tenAvax]);
    await rpc("anvil_setNonce", [a, "0x0"]);
  }
  const wallet = (account: typeof EVAL.deployer) =>
    createWalletClient({ account, chain: fujiChain, transport: http(forkRpcUrl) });
  const deployer = wallet(EVAL.deployer);
  const stranger = wallet(EVAL.stranger);
  const owner = EVAL.deployer.address;
  const usdc = USDC_FUJI.address as Address;

  const deploy = async (w: typeof deployer, name: string, args: unknown[]): Promise<Address> => {
    const a = artifact(name);
    const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args });
    const r = await client.waitForTransactionReceipt({ hash });
    if (!r.contractAddress || r.status !== "success") throw new Error(`deploy ${name} failed`);
    return r.contractAddress;
  };
  const send = async (hash: Promise<Hex>) => {
    const r = await client.waitForTransactionReceipt({ hash: await hash });
    if (r.status !== "success") throw new Error(`transaction ${r.transactionHash} reverted`);
  };

  const vault = await deploy(deployer, "AgentVault", [
    owner,
    EVAL.agent,
    privateKeyToAccount(EVAL.guardian).address,
    // Empty Config (SPEC §4.10): the policy is set below with the owner setters, as the seed script does.
    {
      maxAgentRisk: 0,
      tokens: [],
      nativeDailyCap: 0n,
      nativeVerdictThreshold: 0n,
      nativeMaxPerTx: 0n,
      nativeBudget: 0n,
      targets: [],
      recipients: [],
    },
  ]);
  const mWAVAX = await deploy(deployer, "MockERC20", ["Mock Wrapped AVAX", "mWAVAX", 18, owner]);
  const oracle = await deploy(deployer, "MockOracle", [owner, SEED.oraclePrice]);
  const router = await deploy(deployer, "MockRouter", [usdc, mWAVAX, oracle, owner]);
  // Contracts the Guardian has never heard of, deployed by someone else (UNKNOWN_CONTRACT cases).
  const unknownRouter = await deploy(stranger, "MockRouter", [usdc, mWAVAX, oracle, EVAL.stranger.address]);
  const unknownToken = await deploy(stranger, "MockERC20", [
    "Free Airdrop",
    "FREE",
    18,
    EVAL.stranger.address,
  ]);

  await send(
    deployer.writeContract({
      address: mWAVAX,
      abi: mintAbi,
      functionName: "mint",
      args: [router, SEED.routerInventory],
    }),
  );
  await send(
    deployer.writeContract({
      address: mWAVAX,
      abi: mintAbi,
      functionName: "mint",
      args: [unknownRouter, SEED.routerInventory],
    }),
  );

  const v = { address: vault, abi: agentVaultAbi } as const;
  const swapSelector = toFunctionSelector(
    "function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint8 poolId, address to)",
  );
  await send(
    deployer.writeContract({
      ...v,
      functionName: "setTokenPolicy",
      args: [usdc, true, SEED.usdcDailyCap, SEED.usdcMaxApproval, SEED.usdcVerdictThreshold],
    }),
  );
  await send(
    deployer.writeContract({
      ...v,
      functionName: "setNativePolicy",
      args: [SEED.nativeDailyCap, SEED.nativeVerdictThreshold],
    }),
  );
  await send(deployer.writeContract({ ...v, functionName: "setAllowedTarget", args: [router, true] }));
  await send(
    deployer.writeContract({ ...v, functionName: "setAllowedSelector", args: [router, swapSelector, true] }),
  );
  await send(deployer.writeContract({ ...v, functionName: "setAllowedRecipient", args: [router, true] }));
  await send(
    deployer.writeContract({ ...v, functionName: "setAllowedRecipient", args: [EVAL.treasury, true] }),
  );

  // Test USDC through the impersonated masterMinter (fork only).
  const masterMinter = await client.readContract({
    address: usdc,
    abi: usdcAdminAbi,
    functionName: "masterMinter",
  });
  await rpc("anvil_setBalance", [masterMinter, tenAvax]);
  await rpc("anvil_impersonateAccount", [masterMinter]);
  const minterWallet = createWalletClient({
    account: masterMinter,
    chain: fujiChain,
    transport: http(forkRpcUrl),
  });
  await send(
    minterWallet.writeContract({
      address: usdc,
      abi: usdcAdminAbi,
      functionName: "configureMinter",
      args: [owner, 10n ** 15n],
    }),
  );
  await rpc("anvil_stopImpersonatingAccount", [masterMinter]);
  await send(
    deployer.writeContract({
      address: usdc,
      abi: usdcAdminAbi,
      functionName: "mint",
      args: [vault, SEED.vaultUsdc],
    }),
  );

  const deployment: Deployment = {
    network: "local",
    chainId: 43113,
    startBlock: Number(forkBlock),
    deployer: owner,
    owner,
    usdc,
    mWAVAX,
    oracle,
    router,
    vault,
  };
  return { client, rpc, deployment, unknownRouter, unknownToken, forkBlock };
}

/** Case setup (docs/SPEC.md §12): balances and approvals applied to the fresh fork before the case runs. */
export type Setup = {
  vaultUsdc?: string | undefined;
  vaultAvax?: string | undefined;
  approvals?: { spender: Address; amount: bigint }[] | undefined;
};

export async function applySetup(f: EvalFork, setup: Setup): Promise<void> {
  const { client, rpc, deployment: d } = f;
  const usdc = d.usdc;
  const asVault = createWalletClient({
    account: d.vault,
    chain: fujiChain,
    transport: http(client.transport.url),
  });
  const send = async (hash: Promise<Hex>) => {
    const r = await client.waitForTransactionReceipt({ hash: await hash });
    if (r.status !== "success") throw new Error(`setup transaction ${r.transactionHash} reverted`);
  };
  const deployer = createWalletClient({
    account: EVAL.deployer,
    chain: fujiChain,
    transport: http(client.transport.url),
  });
  const needsVault = setup.approvals?.length || setup.vaultUsdc !== undefined;
  if (needsVault) {
    await rpc("anvil_setBalance", [d.vault, `0x${(10n ** 18n).toString(16)}`]);
    await rpc("anvil_impersonateAccount", [d.vault]);
  }
  if (setup.vaultUsdc !== undefined) {
    const want = BigInt(setup.vaultUsdc);
    const have = await client.readContract({
      address: usdc,
      abi: usdcAdminAbi,
      functionName: "balanceOf",
      args: [d.vault],
    });
    if (want > have)
      await send(
        deployer.writeContract({
          address: usdc,
          abi: usdcAdminAbi,
          functionName: "mint",
          args: [d.vault, want - have],
        }),
      );
    if (want < have)
      await send(
        asVault.writeContract({
          address: usdc,
          abi: usdcAdminAbi,
          functionName: "transfer",
          args: [EVAL.sink, have - want],
        }),
      );
  }
  for (const a of setup.approvals ?? [])
    await send(
      asVault.writeContract({
        address: usdc,
        abi: usdcAdminAbi,
        functionName: "approve",
        args: [a.spender, a.amount],
      }),
    );
  if (needsVault) await rpc("anvil_stopImpersonatingAccount", [d.vault]);
  // Last, so the gas money used above does not count: the vault's real AVAX balance for the case.
  await rpc("anvil_setBalance", [d.vault, `0x${BigInt(setup.vaultAvax ?? "0").toString(16)}`]);
}
