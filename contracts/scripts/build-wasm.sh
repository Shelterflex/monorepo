#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACTS_DIR="$ROOT_DIR/artifacts"

mkdir -p "$ARTIFACTS_DIR"

cd "$ROOT_DIR"

stellar contract build --out-dir "$ARTIFACTS_DIR"

echo "WASM artifacts written to: $ARTIFACTS_DIR"
