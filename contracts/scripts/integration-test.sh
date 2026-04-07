#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NETWORK="local"
ADMIN_IDENTITY="sf_admin"
OPERATOR_IDENTITY="sf_operator"
ISSUER_IDENTITY="sf_issuer"
USER1_IDENTITY="sf_user1"
USER2_IDENTITY="sf_user2"

ENV_FILE="${ROOT_DIR}/../backend/.env.soroban"

RPC_URL="http://localhost:8000/rpc"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"

if ! command -v stellar >/dev/null 2>&1; then
  echo "stellar CLI is required but not installed or not on PATH" >&2
  exit 1
fi

bash "${ROOT_DIR}/scripts/local-network-start.sh"

echo "Configuring local network in stellar CLI (idempotent)"
stellar network add local --rpc-url "${RPC_URL}" --network-passphrase "${NETWORK_PASSPHRASE}" >/dev/null 2>&1 || true

echo "Creating identities (deterministic names)"
stellar keys generate "${ADMIN_IDENTITY}" --network local --fund --overwrite >/dev/null
stellar keys generate "${OPERATOR_IDENTITY}" --network local --fund --overwrite >/dev/null
stellar keys generate "${ISSUER_IDENTITY}" --network local --fund --overwrite >/dev/null
stellar keys generate "${USER1_IDENTITY}" --network local --fund --overwrite >/dev/null
stellar keys generate "${USER2_IDENTITY}" --network local --fund --overwrite >/dev/null

echo "Building WASM artifacts"
bash "${ROOT_DIR}/scripts/build-wasm.sh"

echo "Deploying core contracts + writing env file: ${ENV_FILE}"
bash "${ROOT_DIR}/scripts/deploy-all.sh" --env-file "${ENV_FILE}" "${NETWORK}" "${ADMIN_IDENTITY}" "${OPERATOR_IDENTITY}" "${ISSUER_IDENTITY}"

ADMIN_SECRET="$(stellar keys secret "${ADMIN_IDENTITY}")"

echo "Appending admin secret for backend integration tests"
if ! grep -q "^SOROBAN_ADMIN_SECRET=" "${ENV_FILE}"; then
  printf '%s\n' "SOROBAN_ADMIN_SECRET=${ADMIN_SECRET}" >> "${ENV_FILE}"
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

export SF_ADMIN_IDENTITY="${ADMIN_IDENTITY}"
export SF_OPERATOR_IDENTITY="${OPERATOR_IDENTITY}"
export SF_ISSUER_IDENTITY="${ISSUER_IDENTITY}"
export SF_USER1_IDENTITY="${USER1_IDENTITY}"
export SF_USER2_IDENTITY="${USER2_IDENTITY}"

echo "Running contracts RPC scenario suite"
bash "${ROOT_DIR}/scripts/rpc-scenarios/run.sh"

echo "Running backend Soroban RPC integration tests"
if [[ -f "${ROOT_DIR}/../backend/package.json" ]]; then
  npm --prefix "${ROOT_DIR}/../backend" run test:integration
else
  echo "backend/package.json not found; skipping backend integration tests" >&2
  exit 1
fi

echo "Integration test run complete"
