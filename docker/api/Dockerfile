FROM node:22-bookworm-slim AS builder
# ca-certificates: the pnpm installer fails with "No CA certificates were loaded" on
# the bare -slim image.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY lib/api-zod ./lib/api-zod
COPY lib/db ./lib/db
COPY artifacts/api-server ./artifacts/api-server

RUN mkdir -p lib/integrations
ARG npm_config_fetch_timeout=600000
ARG npm_config_fetch_retries=8
ARG npm_config_network_concurrency=4
ENV npm_config_fetch_timeout=$npm_config_fetch_timeout \
    npm_config_fetch_retries=$npm_config_fetch_retries \
    npm_config_network_concurrency=$npm_config_network_concurrency
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM node:22-bookworm-slim AS prod
WORKDIR /app

COPY --from=builder /app/artifacts /app/artifacts
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 8000
# Heap size comes from NODE_OPTIONS in docker-compose.yml (API_MAX_OLD_SPACE_MB). It used to be
# hard-coded here as --max-old-space-size=400 for the old 512 MB free tier, which silently
# overrode the compose value: command-line flags win over NODE_OPTIONS.
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
