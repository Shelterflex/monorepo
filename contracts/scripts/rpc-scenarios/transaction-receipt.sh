#!/usr/bin/env bash
set -euo pipefail

: "${SOROBAN_CONTRACT_ID:?SOROBAN_CONTRACT_ID is required}"
: "${SF_ADMIN_IDENTITY:?SF_ADMIN_IDENTITY is required}"
: "${SF_OPERATOR_IDENTITY:?SF_OPERATOR_IDENTITY is required}"

# Deterministic tx id (32 bytes -> 64 hex)
TX_ID_HEX="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
DEAL_ID="deal_rpc_1"

TOKEN_ID="${SOROBAN_USDC_TOKEN_ID:-}"
if [[ -z "${TOKEN_ID}" ]]; then
  echo "SOROBAN_USDC_TOKEN_ID is required" >&2
  exit 1
fi

OUT=$(stellar contract invoke \
  --id "${SOROBAN_CONTRACT_ID}" \
  --source-account "${SF_OPERATOR_IDENTITY}" \
  --network local \
  --send=yes \
  -- \
  record_receipt \
  --operator "$(stellar keys address "${SF_OPERATOR_IDENTITY}")" \
  --tx-id "${TX_ID_HEX}" \
  --tx-type TENANT_REPAYMENT \
  --amount-usdc 1000000 \
  --token "${TOKEN_ID}" \
  --deal-id "${DEAL_ID}" 2>&1)

echo "$OUT"
