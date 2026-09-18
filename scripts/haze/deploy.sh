#!/usr/bin/env bash
# Haze kontratlarını testnet'e dağıt. Gerekli: rustup target wasm32v1-none, stellar-cli.
set -euo pipefail
cd "$(dirname "$0")/.."
rustup target list --installed | grep -q wasm32v1-none || rustup target add wasm32v1-none
exec node --experimental-transform-types haze/deploy.ts "$@"
