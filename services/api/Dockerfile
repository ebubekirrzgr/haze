# haze-api — uzun süreli süreç (fiyat botu, operatör kuyruğu, indexer). Vercel'e uymaz; Fly.io / Railway / VPS içindir.
# Bağlam: depo kökü (docker build -f services/api/Dockerfile .)
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/stellar/package.json packages/stellar/
COPY services/api/package.json services/api/
COPY scripts/package.json scripts/
COPY apps/web/package.json apps/web/
COPY apps/terminal/package.json apps/terminal/
RUN pnpm install --frozen-lockfile --filter @haze/api... --filter @haze/stellar...
COPY packages/stellar packages/stellar
COPY services/api services/api
COPY testnet.contracts.json ./
# SQLite kalıcı diskte: DB_PATH=/data/haze.db (Fly volume)
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/haze.db HAZE_CONFIG=/app/testnet.contracts.json
WORKDIR /app/services/api
EXPOSE 8787
CMD ["node", "--experimental-transform-types", "src/server.ts"]
