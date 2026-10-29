#!/usr/bin/env node
// `pnpm fork`: Anvil fork of Avalanche Fuji on http://127.0.0.1:8545 (docs/SPEC.md §7).
//
// Runs `anvil --fork-url $FUJI_RPC_URL --chain-id 43113 --port 8545 --hardfork cancun`.
// Fuji runs the Cancun EVM (ACP-131); Anvil's default (latest) would simulate newer rules, and its EIP-2935
// blockhash system call reads an account Fuji does not have, from the upstream, on every mined block.
// ANVIL_RUNNER selects how: `native` (anvil on PATH), `docker` (official Foundry image),
// or `auto` (native if `anvil --version` works, else Docker). Docker is the fallback for
// machines where the native binary cannot run, e.g. Windows Smart App Control blocks anvil.exe.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry:v1.8.5";
const PORT = "8545";
const CHAIN_ID = "43113";
const HARDFORK = "cancun";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const forkUrl = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const runner = process.env.ANVIL_RUNNER || "auto";
const anvilArgs = ["--fork-url", forkUrl, "--chain-id", CHAIN_ID, "--port", PORT, "--hardfork", HARDFORK];

const nativeWorks = () => spawnSync("anvil", ["--version"], { stdio: "ignore" }).status === 0;

let cmd;
let args;
if (runner === "native" || (runner === "auto" && nativeWorks())) {
  cmd = "anvil";
  args = anvilArgs;
} else if (runner === "docker" || runner === "auto") {
  cmd = "docker";
  args = [
    "run",
    "--rm",
    "--init",
    "--name",
    "guardian402-fork",
    "-p",
    `127.0.0.1:${PORT}:${PORT}`,
    "--entrypoint",
    "anvil",
    FOUNDRY_IMAGE,
    ...anvilArgs,
    "--host",
    "0.0.0.0",
  ];
} else {
  console.error(`Unknown ANVIL_RUNNER "${runner}" (expected auto, native or docker).`);
  process.exit(1);
}

console.log(
  `[fork] ${cmd === "anvil" ? "native anvil" : `docker ${FOUNDRY_IMAGE}`} → http://127.0.0.1:${PORT}`,
);
const child = spawn(cmd, args, { stdio: "inherit" });
child.on("error", (err) => {
  console.error(`[fork] failed to start ${cmd}: ${err.message}`);
  process.exit(1);
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
