FROM node:22-bullseye-slim AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY lib/api-zod ./lib/api-zod
COPY lib/db ./lib/db
COPY artifacts/api-server ./artifacts/api-server

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM node:22-bullseye-slim AS prod
WORKDIR /app

COPY --from=builder /app/artifacts /app/artifacts
COPY --from=builder /app/node_modules /app/node_modules

EXPOSE 8000
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
