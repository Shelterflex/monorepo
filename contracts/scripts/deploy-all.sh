#!/usr/bin/env bash
set -euo pipefail

NETWORK="${1:-}"
ADMIN_IDENTITY="${2:-}"
OPERATOR_IDENTITY="${3:-}"
ISSUER_IDENTITY="${4:-}"

if [[ -z "$NETWORK" || -z "$ADMIN_IDENTITY" || -z "$OPERATOR_IDENTITY" || -z "$ISSUER_IDENTITY" ]]; then
  echo "Usage: $0 <network> <admin_identity> <operator_identity> <issuer_identity>" >&2
  echo "Example: $0 testnet shelter_admin shelter_operator shelter_issuer" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="$ROOT_DIR/artifacts"

if [[ ! -d "$ARTIFACTS_DIR" ]]; then
  echo "Artifacts dir not found: $ARTIFACTS_DIR" >&2
  echo "Run: bash contracts/scripts/build-wasm.sh" >&2
  exit 1
fi

wasm_path() {
  local pkg="$1"
  local candidate="$ARTIFACTS_DIR/${pkg//-/_}.wasm"
  if [[ -f "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi

  echo "WASM not found for package '$pkg'. Expected: $candidate" >&2
  echo "Files in $ARTIFACTS_DIR:" >&2
  ls -1 "$ARTIFACTS_DIR" >&2 || true
  exit 1
}

ADMIN_ADDR="$(stellar keys address "$ADMIN_IDENTITY")"
OPERATOR_ADDR="$(stellar keys address "$OPERATOR_IDENTITY")"
ISSUER_ADDR="$(stellar keys address "$ISSUER_IDENTITY")"

RPC_URL=""
NETWORK_PASSPHRASE=""

case "$NETWORK" in
  local)
    RPC_URL="http://localhost:8000/soroban/rpc"
    NETWORK_PASSPHRASE="Standalone Network ; February 2017"
    ;;
  testnet)
    RPC_URL="https://soroban-testnet.stellar.org"
    NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
    ;;
  *)
    echo "Unsupported network '$NETWORK'. Expected: local | testnet" >&2
    exit 1
    ;;
esac

echo "Deploying Soroban Asset Contract for USDC:${ISSUER_ADDR}..."
USDC_TOKEN_ID="$(stellar contract asset deploy \
  --asset "USDC:${ISSUER_ADDR}" \
  --source-account "$ADMIN_IDENTITY" \
  --network "$NETWORK")"

echo "$USDC_TOKEN_ID"

cd "$ROOT_DIR"

deploy_contract() {
  local pkg="$1"
  local alias="$2"
  local wasm
  wasm="$(wasm_path "$pkg")"

  echo "Deploying $pkg..."
  local id
  id="$(stellar contract deploy \
    --wasm "$wasm" \
    --source-account "$ADMIN_IDENTITY" \
    --network "$NETWORK" \
    --alias "$alias")"
  echo "$id"
}

invoke_init() {
  local id="$1"
  local source="$2"
  shift 2

  stellar contract invoke \
    --id "$id" \
    --source-account "$source" \
    --network "$NETWORK" \
    --send=yes \
    -- \
    init "$@" > /dev/null
}

TRANSACTION_RECEIPT_ID="$(deploy_contract transaction-receipt-contract transaction_receipt)"
STAKING_POOL_ID="$(deploy_contract staking_pool staking_pool)"
STAKING_REWARDS_ID="$(deploy_contract staking_rewards staking_rewards)"
DEAL_ESCROW_ID="$(deploy_contract deal_escrow deal_escrow)"
WHISTLEBLOWER_REWARDS_ID="$(deploy_contract whistleblower_rewards whistleblower_rewards)"
RENT_WALLET_ID="$(deploy_contract rent_wallet rent_wallet)"
RENT_PAYMENTS_ID="$(deploy_contract rent_payments rent_payments)"

echo "Initializing transaction-receipt-contract..."
invoke_init "$TRANSACTION_RECEIPT_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR" \
  --operator "$OPERATOR_ADDR"

echo "Initializing staking_pool..."
invoke_init "$STAKING_POOL_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR" \
  --token "$USDC_TOKEN_ID"

echo "Initializing staking_rewards..."
invoke_init "$STAKING_REWARDS_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR"

echo "Initializing deal_escrow..."
invoke_init "$DEAL_ESCROW_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR" \
  --operator "$OPERATOR_ADDR" \
  --token "$USDC_TOKEN_ID" \
  --receipt-contract "$TRANSACTION_RECEIPT_ID"

echo "Initializing whistleblower_rewards..."
invoke_init "$WHISTLEBLOWER_REWARDS_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR" \
  --operator "$OPERATOR_ADDR" \
  --token "$USDC_TOKEN_ID"

echo "Initializing rent_wallet..."
invoke_init "$RENT_WALLET_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR"

echo "Initializing rent_payments..."
invoke_init "$RENT_PAYMENTS_ID" "$ADMIN_IDENTITY" \
  --admin "$ADMIN_ADDR"

echo ""
echo "# backend/.env"
echo "SOROBAN_RPC_URL=$RPC_URL"
echo "SOROBAN_NETWORK_PASSPHRASE=$NETWORK_PASSPHRASE"
echo "SOROBAN_CONTRACT_ID=$TRANSACTION_RECEIPT_ID"
echo "SOROBAN_USDC_TOKEN_ID=$USDC_TOKEN_ID"
echo "SOROBAN_STAKING_POOL_ID=$STAKING_POOL_ID"
echo "SOROBAN_STAKING_REWARDS_ID=$STAKING_REWARDS_ID"
echo "# Optional (use operator identity secret):"
echo "# SOROBAN_ADMIN_SECRET=$(stellar keys secret \"$OPERATOR_IDENTITY\")"
