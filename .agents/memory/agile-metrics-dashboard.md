---
name: Agile Metrics Dashboard
description: Key decisions and conventions for the Agile Metrics Dashboard project (React + Express + PostgreSQL + Docker)
---

# Agile Metrics Dashboard

## Period as path param (not query param)
All time-windowed endpoints use a PATH param for period (`1m`, `3m`, `6m`), e.g. `/projects/{id}/metrics/{period}`.

**Why:** OpenAPI codegen produces TS2308 type collisions when the same query param name appears across multiple endpoints.
**How to apply:** New time-windowed endpoints must continue using `/:period` path params.

## Auth convention
- JWT in localStorage key `"auth_token"`, sent as `Authorization: Bearer <token>`
- `setAuthTokenGetter` from `@workspace/api-client-react` auto-injects the token into all generated hooks — wired once in `artifacts/dashboard/src/lib/auth.ts`

## Jira mock fallback
Jira client falls back to 4 mock projects + generated issues when JIRA_URL/JIRA_EMAIL/JIRA_API_TOKEN are absent — no crash, no config required for demo use.

## Docker web build quirk
`artifacts/dashboard/vite.config.ts` throws if PORT and BASE_PATH env vars are absent (even during `vite build`). Docker build stage must pass `PORT=3000 BASE_PATH=/` before the build command. Vite outputs to `dist/public` (not `dist`), so nginx COPY must target `dist/public`.

**How to apply:** Any CI or Docker build of the dashboard artifact must set these two env vars.

## Docker Node stack
- Build context is `.` (repo root) for both api and web services — required so COPY can reach workspace files outside the docker/ subdirectory
- No hard `.env` file dependency — all vars have defaults in `docker-compose.yml environment:` block
- JWT expiration env var is `JWT_EXPIRE` with duration values like `24h`
- Default admin seeded on startup when users table is empty; password via `DEFAULT_ADMIN_PASSWORD` env var
