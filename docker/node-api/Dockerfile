FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib/api-spec ./lib/api-spec
COPY lib/api-zod ./lib/api-zod
COPY lib/api-client-react ./lib/api-client-react
COPY lib/db ./lib/db
COPY artifacts/api-server ./artifacts/api-server

RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-spec run codegen
RUN pnpm --filter @workspace/api-server run build

ENV PORT=8000

EXPOSE 8000

CMD node --enable-source-maps ./artifacts/api-server/dist/index.mjs
