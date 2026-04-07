#!/usr/bin/env bash
set -euo pipefail

NAME="stellar-soroban"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed or not on PATH" >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
  docker stop "${NAME}" > /dev/null
  echo "Stopped ${NAME}"
else
  echo "${NAME} not running"
fi
