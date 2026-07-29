---
description: Launch and drive the Agile Metric Hub locally with Docker Compose (db + api + web). Use when asked to run, start, or verify this app works end to end.
---

# Run Agile Metric Hub locally

Full stack: Postgres (`db`) + Express API (`api`, port 8000) + nginx-served
Vite/React dashboard (`web`, port 80), orchestrated by `docker-compose.yml`.

## Steps

1. **Docker Desktop must be running.**
   ```
   docker info >/dev/null 2>&1 || open -a Docker
   ```
   If it was just started, poll until ready (usually ~10-60s):
   ```
   for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
   ```

2. **`.env` file** — copy from example if missing:
   ```
   [ -f .env ] || cp .env.example .env
   ```
   ⚠️ **Gotcha:** the placeholder `JIRA_URL`/`JIRA_EMAIL`/`JIRA_API_TOKEN` values in
   `.env.example` are NOT blank — they look like real values (`https://your-company.atlassian.net`
   etc.). The backend treats non-blank values as real credentials and hits Jira, failing
   with **401 Unauthorized in a loop** instead of falling back cleanly to mock data. To
   actually get mock data, blank those three vars out. To connect to real Jira, ask the
   user for the real `JIRA_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (never guess or fabricate
   a token) and set them before starting.

3. **Build and start everything:**
   ```
   docker compose up --build -d
   ```
   First build takes a few minutes (installs pnpm workspace deps inside the images).

4. **Verify health:**
   ```
   curl -s http://localhost:8000/api/healthz        # expect {"status":"ok"}
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost/   # expect 200
   ```
   Check sync progress/result:
   ```
   docker logs agile_metrics_api --tail 50
   ```
   Look for `"Sync completed"` with `projects` > 0 and `failedProjects: 0`. Repeated
   `401 Unauthorized` warnings mean the Jira gotcha above (step 2) is in play.

5. **Login.** Default bootstrap user is `admin` / `DEFAULT_ADMIN_PASSWORD` (from `.env`)
   — but **only on a fresh Postgres volume**. Check first:
   ```
   docker volume ls | grep agile-metric-hub_postgres_data
   ```
   If the volume already existed before this run, `admin` was already bootstrapped in a
   previous session with whatever password was set then — the current `.env` value does
   **not** apply. Don't guess passwords; ask the user, or offer to reset (next step).

6. **Reset to a clean state** (wipes all data, re-bootstraps `admin` with the `.env`
   password) — only do this with explicit user confirmation, it's destructive:
   ```
   docker compose down -v
   docker compose up --build -d
   ```

7. **Applying `.env` changes** (e.g. new Jira credentials) requires recreating the `api`
   container — it reads env vars at container start, not live:
   ```
   docker compose up -d --force-recreate api
   ```
   This drops any active login session (JWT is stateless but the frontend still needs to
   re-authenticate after a page reload if it lost its token).

8. **Drive it, don't just launch it** — open the Browser pane at `http://localhost/`,
   confirm the login screen renders, and if credentials are available, log in and check
   a page that depends on real data (e.g. Resumen Ejecutivo) to confirm the Jira sync
   actually populated projects.

## Known-good verification (last run)

`docker compose up --build -d` from a clean environment (no prior containers/volumes,
Docker Desktop started cold) completed successfully in a few minutes; `/api/healthz` and
`/` both came up healthy on first try. No manual patches were needed beyond the steps
above.
