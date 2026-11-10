#!/usr/bin/env bash
# ==============================================================================
# Guardian402 — All-In-One Local Environment & Runner
# ==============================================================================
# Usage:
#   ./run-local.sh         # Starts full stack (Fork, Facilitator, Guardian, Agent, Dashboard)
#   ./run-local.sh setup   # First-time complete setup (keys, envs, forge build, seed)
#   ./run-local.sh scenario <S0..S6|all> # Runs demo scenarios
#   ./run-local.sh stop    # Stops all background services
#   ./run-local.sh status  # Checks status of all services
# ==============================================================================

set -eo pipefail

export PATH="$HOME/.foundry/bin:$PATH"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1"; }

PORTS=(8545 4022 4402 4403 3000)

stop_services() {
  log_info "Stopping any running services on ports: ${PORTS[*]}..."
  for port in "${PORTS[@]}"; do
    local pids
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
  done
  log_success "Cleaned up ports."
}

wait_for_url() {
  local url="$1"
  local name="$2"
  local max_retries="${3:-30}"
  local count=0

  log_info "Waiting for $name ($url)..."
  until curl -s -f "$url" >/dev/null 2>&1 || [ "$count" -ge "$max_retries" ]; do
    sleep 1
    count=$((count + 1))
  done

  if [ "$count" -ge "$max_retries" ]; then
    log_err "$name failed to become ready at $url within ${max_retries}s."
    return 1
  fi
  log_success "$name is ready!"
}

wait_for_rpc() {
  local url="$1"
  local name="$2"
  local max_retries="${3:-30}"
  local count=0

  log_info "Waiting for $name ($url)..."
  until curl -s -X POST -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$url" 2>/dev/null | grep -q "result" || [ "$count" -ge "$max_retries" ]; do
    sleep 1
    count=$((count + 1))
  done

  if [ "$count" -ge "$max_retries" ]; then
    log_err "$name failed to respond at $url within ${max_retries}s."
    return 1
  fi
  log_success "$name is ready!"
}

check_prerequisites() {
  log_info "Checking system prerequisites..."
  
  if ! command -v node >/dev/null 2>&1; then
    log_err "Node.js (>=22.13.0) is required but not found."
    exit 1
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    log_err "pnpm is required. Run 'corepack enable pnpm' to install."
    exit 1
  fi

  if ! command -v anvil >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
    log_warn "Neither native Foundry (anvil) nor Docker was found in PATH."
    log_warn "Please install Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
  fi
}

cmd_setup() {
  check_prerequisites

  echo -e "\n${BOLD}=== 1. Setting up Environment Variables ===${NC}"
  node scripts/init-local-env.mjs

  echo -e "\n${BOLD}=== 2. Compiling Smart Contracts ===${NC}"
  if command -v forge >/dev/null 2>&1; then
    (cd contracts && forge build)
  else
    log_warn "forge command not found; skipping contract compile. Existing artifacts will be used."
  fi

  echo -e "\n${BOLD}=== 3. Starting Temporary Fork to Deploy Contracts ===${NC}"
  stop_services
  node scripts/fork.mjs >/dev/null 2>&1 &
  local fork_pid=$!
  trap 'kill -9 $fork_pid 2>/dev/null || true' EXIT

  wait_for_rpc "http://127.0.0.1:8545" "Anvil Fork" 30

  echo -e "\n${BOLD}=== 4. Deploying & Seeding Local Contracts ===${NC}"
  pnpm deploy:local
  pnpm seed:local
  pnpm known-contracts
  
  echo -e "\n${BOLD}=== 5. Mining Lookalike Address (DEMO) ===${NC}"
  if [ -x scripts/mine-lookalike.sh ]; then
    bash scripts/mine-lookalike.sh local 3 || true
  fi

  kill -9 $fork_pid 2>/dev/null || true
  trap - EXIT
  
  echo -e "\n${GREEN}${BOLD}✓ Local setup completed successfully!${NC}"
  echo -e "You can now run: ${BOLD}./run-local.sh${NC} to start all services.\n"
}

cmd_start() {
  check_prerequisites

  if [ ! -f ".env.local" ] || [ ! -f "apps/dashboard/.env.local" ]; then
    log_warn "Missing local configuration. Running first-time setup..."
    cmd_setup
  fi

  stop_services

  echo -e "\n${BOLD}======================================================${NC}"
  echo -e "${BOLD}       🚀 Starting Guardian402 Local Stack           ${NC}"
  echo -e "${BOLD}======================================================${NC}\n"

  # PID tracker
  PIDS=()
  cleanup() {
    echo -e "\n${YELLOW}Shutting down all services...${NC}"
    for pid in "${PIDS[@]}"; do
      kill -9 "$pid" 2>/dev/null || true
    done
    stop_services
    echo -e "${GREEN}All services stopped cleanly.${NC}"
    exit 0
  }
  trap cleanup SIGINT SIGTERM

  # 1. Start Anvil Fork
  log_info "[1/5] Starting Anvil Fork on port 8545..."
  node scripts/fork.mjs > /tmp/guardian-fork.log 2>&1 &
  PIDS+=($!)
  wait_for_rpc "http://127.0.0.1:8545" "Anvil Fork" 30

  # Check if vault has code on fork, if not deploy & seed
  local vault_addr
  vault_addr=$(node -e "try{console.log(require('./packages/shared/src/addresses/local.json').vault)}catch{console.log('')}" 2>/dev/null || true)
  local code_res
  code_res=$(curl -s -X POST -H "Content-Type: application/json" \
    --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getCode\",\"params\":[\"${vault_addr}\",\"latest\"]}" \
    http://127.0.0.1:8545 2>/dev/null || true)

  if echo "$code_res" | grep -q '"result":"0x"'; then
    log_info "Vault not found on fork. Deploying and seeding contracts..."
    pnpm deploy:local
    pnpm seed:local
    pnpm known-contracts
  else
    log_info "Vault contracts already present on fork."
  fi

  # 2. Start Facilitator
  log_info "[2/5] Starting x402 Facilitator on port 4022..."
  FACILITATOR_RPC_URL=http://127.0.0.1:8545 pnpm facilitator > /tmp/guardian-facilitator.log 2>&1 &
  PIDS+=($!)
  wait_for_url "http://127.0.0.1:4022/supported" "x402 Facilitator" 20

  # 3. Start Guardian API
  log_info "[3/5] Starting Guardian API on port 4402..."
  FACILITATOR_URL=http://127.0.0.1:4022 DEMO_MODE=true pnpm dev:guardian > /tmp/guardian-api.log 2>&1 &
  PIDS+=($!)
  wait_for_url "http://127.0.0.1:4402/v1/health" "Guardian API" 20

  # 4. Start Agent Control API
  log_info "[4/5] Starting Agent Control API on port 4403..."
  DEMO_MODE=true pnpm dev:agent > /tmp/guardian-agent.log 2>&1 &
  PIDS+=($!)
  wait_for_url "http://127.0.0.1:4403/health" "Agent API" 20

  # 5. Start Dashboard
  log_info "[5/5] Starting Dashboard on port 3000..."
  pnpm dev:dashboard > /tmp/guardian-dashboard.log 2>&1 &
  PIDS+=($!)
  wait_for_url "http://localhost:3000" "Dashboard" 30

  echo -e "\n${GREEN}${BOLD}======================================================${NC}"
  echo -e "${GREEN}${BOLD}   ✓ All Guardian402 services are live and running!   ${NC}"
  echo -e "${GREEN}${BOLD}======================================================${NC}"
  echo -e "  🌐 ${BOLD}Dashboard:${NC}     http://localhost:3000"
  echo -e "  🛡️  ${BOLD}Guardian API:${NC}  http://127.0.0.1:4402/v1/health"
  echo -e "  💳 ${BOLD}Facilitator:${NC}   http://127.0.0.1:4022/supported"
  echo -e "  🤖 ${BOLD}Agent API:${NC}     http://127.0.0.1:4403/health"
  echo -e "  ⛓️  ${BOLD}Anvil Fork:${NC}    http://127.0.0.1:8545"
  echo -e "------------------------------------------------------"
  echo -e "Logs available in /tmp/guardian-*.log"
  echo -e "Press ${YELLOW}${BOLD}Ctrl+C${NC} anytime to stop all services.\n"

  # Wait for any child to exit or signal
  wait
}

cmd_status() {
  echo -e "\n${BOLD}=== Checking Guardian402 Services Status ===${NC}"
  
  check_status() {
    local name="$1"
    local port="$2"
    local url="$3"
    local pids
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      if [ -n "$url" ] && curl -s -f "$url" >/dev/null 2>&1; then
        echo -e "  $name (port $port): ${GREEN}RUNNING & HEALTHY${NC} (PID: $pids)"
      else
        echo -e "  $name (port $port): ${YELLOW}LISTENING${NC} (PID: $pids)"
      fi
    else
      echo -e "  $name (port $port): ${RED}STOPPED${NC}"
    fi
  }

  check_status "Anvil Fork" 8545 ""
  check_status "x402 Facilitator" 4022 "http://127.0.0.1:4022/supported"
  check_status "Guardian API" 4402 "http://127.0.0.1:4402/v1/health"
  check_status "Agent Control API" 4403 "http://127.0.0.1:4403/health"
  check_status "Dashboard" 3000 "http://localhost:3000"
  echo ""
}

cmd_scenario() {
  local id="${1:-all}"
  log_info "Running scenario: $id..."
  DEMO_MODE=true pnpm agent scenario "$id"
}

# Subcommand router
case "${1:-start}" in
  setup)
    cmd_setup
    ;;
  start)
    cmd_start
    ;;
  stop)
    stop_services
    ;;
  status)
    cmd_status
    ;;
  scenario)
    cmd_scenario "${2:-all}"
    ;;
  *)
    echo "Usage: $0 {start|setup|stop|status|scenario <id>}"
    exit 1
    ;;
esac
