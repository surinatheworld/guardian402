#!/usr/bin/env bash
# ==============================================================================
# Guardian402 — local stack runner (macOS, Linux, Windows Git Bash)
# ==============================================================================
# Usage:
#   ./run-local.sh                 # start fork, facilitator, Guardian, agent API and dashboard
#   ./run-local.sh fuji            # the same stack on real Avalanche Fuji (vault, payments, wallet); the Anvil
#                                  # fork is only the Guardian's simulator, reset from Fuji
#   ./run-local.sh setup           # first-time setup: .env files, dependencies, contract build
#   ./run-local.sh scenario <S0..S6|all>
#   ./run-local.sh stop            # stop what this script started
#   ./run-local.sh status
#
# Local mode runs on an Anvil fork of Fuji and uses the seeded Fuji deployment that already exists there
# (packages/shared/src/addresses/local.json mirrors fuji.json). It never deploys contracts and never edits
# tracked files: `contracts.mjs adopt local` hands the vault on the fork to the keys in .env.local through
# Anvil impersonation, then `seed:local` sets the agent, the guardian and test USDC. Fork state only.
#
# Windows: run it from Git Bash (`./run-local.sh`). `pnpm local` from cmd/PowerShell may pick WSL's bash.
# ==============================================================================

set -eo pipefail

export PATH="$HOME/.foundry/bin:$PATH"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

STATE_DIR="$ROOT_DIR/.run-local"
LOG_DIR="$STATE_DIR/logs"
PID_FILE="$STATE_DIR/pids"
FORK_URL="http://127.0.0.1:8545"
PORTS=(8545 4022 4402 4403 3000)

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1"; }

is_windows() {
  case "$(uname -s)" in MINGW* | MSYS* | CYGWIN*) return 0 ;; *) return 1 ;; esac
}

# 0 when something listens on 127.0.0.1:<port> (or on all interfaces). Node is used because lsof/ss/netstat
# differ per platform.
port_in_use() {
  node -e '
    const net = require("net");
    const port = Number(process.argv[1]);
    const tryHost = (host) => new Promise((ok) => {
      const s = net.createServer();
      s.once("error", () => ok(true));
      s.listen({ port, host }, () => s.close(() => ok(false)));
    });
    (async () => {
      const inUse = (await tryHost("127.0.0.1")) || (await tryHost(undefined));
      process.exit(inUse ? 0 : 1);
    })();
  ' "$1"
}

# A PID from .run-local/pids may be stale (reboot, PID reuse): only touch it if it still runs node, pnpm, a
# shell or docker, i.e. something this script could have started.
ours() {
  local exe
  if is_windows; then
    exe=$(cat "/proc/$1/exename" 2>/dev/null || true)
  else
    exe=$(ps -o comm= -p "$1" 2>/dev/null || true)
  fi
  [[ "$exe" =~ (node|pnpm|bash|sh|docker)(\.exe)?$ ]]
}

# Kill a process and its children (pnpm → node → …). Only PIDs this script started are ever passed here.
kill_tree() {
  local pid="$1"
  if is_windows; then
    local winpid
    winpid=$(cat "/proc/$pid/winpid" 2>/dev/null || true)
    if [ -n "$winpid" ]; then taskkill //F //T //PID "$winpid" >/dev/null 2>&1 || true; fi
    kill "$pid" 2>/dev/null || true
  else
    local child
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

# start_bg <name> <command...>: run in the background, log to .run-local/logs/<name>.log, remember the PID.
start_bg() {
  local name="$1"
  shift
  mkdir -p "$LOG_DIR"
  "$@" >"$LOG_DIR/$name.log" 2>&1 &
  echo "$! $name" >>"$PID_FILE"
}

stop_services() {
  if [ -f "$PID_FILE" ]; then
    log_info "Stopping the services started by run-local.sh..."
    while read -r pid name; do
      if [ -n "$pid" ] && ours "$pid"; then
        kill_tree "$pid"
        log_info "  stopped $name ($pid)"
      fi
    done <"$PID_FILE"
    rm -f "$PID_FILE"
  fi
  # The Docker runner of scripts/fork.mjs names its container; a killed `docker run` client can leave it running.
  if command -v docker >/dev/null 2>&1 && docker ps -q --filter "name=^guardian402-fork$" 2>/dev/null | grep -q .; then
    docker rm -f guardian402-fork >/dev/null 2>&1 || true
    log_info "  removed the guardian402-fork container"
  fi
  local busy=()
  for port in "${PORTS[@]}"; do port_in_use "$port" && busy+=("$port"); done
  if [ "${#busy[@]}" -gt 0 ]; then
    log_warn "Still in use (not started by this script, left alone): ${busy[*]}"
  else
    log_success "Stopped."
  fi
}

wait_for_url() {
  local url="$1" name="$2" max="${3:-30}" count=0
  log_info "Waiting for $name ($url)..."
  until curl -s -f "$url" >/dev/null 2>&1; do
    count=$((count + 1))
    if [ "$count" -ge "$max" ]; then
      log_err "$name is not ready after ${max}s. Log: $LOG_DIR"
      return 1
    fi
    sleep 1
  done
  log_success "$name is ready"
}

rpc_ready() {
  curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$1" 2>/dev/null | grep -q '"result"'
}

wait_for_rpc() {
  local url="$1" name="$2" max="${3:-30}" count=0
  log_info "Waiting for $name ($url)..."
  until rpc_ready "$url"; do
    count=$((count + 1))
    if [ "$count" -ge "$max" ]; then
      log_err "$name does not answer after ${max}s. Log: $LOG_DIR/fork.log"
      return 1
    fi
    sleep 1
  done
  log_success "$name is ready"
}

check_prerequisites() {
  log_info "Checking prerequisites..."
  command -v node >/dev/null 2>&1 || { log_err "Node.js >= 22.13 is required."; exit 1; }
  command -v pnpm >/dev/null 2>&1 || { log_err "pnpm is required: corepack enable pnpm"; exit 1; }
  command -v curl >/dev/null 2>&1 || { log_err "curl is required."; exit 1; }
  if ! command -v cast >/dev/null 2>&1; then
    log_err "Foundry (cast, forge) is required: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    exit 1
  fi
  if ! anvil --version >/dev/null 2>&1 && ! docker info >/dev/null 2>&1; then
    log_warn "Neither a working anvil nor a running Docker daemon was found; the fork will not start."
  fi
}

cmd_setup() {
  check_prerequisites
  echo -e "\n${BOLD}=== 1. Environment files ===${NC}"
  node scripts/init-local-env.mjs
  echo -e "\n${BOLD}=== 2. Dependencies ===${NC}"
  [ -d node_modules ] || pnpm install
  [ -f contracts/lib/openzeppelin-contracts/package.json ] || git submodule update --init --recursive
  echo -e "\n${BOLD}=== 3. Contracts ===${NC}"
  (cd contracts && forge build)
  echo -e "\n${GREEN}${BOLD}Setup done.${NC} Start everything with: ${BOLD}./run-local.sh${NC}\n"
}

cmd_start() {
  check_prerequisites
  if [ ! -f ".env.local" ] || [ ! -f "apps/dashboard/.env.local" ] || [ ! -d contracts/out ]; then
    log_warn "First run: running setup..."
    cmd_setup
  fi
  if [ -f "$PID_FILE" ]; then stop_services; fi

  local busy=()
  for port in "${PORTS[@]}"; do port_in_use "$port" && busy+=("$port"); done
  if [ "${#busy[@]}" -gt 0 ]; then
    log_err "Ports already in use: ${busy[*]}. Stop those programs first (run-local.sh never kills processes it did not start)."
    exit 1
  fi

  echo -e "\n${BOLD}=== Starting the Guardian402 local stack ===${NC}\n"
  mkdir -p "$LOG_DIR"
  : >"$PID_FILE"
  trap 'echo; log_info "Shutting down..."; stop_services' EXIT
  trap 'exit 130' INT TERM

  # Everything below talks to the fork, whatever NETWORK/CHAIN_RPC_URL say in .env.local (env wins over the file).
  export NETWORK=local CHAIN_RPC_URL="$FORK_URL" FACILITATOR_RPC_URL="$FORK_URL" DEMO_MODE=true
  export FACILITATOR_URL="http://127.0.0.1:4022"
  # Empty URLs (not unset: Next then ignores apps/dashboard/.env.local) = public endpoint. This host's browser
  # uses 127.0.0.1; a browser on another machine (tunnel) uses the dashboard's same-origin proxy /api/rpc,
  # /api/guardian, /api/agent-control (apps/dashboard: next.config.ts and src/app/api), which assumes the fork
  # on :8545. From another machine /api/rpc is read-only and scenario runs are rate-limited
  # (DEMO_SCENARIOS_PUBLIC=false: only the demo vault's signed-in owner).
  export NEXT_PUBLIC_NETWORK=local NEXT_PUBLIC_RPC_URL="" NEXT_PUBLIC_GUARDIAN_URL="" NEXT_PUBLIC_AGENT_URL=""

  log_info "[1/5] Anvil fork of Fuji on :8545"
  start_bg fork node scripts/fork.mjs
  wait_for_rpc "$FORK_URL" "Anvil fork" 120

  log_info "Handing the seeded Fuji vault on the fork to the keys in .env.local (fork state only)..."
  node scripts/contracts.mjs adopt local
  pnpm seed:local

  log_info "[2/5] x402 facilitator on :4022"
  start_bg facilitator pnpm facilitator
  wait_for_url "http://127.0.0.1:4022/supported" "x402 facilitator" 60

  log_info "[3/5] Guardian API on :4402"
  start_bg guardian pnpm dev:guardian
  wait_for_url "http://127.0.0.1:4402/v1/health" "Guardian API" 90

  log_info "[4/5] Agent control API on :4403"
  start_bg agent pnpm dev:agent
  wait_for_url "http://127.0.0.1:4403/health" "Agent control API" 60

  log_info "[5/5] Dashboard on :3000"
  start_bg dashboard pnpm dev:dashboard
  wait_for_url "http://localhost:3000" "Dashboard" 120

  echo -e "\n${GREEN}${BOLD}All services are running.${NC}"
  echo -e "  Dashboard     http://localhost:3000"
  echo -e "  Guardian API  http://127.0.0.1:4402/v1/health"
  echo -e "  Facilitator   http://127.0.0.1:4022/supported"
  echo -e "  Agent API     http://127.0.0.1:4403/health"
  echo -e "  Anvil fork    $FORK_URL"
  echo -e "Logs: $LOG_DIR. Press ${BOLD}Ctrl+C${NC} to stop everything.\n"
  wait
}

# Real Fuji: chain reads, x402 settlement and wallet transactions go to FUJI_RPC_URL; the vault and the
# VaultFactory are the deployed ones (packages/shared/src/addresses/fuji.json). The Anvil fork on :8545 is
# only where the Guardian simulates a batch before scoring it (SPEC §1); it is reset from Fuji, never adopted
# or seeded. Needs FUJI_RPC_URL, GUARDIAN_SIGNER_PK and FACILITATOR_PK (with a little AVAX) in .env.local.
cmd_fuji() {
  check_prerequisites
  [ -f ".env.local" ] || { log_err "No .env.local: run ./run-local.sh setup first."; exit 1; }
  local fuji
  fuji=$(grep -E '^FUJI_RPC_URL=' .env.local | cut -d= -f2-)
  [ -n "$fuji" ] || { log_err "FUJI_RPC_URL is missing in .env.local."; exit 1; }
  if [ -f "$PID_FILE" ]; then stop_services; fi
  local busy=()
  for port in "${PORTS[@]}"; do port_in_use "$port" && busy+=("$port"); done
  if [ "${#busy[@]}" -gt 0 ]; then
    log_err "Ports already in use: ${busy[*]}. Stop those programs first (run-local.sh never kills processes it did not start)."
    exit 1
  fi

  echo -e "
${BOLD}=== Starting Guardian402 on Avalanche Fuji ===${NC}
"
  mkdir -p "$LOG_DIR"
  : >"$PID_FILE"
  trap 'echo; log_info "Shutting down..."; stop_services' EXIT
  trap 'exit 130' INT TERM

  export NETWORK=fuji CHAIN_RPC_URL="$fuji" FACILITATOR_RPC_URL="$fuji" FORK_RPC_URL="$FORK_URL" DEMO_MODE=true
  export FACILITATOR_URL="http://127.0.0.1:4022"
  export NEXT_PUBLIC_NETWORK=fuji NEXT_PUBLIC_RPC_URL="" NEXT_PUBLIC_GUARDIAN_URL="" NEXT_PUBLIC_AGENT_URL=""

  log_info "[1/5] Guardian simulator (Anvil fork of Fuji) on :8545"
  FUJI_RPC_URL="$fuji" start_bg fork node scripts/fork.mjs
  wait_for_rpc "$FORK_URL" "Guardian simulator" 120

  log_info "[2/5] x402 facilitator on :4022 (settles on Fuji)"
  start_bg facilitator pnpm facilitator
  wait_for_url "http://127.0.0.1:4022/supported" "x402 facilitator" 60

  log_info "[3/5] Guardian API on :4402"
  start_bg guardian pnpm dev:guardian
  wait_for_url "http://127.0.0.1:4402/v1/health" "Guardian API" 90

  log_info "[4/5] Agent control API on :4403"
  start_bg agent pnpm dev:agent
  wait_for_url "http://127.0.0.1:4403/health" "Agent control API" 60

  log_info "[5/5] Dashboard on :3000"
  start_bg dashboard pnpm dev:dashboard
  wait_for_url "http://localhost:3000/dang-nhap" "Dashboard" 120

  echo -e "
${GREEN}${BOLD}Guardian402 is running on Avalanche Fuji.${NC}"
  echo -e "  Dashboard     http://localhost:3000"
  echo -e "  Guardian API  http://127.0.0.1:4402/v1/health"
  echo -e "Logs: $LOG_DIR. Press ${BOLD}Ctrl+C${NC} to stop everything.
"
  wait
}

cmd_status() {
  echo -e "\n${BOLD}=== Guardian402 local services ===${NC}"
  local line
  show() { if eval "$2"; then line="${GREEN}UP${NC}"; else line="${RED}DOWN${NC}"; fi; echo -e "  $1: $line"; }
  show "Anvil fork        :8545" "rpc_ready $FORK_URL"
  show "x402 facilitator  :4022" "curl -s -f http://127.0.0.1:4022/supported >/dev/null 2>&1"
  show "Guardian API      :4402" "curl -s -f http://127.0.0.1:4402/v1/health >/dev/null 2>&1"
  show "Agent control API :4403" "curl -s -f http://127.0.0.1:4403/health >/dev/null 2>&1"
  show "Dashboard         :3000" "curl -s -f http://localhost:3000 >/dev/null 2>&1"
  echo ""
}

cmd_scenario() {
  local id="${1:-all}"
  log_info "Running scenario $id on the local fork..."
  NETWORK=local CHAIN_RPC_URL="$FORK_URL" DEMO_MODE=true pnpm agent scenario "$id"
}

case "${1:-start}" in
  setup) cmd_setup ;;
  start) cmd_start ;;
  fuji) cmd_fuji ;;
  stop) stop_services ;;
  status) cmd_status ;;
  scenario) cmd_scenario "${2:-all}" ;;
  *)
    echo "Usage: $0 {start|fuji|setup|stop|status|scenario <id>}"
    exit 1
    ;;
esac
