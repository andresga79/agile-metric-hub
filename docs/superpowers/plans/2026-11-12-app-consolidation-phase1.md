# App consolidation — Phase 1 (cleanup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicated/obsolete views (v2, Health page, Evolution, old WIP aging list) without losing any number, and show how fresh each project's data is.

**Architecture:** Express API (`artifacts/api-server`) + Vite/React dashboard (`artifacts/dashboard`) in a pnpm monorepo; API contract in `lib/api-spec/openapi.yaml`, clients generated with orval. Logic that can be tested lives in pure functions under `api-server/src/lib` (vitest); the dashboard has no test runner, so UI tasks are verified by typecheck + browser.

**Tech Stack:** TypeScript 5.9, Express 5, Drizzle/Postgres, React + TanStack Query + Recharts, vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-12-app-consolidation-design.md` (§5 = this plan).

## Global Constraints

- Work on branch `consolidation-phase1`, not `main`. Push only when the user asks.
- No metric-rule changes except the two the spec accepts: "% del WIP bloqueado" and member-report "días en curso" switch to `/wip`.
- Do not drop tables or delete DB rows (`metric_snapshots`, threshold rows stay).
- API: add new fields without removing old ones in the same deploy, except endpoints being deleted outright (v2, evolution, admin snapshots backfill).
- Freshness: amber when data is older than **24 h**.
- After codegen-relevant changes: `pnpm --filter @workspace/api-spec run codegen`.
- Every task ends green: `pnpm run typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm run lint` (0 errors, warnings ≤ 138).
- UI copy in Spanish (`es.json`) and English (`en.json`); keys added next to their section's keys.

## Review Focus

- A project with **no work in progress** (empty `/wip`): Resumen blocked card must show 0 / no % (not NaN or ∞) — test in Task 3.
- A blocked issue that is **not** in `/wip` (blocked in backlog): must not count in "% del WIP bloqueado" (always ≤ 100 %) — test in Task 3.
- A project with **no metric target and no threshold** for lead/cycle: Métricas charts render without a target line — test in Task 5.
- A project whose issues were **never cached** (new project / cache cleared): freshness shows "—", not an error or "hace 55 años" — test in Task 6.
- Admin presses **Sincronizar** while a sync is already running: button disabled, no second POST (server answers 409) — manual check in Task 1.

---

### Task 0: Branch

- [ ] **Step 1:** `git switch -c consolidation-phase1` from up-to-date `main`. Expected: `Switched to a new branch`.

---

### Task 1: Admin "Sincronizar" button in the current app

**Files:**
- Modify: `artifacts/dashboard/src/components/layout.tsx` (sync status block, ~lines 13–30 and ~119–125)
- Modify: `artifacts/dashboard/src/i18n/locales/{es,en}.json` (`page.dashboard.*` sync keys)

**Interfaces:**
- Consumes: `GET /api/sync/status` → `{ lastSyncedAt: string | null; isSyncing: boolean }`; `POST /api/sync/run` (admin) → 202 started / 409 already running.
- Produces: nothing other tasks use.

- [ ] **Step 1:** Port the behaviour of `runSync` / `pollUntilDone` from `artifacts/dashboard/src/v2/layout.tsx` (lines ~39–113) into `layout.tsx`: a button next to the existing "Sincronizado …" text, shown only when `user?.role === "admin"`, disabled while `isSyncing` or a POST is in flight; poll `/api/sync/status` every 5 s until `isSyncing` is false, then `queryClient.invalidateQueries()` so every screen refetches. Show the server error text if the POST fails (non-202/409).
- [ ] **Step 2:** Add keys `page.dashboard.syncNow` ("Sincronizar" / "Sync now"), `page.dashboard.syncing` ("Sincronizando…" / "Syncing…"), `page.dashboard.syncFailed` ("No se pudo sincronizar: {{error}}" / "Sync failed: {{error}}").
- [ ] **Step 3:** `pnpm run typecheck` → both packages `Done`.
- [ ] **Step 4:** `docker compose up -d --build web`; in the browser as admin press the button: it turns to "Sincronizando…", a second click does nothing, and the timestamp updates when the sync ends. As member the button is absent.
- [ ] **Step 5:** Commit `feat(layout): admins can trigger a Jira sync from the current app`.

---

### Task 2: Retire the v2 dashboard

**Files:**
- Delete: `artifacts/dashboard/src/v2/` (whole folder), `artifacts/api-server/src/routes/v2.ts`, `artifacts/api-server/src/lib/v2/` (whole folder), `artifacts/api-server/src/lib/__tests__/v2-*.test.ts` (9 files)
- Modify: `artifacts/dashboard/src/App.tsx` (remove `/v2*` routes and imports), `artifacts/dashboard/src/main.tsx` (remove `import "./v2/theme.css"`), `artifacts/api-server/src/routes/index.ts` (remove `v2Router`)
- Modify: `lib/api-spec/openapi.yaml` (remove paths `/v2/portfolio`, `/v2/projects/{projectId}/team`, `/v2/projects/{projectId}/current-sprint` and every `V2*` schema), regenerate clients
- Modify: `CLAUDE.md`, `METRICS.md` (remove/adjust v2 mentions); memory file `~/.claude/projects/-home-andres-agile-metric-hub/memory/project_dashboard_v2_redesign.md` (mark v2 code retired 2026-11-12, design ideas live on in the consolidation spec) and its `MEMORY.md` line

**Interfaces:**
- Consumes: nothing.
- Produces: no `V2*` types or `useGetV2*` hooks remain; `lib/flow-insights.ts` keeps `computeTimeInStatus`, `isWaitingStatus` (still used by the app).

- [ ] **Step 1:** Before deleting, `grep -rn "lib/v2\|/v2/\|from \"\./v2\|V2[A-Z]" artifacts lib --include=*.ts --include=*.tsx | grep -v "src/v2/\|lib/v2/\|__tests__/v2-\|generated"` → only the files listed above. If anything else appears, stop and report.
- [ ] **Step 2:** Delete and edit as listed; run codegen.
- [ ] **Step 3:** `grep -rn "V2\|/v2" artifacts/*/src lib/api-spec/openapi.yaml | grep -v generated` → no matches. Typecheck, tests (count drops by the v2 tests only), lint.
- [ ] **Step 4:** Rebuild; `curl -s -o /dev/null -w "%{http_code}" localhost:8000/api/v2/portfolio` → 404; `http://localhost/v2` shows the app's not-found page.
- [ ] **Step 5:** Commit `chore: retire the v2 dashboard (decided 2026-11-12: keep the current app)`.

---

### Task 3: Resumen and member report read WIP from `/wip`

**Files:**
- Modify: `artifacts/api-server/src/lib/wip.ts` (`WipIssueInput`, `WipItem`, `buildWip`)
- Modify: `artifacts/api-server/src/routes/wip.ts` (pass `blocked`, return `blockedNow`)
- Modify: `lib/api-spec/openapi.yaml` (`WipItem.blocked`, `WipResponse.blockedNow`), regenerate
- Modify: `artifacts/dashboard/src/pages/project-detail.tsx` (~lines 278–300, blocked card), `artifacts/dashboard/src/hooks/use-member-report-data.ts` (~line 68), `artifacts/dashboard/src/pages/project-member-report.tsx` (~lines 97–100, 225)
- Test: `artifacts/api-server/src/lib/__tests__/wip.test.ts`

**Interfaces:**
- Consumes: `isIssueCurrentlyBlocked(issue: JiraIssue): boolean` (lib/jira.ts).
- Produces: `WipIssueInput.blocked: boolean`; `WipItem.blocked: boolean`; `buildWip(...)` returns `{ items, byStatus, blockedNow: number }`; API `WipResponse.blockedNow: integer`, `WipItem.blocked: boolean`.

- [ ] **Step 1: Failing tests** in `wip.test.ts`:
  - `"counts only in-progress items that are blocked now"`: three inputs, one with `blocked: true` → `blockedNow === 1`, and that item has `blocked: true`.
  - `"no work in progress gives zero, not NaN"`: `buildWip([], now)` → `{ items: [], byStatus: [], blockedNow: 0 }`.
- [ ] **Step 2:** `pnpm --filter @workspace/api-server test wip` → FAIL (`blockedNow` undefined).
- [ ] **Step 3:** Add `blocked` to `WipIssueInput`/`WipItem`, compute `blockedNow` in `buildWip`; in `routes/wip.ts` set `blocked: isIssueCurrentlyBlocked(i)`; add the fields to the spec; codegen.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** Resumen blocked card: replace the `/analytics` `wipAgingTotal` denominator with `useGetProjectWip(projectId)`: `activeBlocked = wip.blockedNow`, `wipPercent = wip.total > 0 ? round(blockedNow / total × 100) : null`. Keep `avgDays` from `/analytics` `blockedIssues` (currently blocked ones), unchanged. Same status rule as today (≥ 5 blocked or > 20 % → critical, etc.).
- [ ] **Step 6:** Member report: "días en curso" per item = `ageDays` of the `/wip` item with the same key (fetch `/api/projects/:id/wip` in `use-member-report-data.ts`, expose `wipAgeByKey: Map<string, number>`); stop reading `analytics.wipAging`.
- [ ] **Step 7:** Typecheck, tests, lint; rebuild; Tablero (10003) Resumen shows the blocked card with a % ≤ 100.
- [ ] **Step 8:** Commit `refactor(wip): Resumen and member report read WIP from /wip`.

---

### Task 4: Delete the Health page and the old WIP aging list

**Files:**
- Delete: `artifacts/dashboard/src/pages/project-health.tsx`, `artifacts/dashboard/src/hooks/use-health-suggestions.ts`
- Modify: `artifacts/dashboard/src/App.tsx` (remove `/projects/:projectId/health` route + import)
- Modify: `artifacts/dashboard/src/pages/project-flow.tsx` (remove the aging card: `wipItems`, `wipAgingTotal`, `wipAgingCounts` and their JSX, ~lines 115–119 and ~285–330)
- Modify: `artifacts/api-server/src/routes/analytics.ts` (~lines 270–290: stop computing/returning `wipAging`, `wipAgingTotal`, `wipAgingTop`, `wipAgingCounts`)
- Modify: `artifacts/api-server/src/lib/flow-insights.ts` (delete `computeWipAging`, `getAlertLevel`, `WipAgingItem` if unused after the grep in Step 1)
- Modify: `artifacts/dashboard/src/pages/admin.tsx` (remove `wipAging` from `LOWER_BETTER` and the label map, lines ~50 and ~68)
- Modify: i18n — remove `page.health.*` keys and the `page.flow.aging*`/`critical`/`warning`/`watch` keys used only by the removed card
- Test: existing `flow-insights.test.ts` cases for the deleted functions are removed with them

**Interfaces:**
- Consumes: Task 3 (no consumer of `analytics.wipAging*` left).
- Produces: `/analytics` response without `wipAging*` fields; the API `/projects/:id/health/:period` endpoint **stays** (Report and member report read the Flow Health Score from it until phase 3).

- [ ] **Step 1:** `grep -rn "wipAging\|computeWipAging\|getAlertLevel\|use-health-suggestions\|project-health\"" artifacts --include=*.ts --include=*.tsx` → only the files listed. Otherwise stop and report.
- [ ] **Step 2:** Make the deletions/edits.
- [ ] **Step 3:** Typecheck, tests, lint.
- [ ] **Step 4:** Rebuild. Browser: Flujo shows the WIP section and no second aging list; `/projects/10003/health` shows not-found; the Métricas tab (Health's permission slot) still opens for admin and member; Report still shows "Health Score".
- [ ] **Step 5:** Commit `chore: drop the Health page and the fixed-threshold WIP aging list`.

---

### Task 5: Remove Evolution, keep its target line in Métricas

**Files:**
- Create: `artifacts/api-server/src/lib/time-targets.ts`
- Test: `artifacts/api-server/src/lib/__tests__/time-targets.test.ts`
- Modify: `artifacts/api-server/src/routes/metrics.ts` (add `timeTargets` to the `/metrics/:period` response), `lib/api-spec/openapi.yaml` (`ProjectMetrics.timeTargets`), regenerate
- Modify: `artifacts/dashboard/src/pages/project-metrics.tsx` (`PercentileChart`: `ReferenceLine` at the target)
- Delete: `artifacts/dashboard/src/pages/project-evolution.tsx`, `artifacts/api-server/src/routes/evolution.ts`, `artifacts/api-server/src/routes/admin/snapshots.ts`, `artifacts/api-server/src/lib/metric-snapshots.ts`, `artifacts/api-server/src/lib/__tests__/metric-snapshots.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts` (evolution router), `artifacts/api-server/src/routes/admin.ts` (snapshots router), `artifacts/api-server/src/lib/jira-cache.ts` (~lines 5, 209–214: stop calling `storeWeeklySnapshots`), `artifacts/dashboard/src/App.tsx` (evolution route), `artifacts/dashboard/src/lib/project-section-permissions.ts` (evolution link), `artifacts/dashboard/src/components/project-tabs.tsx` (evolution in ORDERED/PRIMARY lists and icon), openapi (`/projects/{projectId}/evolution` + `Evolution*` schemas), i18n `page.evolution.*`
- Modify: `CLAUDE.md` (remove the snapshot backfill command from Run & Operate), `METRICS.md` (Evolution section → one line: removed 2026-11-12, target line now in Métricas; `metric_snapshots` kept, no longer written)

**Interfaces:**
- Consumes: `getEffectiveThresholds(projectId)` → `Record<string, { goodValue: number; ... }>` (lib/health-thresholds.ts); `metric_targets` rows `{ metric, period, targetValue: string }`.
- Produces: `pickTimeTarget(targets: { metric: string; period: string; targetValue: string }[], thresholds: Record<string, { goodValue: number }>, metric: "leadTime" | "cycleTime"): number | null`; API `ProjectMetrics.timeTargets: { leadTime: number | null; cycleTime: number | null }`. The `evolution` value stays in `SECTION_NAMES` / DB permission rows (harmless) — do not migrate permissions.

- [ ] **Step 1: Failing tests** in `time-targets.test.ts` (same rule as today's `pickTarget` in `routes/evolution.ts`):
  - `"prefers the project's 3m target"`: targets `[{metric:"leadTime",period:"1m",targetValue:"9"},{metric:"leadTime",period:"3m",targetValue:"12"}]` → `12`.
  - `"falls back to any project target"`: only the `1m` row → `9`.
  - `"falls back to the admin good threshold"`: no rows, thresholds `{ leadTime: { goodValue: 25 } }` → `25`.
  - `"null when there is neither"`: `pickTimeTarget([], {}, "cycleTime")` → `null`.
- [ ] **Step 2:** Run → FAIL (module missing).
- [ ] **Step 3:** Implement `pickTimeTarget`; in `/metrics/:period` load `metricTargetsTable` rows for the project and `getEffectiveThresholds(projectId)` and add `timeTargets`; spec + codegen.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** `PercentileChart` gets `target: number | null`; when not null draw a dashed `ReferenceLine` labelled with the existing `page.evolution.target` text moved to `page.metrics.target` ("Meta" / "Target"). No line when null.
- [ ] **Step 6:** Delete Evolution and snapshot code as listed (grep first for `metric-snapshots`, `evolution`, `storeWeeklySnapshots`, `backfillWeeklySnapshots` — only the listed files may match).
- [ ] **Step 7:** Typecheck, tests, lint; rebuild. Browser: no Evolución tab; Métricas lead/cycle charts for Tablero show the "Meta" line at the same value Evolución used; `curl localhost:8000/api/projects/10003/evolution` → 404 (with token). API logs: no snapshot writes during a sync.
- [ ] **Step 8:** Commit `feat(metrics): target line moves to Métricas; Evolution and weekly snapshots removed`.

---

### Task 6: Data freshness on every project page and in the Resumen Ejecutivo

**Files:**
- Create: `artifacts/api-server/src/lib/freshness.ts`, `artifacts/api-server/src/routes/freshness.ts`
- Test: `artifacts/api-server/src/lib/__tests__/freshness.test.ts`
- Modify: `artifacts/api-server/src/lib/jira-cache.ts` (add `getLatestCacheTimestamp`), `artifacts/api-server/src/lib/jira.ts` (add `getProjectDataFetchedAt`), `artifacts/api-server/src/routes/index.ts`, `lib/api-spec/openapi.yaml`, regenerate
- Create: `artifacts/dashboard/src/components/data-freshness.tsx`; Modify: `artifacts/dashboard/src/components/project-tabs.tsx` (render it at the right end of the tab row, so every project page shows it)
- Modify: `artifacts/dashboard/src/pages/dashboard.tsx` (`STALE_AFTER_MS` 26 h → 24 h; always show the per-project date, amber when stale)
- i18n: `page.freshness.*`

**Interfaces:**
- Produces:
  - `getLatestCacheTimestamp(keyPrefix: string): Promise<Date | null>` — `MAX(fetched_at)` of `jira_cache` rows whose key starts with `scopedCacheKey(keyPrefix)`.
  - `getProjectDataFetchedAt(projectId: string): Promise<Date | null>` — `getLatestCacheTimestamp(\`issues:${await getCanonicalProjectId(projectId)}:\`)`.
  - `freshness(fetchedAt: Date | null, now: Date): { fetchedAt: string | null; stale: boolean }` — `stale = fetchedAt !== null && now − fetchedAt > 24 h`.
  - `GET /projects/:projectId/freshness` (requireAuth, no section gate) → `{ fetchedAt: string | null; stale: boolean }`; schema `DataFreshness`; hook `useGetProjectFreshness`.
- Decision recorded here (spec §8 leaves it to the builder): MAX, not MIN, of the project's issue-cache rows — an old row for a period nobody requested lately must not paint the page amber; MAX = "the last time this project's data came from Jira".

- [ ] **Step 1: Failing tests** in `freshness.test.ts`:
  - `"never cached → no date, not stale"`: `freshness(null, now)` → `{ fetchedAt: null, stale: false }`.
  - `"23 h old is fresh"` and `"25 h old is stale"` with exact ISO strings.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the three functions and the route; register it; spec + codegen.
- [ ] **Step 4:** Tests PASS.
- [ ] **Step 5:** `DataFreshness({ projectId })`: "Datos de Jira: hace 2 h (12/11 10:40)"; "—" when `fetchedAt` is null; amber text + `title` "Los datos tienen más de 24 h: puede haber cambios en Jira que no se ven" when `stale`.
- [ ] **Step 6:** Resumen Ejecutivo: show the date for every project row (small, muted) and amber when older than 24 h.
- [ ] **Step 7:** Typecheck, tests, lint; rebuild. Browser: Tablero pages show a recent date; in the Resumen Ejecutivo any project with `portfolio_cache` older than 24 h (EN/DCX if still stale) shows amber.
- [ ] **Step 8:** Commit `feat: show how fresh each project's Jira data is`.

---

### Task 7: Final verification and docs

- [ ] **Step 1:** Spec §5 acceptance list, one by one, with evidence (curl with a real token + browser on Tablero 10003, per `CLAUDE.md` methodology). A token is needed: ask the user to log in in the browser, or to run `! curl` themselves.
- [ ] **Step 2:** `grep -rn "Health\b\|Evoluci\|/v2\|wipAging" artifacts/dashboard/src --include=*.tsx | grep -v i18n` → only intentional references (e.g. "Health Score" in Report/Executive).
- [ ] **Step 3:** `METRICS.md` / `CLAUDE.md` reflect: v2 retired, Health page removed (score stays until phase 3), Evolution removed, snapshots not written, freshness rule (MAX of issue cache, 24 h).
- [ ] **Step 4:** Whole-branch review (`superpowers:requesting-code-review`), fix findings, then `superpowers:finishing-a-development-branch`. Push only when the user asks.
