#!/usr/bin/env bash
set -euo pipefail

NAME="stellar-soroban"
IMAGE="stellar/quickstart:latest"
PORT="8000"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed or not on PATH" >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
  echo "${NAME} already running"
else
  docker run -d --rm \
    -p "${PORT}:8000" \
    --name "${NAME}" \
    "${IMAGE}" \
    --local \
    --enable rpc > /dev/null
fi

RPC_URL="http://localhost:${PORT}/rpc"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not installed or not on PATH" >&2
  exit 1
fi

echo "Waiting for local network RPC: ${RPC_URL}"
for i in $(seq 1 120); do
  if curl -fsS "http://localhost:${PORT}/" >/dev/null 2>&1; then
    echo "Local network is up"
    exit 0
  fi
  sleep 1
  if [[ $i -eq 120 ]]; then
    echo "Timed out waiting for local network" >&2
    docker logs "${NAME}" || true
    exit 1
  fi
done
