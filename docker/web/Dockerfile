FROM node:22-bullseye-slim AS builder

ARG SKIP_CODEGEN=0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.0.0-alpha.17

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib/api-spec ./lib/api-spec
COPY lib/api-zod ./lib/api-zod
COPY lib/api-client-react ./lib/api-client-react
COPY lib/db ./lib/db
COPY artifacts/dashboard ./artifacts/dashboard

RUN mkdir -p lib/integrations
RUN pnpm install --frozen-lockfile
# Optionally skip codegen in CI/docker builds if platform-specific binaries fail
RUN if [ "$SKIP_CODEGEN" = "1" ]; then echo "Skipping api-spec codegen"; else pnpm --filter @workspace/api-spec run codegen; fi
# PORT and BASE_PATH are required by vite.config.ts validation during build
RUN PORT=3000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build

FROM nginx:alpine

COPY --from=builder /app/artifacts/dashboard/dist/public /usr/share/nginx/html
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
