#!/usr/bin/env bash
# =============================================================================
# deploy-soroban.sh — Idempotent Soroban contract deployment
#
# Builds, deploys, and initialises all workspace contracts on a Stellar network.
# Re-running the script skips contracts that have already been deployed (tracked
# in deployed/{network}.json).
#
# Usage:
#   ./deploy-soroban.sh --network testnet
#   ./deploy-soroban.sh                      # defaults to testnet
# =============================================================================
set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────
NETWORK="testnet"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network)
      [[ $# -lt 2 ]] && { echo "ERROR: --network requires a value" >&2; exit 1; }
      NETWORK="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--network <testnet|mainnet>]"
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument '$1'" >&2; exit 1
      ;;
  esac
done

# ── Directories ──────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_DIR="$DEPLOY_ROOT/config"
DEPLOYED_DIR="$DEPLOY_ROOT/deployed"
CONTRACTS_ROOT="$(cd "$DEPLOY_ROOT/.." && pwd)"

# ── Load network configuration ──────────────────────────────────────────────
CONFIG_FILE="$CONFIG_DIR/${NETWORK}.json"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Network config not found: $CONFIG_FILE" >&2
  echo "Available configs:" >&2
  ls -1 "$CONFIG_DIR"/*.json 2>/dev/null || echo "  (none)" >&2
  exit 1
fi

RPC_URL="$(jq -r '.network.rpc_url' "$CONFIG_FILE")"
NETWORK_PASSPHRASE="$(jq -r '.network.network_passphrase' "$CONFIG_FILE")"
NETWORK_NAME="$(jq -r '.network.name' "$CONFIG_FILE")"

echo "═══════════════════════════════════════════════════════════════"
echo "  Soroban Deployment — ${NETWORK_NAME}"
echo "  RPC:        ${RPC_URL}"
echo "  Passphrase: ${NETWORK_PASSPHRASE}"
echo "═══════════════════════════════════════════════════════════════"

# ── Validate required env vars ───────────────────────────────────────────────
if [[ -z "${STELLAR_SECRET_KEY:-}" ]]; then
  echo "ERROR: STELLAR_SECRET_KEY environment variable is required but not set." >&2
  echo "       Export it before running this script:" >&2
  echo "         export STELLAR_SECRET_KEY=S..." >&2
  exit 1
fi

ADMIN_ADDRESS="${STELLAR_DEPLOYER_ADDRESS:-}"
if [[ -z "$ADMIN_ADDRESS" ]]; then
  echo "WARNING: STELLAR_DEPLOYER_ADDRESS not set — deriving from secret key." >&2
  ADMIN_ADDRESS="$(stellar keys address deployer 2>/dev/null || echo "")"
  if [[ -z "$ADMIN_ADDRESS" ]]; then
    echo "ERROR: Could not determine deployer address. Set STELLAR_DEPLOYER_ADDRESS." >&2
    exit 1
  fi
fi

echo "  Deployer:   ${ADMIN_ADDRESS}"
echo ""

# ── Contract list (workspace members) ───────────────────────────────────────
CONTRACTS=(
  rent_wallet
  rent_payments
  transaction-receipt-contract
  staking_rewards
  staking_pool
  mvp_staking_pool
  whistleblower_rewards
  soroban_pausable
  soroban_access_control
  deal_escrow
  contract_access
  timelock
)

# ── Deployed-state file ─────────────────────────────────────────────────────
mkdir -p "$DEPLOYED_DIR"
DEPLOYED_FILE="$DEPLOYED_DIR/${NETWORK}.json"

if [[ ! -f "$DEPLOYED_FILE" ]]; then
  echo "{}" > "$DEPLOYED_FILE"
fi

# ── Helper: check if a contract is already deployed ─────────────────────────
is_deployed() {
  local name="$1"
  local existing
  existing="$(jq -r --arg n "$name" '.[$n] // empty' "$DEPLOYED_FILE")"
  [[ -n "$existing" ]]
}

# ── Helper: save a contract ID to the deployed file ─────────────────────────
save_contract_id() {
  local name="$1"
  local contract_id="$2"
  local tmp
  tmp="$(mktemp)"
  jq --arg n "$name" --arg id "$contract_id" '.[$n] = $id' "$DEPLOYED_FILE" > "$tmp"
  mv "$tmp" "$DEPLOYED_FILE"
}

# ── Build WASM artifacts ────────────────────────────────────────────────────
ARTIFACTS_DIR="$CONTRACTS_ROOT/artifacts"

echo "▶ Building WASM artifacts..."
cd "$CONTRACTS_ROOT"
stellar contract build --out-dir "$ARTIFACTS_DIR"
echo "  ✓ WASM artifacts written to: $ARTIFACTS_DIR"
echo ""

# ── Helper: resolve WASM path for a contract ────────────────────────────────
wasm_path() {
  local pkg="$1"
  # stellar contract build replaces hyphens with underscores
  local candidate="$ARTIFACTS_DIR/${pkg//-/_}.wasm"
  if [[ -f "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi
  echo "ERROR: WASM not found for '$pkg'. Expected: $candidate" >&2
  return 1
}

# ── Deploy loop ─────────────────────────────────────────────────────────────
TOTAL=${#CONTRACTS[@]}
DEPLOYED_COUNT=0
SKIPPED_COUNT=0

for contract in "${CONTRACTS[@]}"; do
  echo "────────────────────────────────────────────────────────────"
  echo "  Contract: $contract"

  if is_deployed "$contract"; then
    existing_id="$(jq -r --arg n "$contract" '.[$n]' "$DEPLOYED_FILE")"
    echo "  ⏩ Already deployed: $existing_id (skipping)"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  # Resolve WASM path
  WASM="$(wasm_path "$contract")" || { echo "  ✗ Skipping (WASM missing)"; continue; }

  # Deploy
  echo "  ▶ Deploying..."
  CONTRACT_ID="$(stellar contract deploy \
    --wasm "$WASM" \
    --source "$STELLAR_SECRET_KEY" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE")"

  echo "  ✓ Deployed: $CONTRACT_ID"

  # Initialise with admin address (best-effort — not all contracts expose init)
  echo "  ▶ Initialising (admin=$ADMIN_ADDRESS)..."
  if stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$STELLAR_SECRET_KEY" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --send=yes \
    -- \
    init --admin "$ADMIN_ADDRESS" 2>/dev/null; then
    echo "  ✓ Initialised"
  else
    echo "  ⚠ init not available or failed (non-fatal — contract may use a different entry point)"
  fi

  # Persist
  save_contract_id "$contract" "$CONTRACT_ID"
  DEPLOYED_COUNT=$((DEPLOYED_COUNT + 1))
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Deployment summary"
echo "    Network:   $NETWORK_NAME"
echo "    Deployed:  $DEPLOYED_COUNT / $TOTAL"
echo "    Skipped:   $SKIPPED_COUNT / $TOTAL (already deployed)"
echo "    State:     $DEPLOYED_FILE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Contract IDs:"
jq '.' "$DEPLOYED_FILE"
