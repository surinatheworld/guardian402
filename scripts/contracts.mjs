#!/usr/bin/env node
// Deploy, seed, verify and hand off the contracts (docs/SPEC.md §4.8).
//
//   node scripts/contracts.mjs <deploy|seed|verify|handoff> <local|fuji>
//   node scripts/contracts.mjs redeploy-mocks <local|fuji>       (new mWAVAX + MockRouter; verified on fuji)
//   node scripts/contracts.mjs swap-router <local|fuji> <oldRouter>  (vault allowlist: old router → new router)
//   node scripts/contracts.mjs redeploy-vault <local|fuji>       (new AgentVault, old one emptied and paused; verified on fuji)
//
// Loads secrets from the repo-root .env.local into the environment of forge/cast (never on the command line),
// refuses to run unless the RPC answers chain id 43113 (Avalanche Fuji, or a fork of it), and in local mode
// prepares the Anvil fork: gas for the project keys, and test USDC for the owner minted through an
// impersonated USDC masterMinter (fork only; nothing like this is possible on Fuji).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const foundryBin = `${process.env.HOME}/.foundry/bin`;
if (!process.env.PATH?.includes(foundryBin)) {
  process.env.PATH = `${foundryBin}:${process.env.PATH || ""}`;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACTS = join(ROOT, "contracts");
const FUJI_CHAIN_ID = 43113;
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
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

const ACTIONS = ["deploy", "seed", "verify", "handoff", "redeploy-mocks", "swap-router", "redeploy-vault"];
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
  return run("cast", ["wallet", "address", "--private-key", process.env[key]], { capture: true });
}

async function prepareFork() {
  const ten = "0x8ac7230489e80000"; // 10 AVAX
  const owner = addressOf("OWNER_PK");
  // The self-hosted facilitator pays settlement gas on the fork too; its key is optional.
  const facilitator = /^0x[0-9a-fA-F]{64}$/.test(process.env.FACILITATOR_PK || "") ? ["FACILITATOR_PK"] : [];
  for (const key of ["DEPLOYER_PK", "OWNER_PK", "AGENT_PK", ...facilitator]) {
    await rpcCall("anvil_setBalance", [addressOf(key), ten]);
  }
  if (action !== "seed") return;
  // Fork only: test USDC through the impersonated masterMinter. The owner funds the vault (100 USDC); the agent
  // pays x402 fees from its own small balance (5 USDC), which a fresh key does not have on Fuji either.
  const agent = addressOf("AGENT_PK");
  const usdcOf = (who) =>
    BigInt(
      run("cast", ["call", USDC, "balanceOf(address)(uint256)", who, "--rpc-url", rpc], {
        capture: true,
      }).split(" ")[0],
    );
  const mints = [
    [owner, 100_000_000n],
    [agent, 5_000_000n],
  ].filter(([who, want]) => usdcOf(who) < want);
  if (!mints.length) return;
  const masterMinter = run("cast", ["call", USDC, "masterMinter()(address)", "--rpc-url", rpc], {
    capture: true,
  });
  await rpcCall("anvil_setBalance", [masterMinter, ten]);
  for (const who of [masterMinter, owner]) await rpcCall("anvil_impersonateAccount", [who]);
  run(
    "cast",
    [
      "send",
      USDC,
      "configureMinter(address,uint256)",
      owner,
      "1000000000",
      "--from",
      masterMinter,
      "--unlocked",
      "--rpc-url",
      rpc,
    ],
    { capture: true },
  );
  for (const [who, amount] of mints) {
    run(
      "cast",
      [
        "send",
        USDC,
        "mint(address,uint256)",
        who,
        amount.toString(),
        "--from",
        owner,
        "--unlocked",
        "--rpc-url",
        rpc,
      ],
      { capture: true },
    );
    console.log(`[contracts] fork: minted ${Number(amount) / 1e6} test USDC to ${who} (local fork only)`);
  }
  for (const who of [masterMinter, owner]) await rpcCall("anvil_stopImpersonatingAccount", [who]);
}

function verifyAll() {
  const a = JSON.parse(readFileSync(join(SHARED_ADDRESSES, "fuji.json"), "utf8"));
  const enc = (sig, ...args) => run("cast", ["abi-encode", sig, ...args], { capture: true });
  const contracts = [
    [
      "src/AgentVault.sol:AgentVault",
      a.vault,
      enc(
        "f(address,address,address)",
        a.owner,
        "0x0000000000000000000000000000000000000000",
        "0x0000000000000000000000000000000000000000",
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
