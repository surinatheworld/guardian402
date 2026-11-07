#!/usr/bin/env bash
# Mines a lookalike of the deployed MockRouter for scenario S3 (docs/SPEC.md §10) with `cast wallet vanity`.
# Keeps only the address in apps/agent/fixtures/lookalike.json. The private key is discarded and the address
# must never be funded: it exists only to show ADDRESS_POISONING.
#
#   scripts/mine-lookalike.sh [fuji|local] [chars]   # chars = matching hex characters at each end (default 3)
#
# 4+4 characters (16^8 tries) takes too long on a laptop, so DEMO mode mines 3+3 and the rule runs at 3/3
# (apps/guardian/config/rules.json demoPrefix/demoSuffix). Declare this in the pitch.
set -euo pipefail
cd "$(dirname "$0")/.."

NETWORK="${1:-fuji}"
CHARS="${2:-3}"
ROUTER=$(node -e "console.log(require('./packages/shared/src/addresses/${NETWORK}.json').router)")
BODY="${ROUTER:2}"
START="${BODY:0:${CHARS}}"
END="${BODY: -${CHARS}}"

echo "[lookalike] router ${ROUTER}: mining 0x${START}…${END} (${CHARS}+${CHARS} hex characters)"
OUT=$(cast wallet vanity --starts-with "${START}" --ends-with "${END}" --threads 0)
ADDRESS=$(printf '%s\n' "${OUT}" | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
if [ -z "${ADDRESS}" ]; then
  echo "[lookalike] cast did not print an address" >&2
  exit 1
fi
mkdir -p apps/agent/fixtures
node -e "
const fs = require('fs');
const out = { network: '${NETWORK}', router: '${ROUTER}', lookalike: '${ADDRESS}', matchedChars: ${CHARS},
  note: 'DEMO: mined with cast wallet vanity; private key discarded; never fund this address.' };
fs.writeFileSync('apps/agent/fixtures/lookalike.json', JSON.stringify(out, null, 2) + '\n');
"
echo "[lookalike] ${ADDRESS} → apps/agent/fixtures/lookalike.json (key discarded)"
