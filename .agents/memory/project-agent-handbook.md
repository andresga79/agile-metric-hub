---
name: Project Agent Handbook
description: Comprehensive reference for coding agents working on Agile Metric Hub (architecture, stack, data flow, operations, and conventions)
---

# Project Agent Handbook

## Project Summary

Agile Metric Hub is a monorepo that provides:

- API server for metrics, auth, Jira sync, and analytics
- Dashboard frontend for portfolio/project views and flow analytics
- Shared API contract, generated React client, validation schemas, and DB package
- Docker-based local runtime (api, web, postgres)

Primary domain: Agile metrics and Jira-backed analytics, including flow efficiency, WIP aging, blocked time analysis, forecast, and health indicators.

## Monorepo Layout

- artifacts/api-server: Express API service
- artifacts/dashboard: React + Vite frontend
- lib/db: Drizzle ORM models and DB utilities
- lib/api-spec: OpenAPI source + Orval codegen
- lib/api-client-react: generated/react-query API hooks wrapper
- lib/api-zod: shared Zod contracts
- docker: Dockerfiles and nginx config
- scripts: utility workspace package

Workspace is managed via pnpm workspaces and catalog dependencies.

## Technology Stack

### Runtime

- Node.js 22 (Docker images use node:22-bullseye-slim)
- TypeScript 5.9
- pnpm workspaces

### Backend

- Express 5
- Drizzle ORM + PostgreSQL
- JWT auth (jsonwebtoken)
- Password hashing with bcryptjs
- Logging with pino + pino-http
- Jira integration through REST API

### Frontend

- React 19
- Vite 7
- React Query (TanStack)
- Wouter routing
- Tailwind CSS 4 + Radix UI components
- i18next for localization

### Contract and Codegen

- OpenAPI spec in lib/api-spec
- Orval code generation
- Shared zod contracts in lib/api-zod

## Local Runbook

## Preferred (Docker)

- Start stack: docker compose up -d --build
- API: http://localhost:8000
- Web: http://localhost
- DB: localhost:5432

### Workspace Commands

- Full typecheck: pnpm run typecheck
- Full build: pnpm run build
- API build only: pnpm --filter @workspace/api-server run build
- Dashboard build only: pnpm --filter @workspace/dashboard run build
- Regenerate API contracts/client: pnpm --filter @workspace/api-spec run codegen

## API and Data Flow

## Authentication

- Login endpoint: POST /api/auth/login
- Token format: Authorization Bearer <jwt>
- Frontend stores token in localStorage key auth_token
- Generated API client reads token via token getter wiring in dashboard auth helper

## Metrics and Analytics

- Project analytics endpoint pattern: /api/projects/:projectId/analytics/:period
- Period values currently include 1m and 3m
- Flow page uses this endpoint for:
	- Time in status
	- WIP aging
	- Blocked time analysis

## Jira Integration Notes

- Jira is enabled when JIRA_URL, JIRA_EMAIL, and JIRA_API_TOKEN are configured.
- Without Jira config, service can fall back to mock issue generation for development scenarios.
- Issue fetching uses cache-backed helpers from jira-cache module.

## Cache Behavior

- Persistent cache table: jira_cache
- Cache keys are tenant-scoped by Jira URL/email namespace
- Analytics refresh=true triggers targeted cache clear for relevant issue keys

Agent guidance when validating analytics fixes:

- If results do not reflect code changes, clear related jira_cache keys for that project and period.
- Rebuild/restart api container after backend code changes (docker compose up -d --build api).

## Blocked Time Analysis (Current Behavior)

- Computes blocked status using both:
	- status name matching (blocked/impediment variants)
	- Jira Flagged field (customfield_10021), including transition history when present
- Includes flagged issues from an additional Jira query (not only period-windowed issues)
- Issue types eligible for blocked analysis include:
	- HU, Story, Task
	- Spanish equivalents: Historia, Historia de usuario, Tarea

## Key Conventions

- Prefer period as path parameter for time-windowed endpoints.
- Keep shared contract changes aligned across:
	- lib/api-spec
	- lib/api-zod
	- lib/api-client-react
	- consuming frontend pages/hooks
- Avoid introducing new hard-coded cache keys outside existing helpers.
- Preserve existing naming where external systems depend on custom fields (for example customfield_10021).

## Operational Gotchas

- Dashboard Docker build expects env vars during build step:
	- PORT=3000
	- BASE_PATH=/
- Dashboard output path is dist/public (used by nginx image stage).
- docker compose defaults include development credentials; production deployments must override secrets.

## Recommended Agent Checklist Before Pushing

1. Run typecheck for touched packages (or full workspace).
2. If backend changed, rebuild api container and validate endpoint responses.
3. For analytics/caching changes, test with refresh=true and verify cache invalidation behavior.
4. Validate both API payload and frontend rendering for the impacted page.
5. Commit only relevant files and push with clear scope in commit message.

