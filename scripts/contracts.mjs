#!/usr/bin/env node
// Deploy, seed, verify and hand off the contracts (docs/SPEC.md §4.8).
//
//   node scripts/contracts.mjs <deploy|seed|verify|handoff> <local|fuji>
//   node scripts/contracts.mjs redeploy-mocks <local|fuji>       (new mWAVAX + MockRouter; verified on fuji)
//   node scripts/contracts.mjs swap-router <local|fuji> <oldRouter>  (vault allowlist: old router → new router)
//   node scripts/contracts.mjs redeploy-vault <local|fuji>       (new AgentVault, old one emptied and paused; verified on fuji)
//   node scripts/contracts.mjs deploy-factory <local|fuji>       (VaultFactory with the GUARDIAN_SIGNER_PK signer; verified on fuji)
//   node scripts/contracts.mjs adopt local                       (fork only: hand the seeded Fuji vault to OWNER_PK)
//
// Loads secrets from the repo-root .env.local into the environment of forge/cast (never on the command line),
// refuses to run unless the RPC answers chain id 43113 (Avalanche Fuji, or a fork of it), and in local mode
// prepares the Anvil fork: gas for the project keys, and test USDC for the owner minted through an
// impersonated USDC masterMinter (fork only; nothing like this is possible on Fuji).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "./foundry-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "contracts");
const FUJI_CHAIN_ID = 43113;
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const TEN_AVAX = "0x8ac7230489e80000";
// Routescan's documented Foundry verifier pattern with Fuji's chain id; no API key needed ("verifyContract").
// forge may only write inside contracts/, so scripts use contracts/deployments; the committed copy is shared.
const SHARED_ADDRESSES = join(ROOT, "packages/shared/src/addresses");
const FORGE_DEPLOYMENTS = join(CONTRACTS, "deployments");
const ROUTESCAN_FUJI = "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan";
const VERIFY_FLAGS = [
  "--verifier-url",
  ROUTESCAN_FUJI,
  "--etherscan-api-key",
  "verifyContract",
  "--chain",
  "43113",
];

const ACTIONS = [
  "deploy",
  "seed",
  "verify",
  "handoff",
  "redeploy-mocks",
  "swap-router",
  "redeploy-vault",
  "deploy-factory",
  "adopt",
];
const [action, network, extraArg] = process.argv.slice(2);
if (!ACTIONS.includes(action) || !["local", "fuji"].includes(network)) {
  fail(`usage: node scripts/contracts.mjs <${ACTIONS.join("|")}> <local|fuji> [oldRouter]`);
}
if (action === "swap-router" && !/^0x[0-9a-fA-F]{40}$/.test(extraArg || ""))
  fail("swap-router needs the old router address");
if (existsSync(join(ROOT, ".env.local"))) process.loadEnvFile(join(ROOT, ".env.local"));
process.env.NETWORK = network;
for (const key of ["DEPLOYER_PK", "OWNER_PK", "AGENT_PK", "GUARDIAN_SIGNER_PK"]) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(process.env[key] || "")) fail(`${key} is missing in .env.local`);
}
const rpc =
  network === "local"
    ? process.env.FORK_RPC_URL || "http://127.0.0.1:8545"
    : process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";

const chainId = await rpcCall("eth_chainId", []);
if (Number(chainId) !== FUJI_CHAIN_ID)
  fail(`RPC ${rpc} is chain ${Number(chainId)}, not Fuji (43113). Refusing.`);
if (action === "handoff" && network !== "fuji") fail("handoff runs on fuji only");
if (action === "adopt") {
  // Impersonation only exists on Anvil, but refuse anything that is not this machine anyway.
  if (network !== "local" || !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(rpc))
    fail("adopt runs on the local Anvil fork only");
  await adoptOnFork();
  process.exit(0);
}

if (network === "local" && (action === "deploy" || action === "seed")) await prepareFork();
// Fresh clone: contracts/deployments is git-ignored, and forge cannot create it.
mkdirSync(FORGE_DEPLOYMENTS, { recursive: true });
if (action !== "deploy") syncAddresses("toForge");

if (action === "verify") {
  if (network !== "fuji") fail("verify runs on fuji only");
  verifyAll();
} else if (action === "redeploy-mocks") {
  // Verify in the same run, right after broadcast, before anything else looks the new addresses up.
  const verify = network === "fuji" ? ["--verify", ...VERIFY_FLAGS] : [];
  run("forge", [
    "script",
    "script/RedeployMocks.s.sol:RedeployMocks",
    "--sig",
    "deploy()",
    "--rpc-url",
    rpc,
    "--broadcast",
    "--slow",
    ...verify,
  ]);
  syncAddresses("toShared");
} else if (action === "redeploy-vault") {
  const verify = network === "fuji" ? ["--verify", ...VERIFY_FLAGS] : [];
  run("forge", [
    "script",
    "script/RedeployVault.s.sol:RedeployVault",
    "--rpc-url",
    rpc,
    "--broadcast",
    "--slow",
    ...verify,
  ]);
  const file = join(SHARED_ADDRESSES, `${network}.json`);
  const merged = {
    ...JSON.parse(readFileSync(file, "utf8")),
    ...JSON.parse(readFileSync(join(FORGE_DEPLOYMENTS, `${network}-vault.json`), "utf8")),
  };
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  syncAddresses("toForge");
  console.log(
    `[contracts] new vault ${merged.vault} written to packages/shared/src/addresses/${network}.json`,
  );
  if (network === "fuji") {
    // The fork tests and `local` mode use the seeded Fuji deployment: keep local.json on the same vault (P14).
    const localFile = join(SHARED_ADDRESSES, "local.json");
    const local = JSON.parse(readFileSync(localFile, "utf8"));
    const next = { ...local, vault: merged.vault, startBlock: merged.startBlock };
    writeFileSync(localFile, `${JSON.stringify(next, null, 2)}\n`);
    console.log("[contracts] local.json follows the new vault; run `pnpm known-contracts` next");
  }
} else if (action === "deploy-factory") {
  const verify = network === "fuji" ? ["--verify", ...VERIFY_FLAGS] : [];
  run("forge", [
    "script",
    "script/DeployFactory.s.sol:DeployFactory",
    "--rpc-url",
    rpc,
    "--broadcast",
    "--slow",
    ...verify,
  ]);
  const deployed = JSON.parse(readFileSync(join(FORGE_DEPLOYMENTS, `${network}-factory.json`), "utf8"));
  // The fork tests and `local` mode use the Fuji deployment, so a Fuji factory is also the local one.
  for (const name of network === "fuji" ? ["fuji", "local"] : ["local"]) {
    const file = join(SHARED_ADDRESSES, `${name}.json`);
    const next = { ...JSON.parse(readFileSync(file, "utf8")), ...deployed };
    writeFileSync(
      file,
      `${JSON.stringify(next, null, 2)}
`,
    );
    console.log(
      `[contracts] factory ${deployed.factory} written to packages/shared/src/addresses/${name}.json`,
    );
  }
} else if (action === "swap-router") {
  run("forge", [
    "script",
    "script/RedeployMocks.s.sol:RedeployMocks",
    "--sig",
    "swapAllowlist(address)",
    extraArg,
    "--rpc-url",
    rpc,
    "--broadcast",
    "--slow",
  ]);
} else {
  const script = { deploy: "Deploy", seed: "Seed", handoff: "HandOff" }[action];
  run("forge", ["script", `script/${script}.s.sol:${script}`, "--rpc-url", rpc, "--broadcast", "--slow"]);
  if (action === "deploy") syncAddresses("toShared");
}

// ------------------------------------------------------------------ helpers

/**
 * Fork only. `local.json` mirrors the seeded Fuji deployment, so a fork of Fuji already has the vault, the
 * mocks and the policy. A teammate with fresh keys owns none of it: impersonate the owners on the fork, move the
 * vault to OWNER_PK (Ownable2Step) and the DEMO mocks to DEPLOYER_PK, so `seed local` can then set the agent,
 * the guardian, the oracle price and the funding. Only the fork's state changes: nothing on Fuji, no tracked
 * file, no new contract.
 */
async function adoptOnFork() {
  const shared = JSON.parse(readFileSync(join(SHARED_ADDRESSES, "local.json"), "utf8"));
  const vault = shared.vault;
  const code = await rpcCall("eth_getCode", [vault, "latest"]);
  if (!code || code === "0x")
    fail(`no AgentVault at ${vault} on the fork: start it from Fuji at or after block ${shared.startBlock}`);
  const ownerOf = (c) => forkCall(c, "function owner() view returns (address)", "owner");
  // The DEMO mocks (single-step Ownable): Seed sets the oracle price and tops up the router from DEPLOYER_PK.
  const deployer = addressOf("DEPLOYER_PK");
  for (const [name, mock] of [
    ["MockOracle", shared.oracle],
    ["mWAVAX", shared.mWAVAX],
    ["MockRouter", shared.router],
  ]) {
    const was = await ownerOf(mock);
    if (was.toLowerCase() === deployer.toLowerCase()) continue;
    await asImpersonated([was], () =>
      forkSend(was, mock, "function transferOwnership(address newOwner)", "transferOwnership", [deployer]),
    );
    console.log(`[contracts] fork: ${name} now owned by DEPLOYER_PK ${deployer} (fork only)`);
  }
  const owner = addressOf("OWNER_PK");
  const current = await ownerOf(vault);
  if (current.toLowerCase() === owner.toLowerCase()) {
    console.log(`[contracts] fork: OWNER_PK ${owner} already owns the vault ${vault}`);
    return;
  }
  await asImpersonated([current, owner], async () => {
    await forkSend(current, vault, "function transferOwnership(address newOwner)", "transferOwnership", [
      owner,
    ]);
    await forkSend(owner, vault, "function acceptOwnership()", "acceptOwnership");
  });
  const after = await ownerOf(vault);
  if (after.toLowerCase() !== owner.toLowerCase()) fail("fork: ownership transfer failed");
  console.log(`[contracts] fork: vault ${vault} now owned by OWNER_PK ${owner} (was ${current}; fork only)`);
}

// Fork helpers on plain JSON-RPC (no cast): they work where native Foundry binaries are blocked, e.g. by
// Windows Smart App Control. Impersonation only exists on Anvil.
async function forkCall(to, signature, functionName, args = []) {
  const abi = parseAbi([signature]);
  const data = await rpcCall("eth_call", [
    { to, data: encodeFunctionData({ abi, functionName, args }) },
    "latest",
  ]);
  return decodeFunctionResult({ abi, functionName, data });
}

async function forkSend(from, to, signature, functionName, args = []) {
  const abi = parseAbi([signature]);
  const hash = await rpcCall("eth_sendTransaction", [
    { from, to, data: encodeFunctionData({ abi, functionName, args }) },
  ]);
  // Anvil answers with the hash before the block is mined (a fork waits on upstream reads): poll the receipt.
  let receipt = null;
  for (let i = 0; i < 60 && !receipt; i++) {
    receipt = await rpcCall("eth_getTransactionReceipt", [hash]);
    if (!receipt) await new Promise((r) => setTimeout(r, 500));
  }
  if (!receipt) fail(`fork: ${functionName} from ${from} was not mined within 30 s`);
  if (receipt.status !== "0x1") fail(`fork: ${functionName} from ${from} reverted`);
}

/** Give `accounts` gas, impersonate them for `fn`, and always stop impersonating. */
async function asImpersonated(accounts, fn) {
  for (const who of accounts) {
    await rpcCall("anvil_setBalance", [who, TEN_AVAX]);
    await rpcCall("anvil_impersonateAccount", [who]);
  }
  try {
    await fn();
  } finally {
    for (const who of accounts) await rpcCall("anvil_stopImpersonatingAccount", [who]);
  }
}

function syncAddresses(direction) {
  const file = `${network}.json`;
  if (direction === "toShared") {
    const json = JSON.parse(readFileSync(join(FORGE_DEPLOYMENTS, file), "utf8"));
    mkdirSync(SHARED_ADDRESSES, { recursive: true });
    writeFileSync(join(SHARED_ADDRESSES, file), `${JSON.stringify(json, null, 2)}\n`);
    console.log(`[contracts] addresses written to packages/shared/src/addresses/${file}`);
  } else {
    if (!existsSync(join(SHARED_ADDRESSES, file)))
      fail(`no packages/shared/src/addresses/${file}; run deploy:${network} first`);
    mkdirSync(FORGE_DEPLOYMENTS, { recursive: true });
    copyFileSync(join(SHARED_ADDRESSES, file), join(FORGE_DEPLOYMENTS, file));
  }
}

function fail(message) {
  console.error(`[contracts] ${message}`);
  process.exit(1);
}

function run(cmd, args, { capture = false } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: CONTRACTS,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (res.error) fail(`${cmd} failed to start: ${res.error.message}`);
  if (res.status !== 0)
    fail(`${cmd} ${args[0]} exited with ${res.status}${capture ? `\n${res.stderr}` : ""}`);
  return capture ? res.stdout.trim() : "";
}

async function rpcCall(method, params, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) fail(`${method}: ${body.error.message}`);
      return body.result;
    } catch (err) {
      if (attempt === retries) fail(`cannot reach ${rpc}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

function addressOf(key) {
  return privateKeyToAccount(process.env[key]).address;
}

async function prepareFork() {
  const owner = addressOf("OWNER_PK");
  // The self-hosted facilitator pays settlement gas on the fork too; its key is optional.
  const facilitator = /^0x[0-9a-fA-F]{64}$/.test(process.env.FACILITATOR_PK || "") ? ["FACILITATOR_PK"] : [];
  for (const key of ["DEPLOYER_PK", "OWNER_PK", "AGENT_PK", ...facilitator]) {
    await rpcCall("anvil_setBalance", [addressOf(key), TEN_AVAX]);
  }
  if (action !== "seed") return;
  // Fork only: test USDC through the impersonated masterMinter. The owner funds the vault (100 USDC); the agent
  // pays x402 fees from its own small balance (5 USDC), which a fresh key does not have on Fuji either.
  const agent = addressOf("AGENT_PK");
  const usdcOf = (who) =>
    forkCall(USDC, "function balanceOf(address) view returns (uint256)", "balanceOf", [who]);
  const mints = [];
  for (const [who, want] of [
    [owner, 100_000_000n],
    [agent, 5_000_000n],
  ]) {
    if ((await usdcOf(who)) < want) mints.push([who, want]);
  }
  if (!mints.length) return;
  const masterMinter = await forkCall(USDC, "function masterMinter() view returns (address)", "masterMinter");
  await asImpersonated([masterMinter, owner], async () => {
    await forkSend(
      masterMinter,
      USDC,
      "function configureMinter(address minter, uint256 minterAllowedAmount) returns (bool)",
      "configureMinter",
      [owner, 1_000_000_000n],
    );
    for (const [who, amount] of mints) {
      await forkSend(owner, USDC, "function mint(address to, uint256 amount) returns (bool)", "mint", [
        who,
        amount,
      ]);
      console.log(`[contracts] fork: minted ${Number(amount) / 1e6} test USDC to ${who} (local fork only)`);
    }
  });
}

function verifyAll() {
  const a = JSON.parse(readFileSync(join(SHARED_ADDRESSES, "fuji.json"), "utf8"));
  const enc = (sig, ...args) => run("cast", ["abi-encode", sig, ...args], { capture: true });
  const contracts = [
    [
      "src/AgentVault.sol:AgentVault",
      a.vault,
      // Vaults deployed by Deploy/RedeployVault since SPEC §4.9 take an empty Config as the fourth argument.
      enc(
        "f(address,address,address,(uint8,(address,uint256,uint256,uint256,uint256,uint256)[],uint256,uint256,uint256,uint256,(address,bytes4[])[],address[]))",
        a.owner,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
        "(0,[],0,0,0,0,[],[])",
      ),
    ],
    [
      "src/mocks/MockERC20.sol:MockERC20",
      a.mWAVAX,
      enc("f(string,string,uint8,address)", "Mock Wrapped AVAX", "mWAVAX", "18", a.deployer),
    ],
    ["src/mocks/MockOracle.sol:MockOracle", a.oracle, enc("f(address,uint256)", a.deployer, "25000000")],
    [
      "src/mocks/MockRouter.sol:MockRouter",
      a.router,
      enc("f(address,address,address,address)", a.usdc, a.mWAVAX, a.oracle, a.deployer),
    ],
  ];
  if (a.factory) {
    const guardian = privateKeyToAccount(process.env.GUARDIAN_SIGNER_PK).address;
    contracts.push(["src/VaultFactory.sol:VaultFactory", a.factory, enc("f(address)", guardian)]);
  }
  if (a.cancunSmoke) contracts.push(["src/smoke/CancunSmoke.sol:CancunSmoke", a.cancunSmoke, "0x"]);
  for (const [id, address, args] of contracts) {
    console.log(`[contracts] verifying ${id} at ${address}`);
    const flags = [
      "verify-contract",
      address,
      id,
      "--verifier-url",
      ROUTESCAN_FUJI,
      "--etherscan-api-key",
      "verifyContract",
      "--chain",
      "43113",
      "--watch",
    ];
    if (args !== "0x") flags.push("--constructor-args", args);
    run("forge", flags);
  }
}
