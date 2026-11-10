// Side-effect import: put ~/.foundry/bin (where foundryup installs forge, cast and anvil) on PATH when it exists
// and is not there yet. Uses the platform's PATH delimiter (";" on Windows) and os.homedir(), because HOME is
// often unset in PowerShell and Windows PATH entries are not ":"-separated.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const foundryBin = join(homedir(), ".foundry", "bin");
const entries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p).replace(/[\\/]+$/, "");
if (existsSync(foundryBin) && !entries.some((p) => norm(p) === norm(foundryBin))) {
  process.env.PATH = [foundryBin, ...entries].join(delimiter);
}
