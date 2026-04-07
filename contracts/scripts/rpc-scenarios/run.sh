#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${ROOT_DIR}/artifacts/integration"

mkdir -p "${OUT_DIR}"

: "${SOROBAN_RPC_URL:?SOROBAN_RPC_URL is required}"
: "${SOROBAN_NETWORK_PASSPHRASE:?SOROBAN_NETWORK_PASSPHRASE is required}"
: "${SOROBAN_CONTRACT_ID:?SOROBAN_CONTRACT_ID is required}"
: "${SOROBAN_STAKING_REWARDS_ID:?SOROBAN_STAKING_REWARDS_ID is required}"

: "${SF_ADMIN_IDENTITY:?SF_ADMIN_IDENTITY is required}"
: "${SF_OPERATOR_IDENTITY:?SF_OPERATOR_IDENTITY is required}"
: "${SF_USER1_IDENTITY:?SF_USER1_IDENTITY is required}"
: "${SF_USER2_IDENTITY:?SF_USER2_IDENTITY is required}"

run_and_capture_cost() {
  local name="$1"
  local script="$2"

  set +e
  bash "$script" >"${OUT_DIR}/${name}.out.txt" 2>"${OUT_DIR}/${name}.cost.txt"
  local code=$?
  set -e

  if [[ $code -ne 0 ]]; then
    echo "Scenario failed: ${name}" >&2
    echo "--- stdout (${name}) ---" >&2
    cat "${OUT_DIR}/${name}.out.txt" >&2 || true
    echo "--- stderr (${name}) ---" >&2
    cat "${OUT_DIR}/${name}.cost.txt" >&2 || true
    exit $code
  fi
}

echo "Running RPC scenarios"

run_and_capture_cost "transaction_receipt_record" "${SCEN_DIR}/transaction-receipt.sh"
run_and_capture_cost "staking_rewards_claim" "${SCEN_DIR}/staking-rewards.sh"

echo "RPC scenarios complete. Benchmarks written to: ${OUT_DIR}"
