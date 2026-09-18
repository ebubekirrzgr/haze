#!/usr/bin/env bash
# Adım 4 — kendi Blend v2 dağıtımımız (blend-utils tabanlı).
# blend-utils'i klonlar, haze-mock.ts'i içine kopyalar, derler ve çalıştırır.
# Çıktıdaki adresleri testnet.contracts.json'a yazar ve VaultFactory'nin havuzunu Blend'e çevirir.
#
#   pnpm --filter @haze/scripts blend:deploy
# Ortam: services/api/.env içindeki BLEND_ADMIN_SECRET (admin) ve TREASURY_SECRET (whale/likidite).
# Treasury'de Circle testnet USDC olmalı (fund-usdc ya da faucet).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="${BLEND_UTILS_DIR:-$ROOT/.blend-utils}"

envval() { grep -E "^$1=" "$ROOT/services/api/.env" | head -1 | cut -d= -f2-; }
ADMIN="$(envval BLEND_ADMIN_SECRET)"; WHALE="$(envval TREASURY_SECRET)"
[ -n "$ADMIN" ] && [ -n "$WHALE" ] || { echo "BLEND_ADMIN_SECRET / TREASURY_SECRET eksik (pnpm --filter @haze/scripts keys)"; exit 1; }

if [ ! -d "$WORK" ]; then
  git clone --depth 1 https://github.com/blend-capital/blend-utils.git "$WORK"
fi
cp "$HERE/haze-mock.ts" "$WORK/src/v2/testing-scripts/haze-mock.ts"
cat > "$WORK/.env" <<EOF
RPC_URL=https://soroban-testnet.stellar.org
FRIENDBOT_URL=https://friendbot.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
ADMIN=$ADMIN
WHALE=$WHALE
HAZE_CONFIG=$ROOT/testnet.contracts.json
HAZE_SUPPLY_USDC=${HAZE_SUPPLY_USDC:-200}
EOF
# Kendi adres defterimiz: SDF testnet Blend'iyle karışmasın
rm -f "$WORK/haze.contracts.json"
cd "$WORK"
[ -d node_modules ] || npm i
npm run build
node ./lib/v2/testing-scripts/haze-mock.js haze
cd "$ROOT"
node --experimental-transform-types scripts/blend/apply.ts "$WORK/haze.contracts.json"
