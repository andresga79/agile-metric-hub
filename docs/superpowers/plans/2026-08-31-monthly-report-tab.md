# Tab "Informe" (reporte mensual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing (but unused) `/projects/:id/report` tab so it shows sprint goal, active blockers, auto-generated "decisiones importantes" insights, and upcoming production releases from the Jira `RC` project — turning it into the monthly report demoed to the user as a hand-built artifact.

**Architecture:** No new tab is created — `artifacts/dashboard/src/pages/project-report.tsx` already exists, is routed, and is RBAC-wired, but sits unused behind the "Más" dropdown with print-only styling. This plan (a) fixes that page to reuse the app's real (theme-aware) card components and pull two more already-existing endpoints (`sprints/:period`, `analytics/:period`), (b) adds three small new backend pieces — sprint goal, RC release readiness, and a testable insights endpoint — following the same "each endpoint whitelists `report`" pattern already used by `metrics.ts`, `project-health.ts`, and `cfd.ts`, and (c) adds an Admin sub-section to map RC epics to a project via keywords.

**Tech Stack:** Express 5 + Drizzle ORM (Postgres) on the backend, Vite/React + wouter + react-i18next on the frontend, vitest for pure-logic tests.

**Spec:** `docs/superpowers/specs/2026-08-31-monthly-report-tab-design.md`

## Global Constraints

- No new mega-endpoint: every new backend addition is small and single-purpose (spec decision).
- "Decisiones importantes" is 100% auto-generated from metrics — no manual/editable field in this iteration (spec decision).
- RC project epics sync **once per full sync cycle**, not once per project — `project = RC` is shared by 5 células, not just this project (spec decision, avoids 5x redundant fetches under the existing `concurrency=1` sync).
- RC→project mapping is a manual Admin-configured keyword list per project, not automatic text matching (spec decision).
- Sections with no data render nothing (no placeholder, no "N/A" block) — same convention already used for duration metrics when no work resolved (`ed4aa68`).
- Every endpoint that already exists and the report page starts consuming (`sprints/:period`) must add `"report"` to its `requireSectionView(...)` call, matching the existing pattern in `metrics.ts:395`, `project-health.ts:34`, `cfd.ts:109`, `qa-rejected.ts:147`.
- Run `pnpm run typecheck` before every commit that touches TypeScript; run `pnpm --filter @workspace/api-server test` after any change under `artifacts/api-server/src/lib` or `routes`.
- `drizzle-kit push` diffs must be reviewed before applying (project gotcha — see root `CLAUDE.md`).

---

## File Map

**Backend — new files:**
- `lib/db/src/schema/release-epics.ts` — `release_epics` table (RC project cache)
- `lib/db/src/schema/project-release-keywords.ts` — `project_release_keywords` table (Admin mapping)
- `artifacts/api-server/src/lib/release-sync.ts` — fetches RC project epics from Jira, replaces `release_epics` table contents
- `artifacts/api-server/src/lib/report-insights.ts` — pure functions for "decisiones importantes" rules + types
- `artifacts/api-server/src/lib/__tests__/report-insights.test.ts` — unit tests for the rules above
- `artifacts/api-server/src/routes/release-readiness.ts` — `GET /projects/:id/release-readiness`, `GET/POST/DELETE /admin/projects/:id/release-keywords`
- `artifacts/api-server/src/routes/report-insights.ts` — `GET /projects/:id/report-insights`, `GET /projects/:id/sprint-goal`

**Backend — modified files:**
- `artifacts/api-server/src/lib/jira.ts` — add `goal?: string` to `JiraSprint`; add `fetchReleaseCoordinationEpics()`
- `artifacts/api-server/src/lib/jira-cache.ts` — call `syncReleaseEpics()` once per `executeSync()` cycle
- `artifacts/api-server/src/routes/sprint-metrics.ts` — export `computeSprintMetrics`/`SprintMetric`; add `"report"` to its `requireSectionView`
- `artifacts/api-server/src/routes/analytics.ts` — export `computePeriodMetrics`
- `artifacts/api-server/src/routes/index.ts` — register the two new routers
- `lib/db/src/schema/index.ts` — export the two new schema files

**Frontend — new files:**
- `artifacts/dashboard/src/hooks/use-report-data.ts` — fetches sprint-goal, release-readiness, report-insights, blocked issues (from analytics), sprint breakdown (from sprints)
- `artifacts/dashboard/src/pages/admin-release-keywords.tsx` — Admin sub-page for RC keyword mapping

**Frontend — modified files:**
- `artifacts/dashboard/src/pages/project-report.tsx` — rewritten to use theme-aware `Card` components and render the new sections
- `artifacts/dashboard/src/i18n/locales/es.json` / `en.json` — fill in the empty `page.report.*` keys + new ones
- `artifacts/dashboard/src/pages/admin.tsx` — add nav entry to the new Admin sub-page (exact insertion point identified in Task 12)

---

### Task 1: Sprint goal — type + endpoint

**Files:**
- Modify: `artifacts/api-server/src/lib/jira.ts:571` (the `JiraSprint` interface)
- Create: `artifacts/api-server/src/routes/report-insights.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Produces: `JiraSprint.goal?: string` (consumed by Task 1's own endpoint and by Task 8's insights).
- Produces: `GET /projects/:projectId/sprint-goal` → `{ sprintName: string; goal: string } | null`.

- [ ] **Step 1: Add `goal` to `JiraSprint`**

In `artifacts/api-server/src/lib/jira.ts`, change:

```ts
export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}
```

to:

```ts
export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}
```

No other change needed here — `getJiraSprints` already returns the raw Agile API payload through `jiraAgileFetch<{ values: JiraSprint[] ... }>`, so `goal` flows through automatically once it's on the type.

- [ ] **Step 2: Create the route file with the sprint-goal endpoint**

Create `artifacts/api-server/src/routes/report-insights.ts`:

```ts
import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getJiraSprints, getProjectBoardType } from "../lib/jira";

const router: IRouter = Router();

router.get(
  "/projects/:projectId/sprint-goal",
  requireAuth,
  requireSectionView("sprints", "report"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;

    const boardType = await getProjectBoardType(projectId);
    if (boardType !== "scrum") {
      res.json(null);
      return;
    }

    const sprints = await getJiraSprints(projectId, 50);
    const active = sprints.find((s) => s.state === "active");
    if (!active || !active.goal || active.goal.trim() === "") {
      res.json(null);
      return;
    }

    res.json({ sprintName: active.name, goal: active.goal.trim() });
  }
);

export default router;
```

- [ ] **Step 3: Register the router**

In `artifacts/api-server/src/routes/index.ts`, add the import next to the other route imports:

```ts
import reportInsightsRouter from "./report-insights";
```

and register it next to the other `router.use(...)` calls:

```ts
router.use(reportInsightsRouter);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/jira.ts artifacts/api-server/src/routes/report-insights.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: add sprint goal to JiraSprint and expose /sprint-goal endpoint"
```

---

### Task 2: `release_epics` and `project_release_keywords` schema

**Files:**
- Create: `lib/db/src/schema/release-epics.ts`
- Create: `lib/db/src/schema/project-release-keywords.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**
- Produces: `releaseEpicsTable`, `ReleaseEpic`, `InsertReleaseEpic` (consumed by Task 3, Task 5).
- Produces: `projectReleaseKeywordsTable`, `ReleaseKeyword`, `insertReleaseKeywordSchema` (consumed by Task 5).

- [ ] **Step 1: Create the `release_epics` schema**

Create `lib/db/src/schema/release-epics.ts`:

```ts
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Cache of Jira project RC (Release Coordination) epics, shared across all 5 células
// (Orvix Chile/OLP, Orvix Int. I, Orvix Int. II, Xtrider, Docuvex). Synced once per full
// sync cycle (not once per project) and filtered per-project at read time using
// project_release_keywords - see release-sync.ts.
export const releaseEpicsTable = pgTable("release_epics", {
  id: serial("id").primaryKey(),
  issueKey: text("issue_key").notNull().unique(),
  summary: text("summary").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  statusCategory: text("status_category").notNull(),
  assignee: text("assignee"),
  jiraUpdatedAt: timestamp("jira_updated_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReleaseEpicSchema = createInsertSchema(releaseEpicsTable).omit({
  id: true,
  syncedAt: true,
});

export type InsertReleaseEpic = z.infer<typeof insertReleaseEpicSchema>;
export type ReleaseEpic = typeof releaseEpicsTable.$inferSelect;
```

- [ ] **Step 2: Create the `project_release_keywords` schema**

Create `lib/db/src/schema/project-release-keywords.ts`:

```ts
import { pgTable, text, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-configured mapping from a dashboard project to keyword(s) that identify its
// epics inside the shared Jira RC (Release Coordination) project - RC has no
// structured link back to individual projects, so this is text matched against each
// release_epics row's summary/description at read time (see release-readiness.ts).
export const projectReleaseKeywordsTable = pgTable(
  "project_release_keywords",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    keyword: text("keyword").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.keyword)]
);

export const insertReleaseKeywordSchema = createInsertSchema(projectReleaseKeywordsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertReleaseKeyword = z.infer<typeof insertReleaseKeywordSchema>;
export type ReleaseKeyword = typeof projectReleaseKeywordsTable.$inferSelect;
```

- [ ] **Step 3: Export both from the schema index**

In `lib/db/src/schema/index.ts`, add:

```ts
export * from "./release-epics";
export * from "./project-release-keywords";
```

- [ ] **Step 4: Push the schema and review the diff**

Run: `cd lib/db && pnpm push`
Expected: prompts to create `release_epics` and `project_release_keywords` — confirm only those two tables are created (per project `CLAUDE.md` gotcha, read the diff before accepting; if anything else is proposed, stop and investigate before continuing).

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/release-epics.ts lib/db/src/schema/project-release-keywords.ts lib/db/src/schema/index.ts
git commit -m "feat: add release_epics and project_release_keywords tables"
```

---

### Task 3: RC project sync (once per sync cycle)

**Files:**
- Modify: `artifacts/api-server/src/lib/jira.ts` (add `fetchReleaseCoordinationEpics`)
- Create: `artifacts/api-server/src/lib/release-sync.ts`
- Modify: `artifacts/api-server/src/lib/jira-cache.ts:234-259` (`executeSync`)

**Interfaces:**
- Consumes: `releaseEpicsTable`, `InsertReleaseEpic` from Task 2.
- Produces: `syncReleaseEpics(): Promise<void>` (consumed by Task 3 Step 4, called from `jira-cache.ts`).
- Produces: `fetchReleaseCoordinationEpics(): Promise<RawRCEpic[]>` in `jira.ts` (consumed only by `release-sync.ts`).

- [ ] **Step 1: Add the RC fetch function to `jira.ts`**

Add near `getJiraProject` in `artifacts/api-server/src/lib/jira.ts` (same file, so it can reuse the private `jiraFetch` helper already defined there):

```ts
export interface RawRCEpic {
  key: string;
  summary: string;
  description: string | null;
  status: string;
  statusCategory: string;
  assignee: string | null;
  updated: string;
}

// Jira project RC (Release Coordination) tracks production releases for all 5 células
// sharing this Jira instance - not scoped to any one project. Called once per sync
// cycle by release-sync.ts, not per-project.
export async function fetchReleaseCoordinationEpics(): Promise<RawRCEpic[]> {
  if (!isJiraConfigured()) return [];

  const fields = "summary,description,status,assignee,updated";
  const jql = encodeURIComponent("project = RC ORDER BY updated DESC");
  const all: RawRCEpic[] = [];
  let pageToken: string | null = null;

  try {
    for (let page = 0; page < 5; page++) {
      const result = await jiraFetch<{
        issues: {
          key: string;
          fields: {
            summary: string;
            description?: unknown;
            status: { name: string; statusCategory: { key: string } };
            assignee: { displayName: string } | null;
            updated: string;
          };
        }[];
        nextPageToken?: string;
      }>(
        `/search/jql?jql=${jql}&maxResults=50&fields=${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
      );

      for (const issue of result.issues ?? []) {
        all.push({
          key: issue.key,
          summary: issue.fields.summary,
          description: issue.fields.description ? adfToPlainText(issue.fields.description) : null,
          status: issue.fields.status.name,
          statusCategory: issue.fields.status.statusCategory.key,
          assignee: issue.fields.assignee?.displayName ?? null,
          updated: issue.fields.updated,
        });
      }

      if (!result.nextPageToken) break;
      pageToken = result.nextPageToken;
    }
  } catch (err) {
    logger.warn({ err }, "Failed to fetch RC (Release Coordination) epics");
    return [];
  }

  return all;
}
```

Check `adfToPlainText` is already exported from `jira.ts` (it's imported by `analytics.ts` at line ~23, confirming it lives in this file) — no new import needed since this function is added inside `jira.ts` itself.

- [ ] **Step 2: Create the sync orchestrator**

Create `artifacts/api-server/src/lib/release-sync.ts`:

```ts
import { db, releaseEpicsTable } from "@workspace/db";
import { fetchReleaseCoordinationEpics } from "./jira";
import { logger } from "./logger";

/**
 * Replaces the full contents of release_epics with the current state of Jira project RC.
 * Called once per sync cycle (see jira-cache.ts executeSync) - RC is shared across all
 * projects, so this must not run inside the per-project warm loop.
 */
export async function syncReleaseEpics(): Promise<void> {
  const epics = await fetchReleaseCoordinationEpics();
  if (epics.length === 0) {
    logger.info("No RC epics fetched, leaving release_epics untouched");
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(releaseEpicsTable);
    await tx.insert(releaseEpicsTable).values(
      epics.map((e) => ({
        issueKey: e.key,
        summary: e.summary,
        description: e.description,
        status: e.status,
        statusCategory: e.statusCategory,
        assignee: e.assignee,
        jiraUpdatedAt: new Date(e.updated),
      }))
    );
  });

  logger.info({ count: epics.length }, "Synced RC (Release Coordination) epics");
}
```

- [ ] **Step 3: Hook it into the sync cycle**

In `artifacts/api-server/src/lib/jira-cache.ts`, add the import at the top:

```ts
import { syncReleaseEpics } from "./release-sync";
```

Then in `executeSync` (around line 242-244), change:

```ts
  try {
    await warmVisibleProjectsCache(forceRefresh);
    await calculateAndCachePortfolio({ forceRefresh });
```

to:

```ts
  try {
    await warmVisibleProjectsCache(forceRefresh);
    await syncReleaseEpics().catch((err) => {
      logger.warn({ err }, "RC epics sync failed, continuing");
    });
    await calculateAndCachePortfolio({ forceRefresh });
```

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/jira.ts artifacts/api-server/src/lib/release-sync.ts artifacts/api-server/src/lib/jira-cache.ts
git commit -m "feat: sync Jira RC (Release Coordination) project once per sync cycle"
```

---

### Task 4: Verify RC sync against real Jira data

**Files:** none (verification only)

- [ ] **Step 1: Trigger a manual sync**

Follow the `run-app` skill to get the stack up, log in as `admin`, then trigger sync (existing "Sincronizado: Hace Xh" UI has a manual sync action, or call the existing manual-sync endpoint used by `sync-status.ts`).

- [ ] **Step 2: Confirm the table populated**

Run: `docker compose exec db psql -U postgres -d agile_metric_hub -c "SELECT issue_key, status, jira_updated_at FROM release_epics ORDER BY jira_updated_at DESC LIMIT 10;"`
Expected: rows including `RC-22`, `RC-21`, `RC-18` (confirmed to exist from this session's manual Jira query) with correct `status`.

(No commit — verification step.)

---

### Task 5: Release readiness endpoint + Admin keyword CRUD

**Files:**
- Create: `artifacts/api-server/src/routes/release-readiness.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Test: `artifacts/api-server/src/routes/__tests__/release-readiness.test.ts`

**Interfaces:**
- Consumes: `releaseEpicsTable`, `projectReleaseKeywordsTable` from Task 2.
- Produces: `GET /projects/:projectId/release-readiness` → `{ configured: false } | { configured: true, epics: { issueKey, summary, description, status, statusCategory, assignee, jiraUpdatedAt, linkedIssueKeys: string[] }[] }` (max 5, newest first).
- Produces: `GET/POST/DELETE /admin/projects/:projectId/release-keywords` (consumed by Task 12's admin page).
- Produces: `extractLinkedIssueKeys(description: string | null): string[]` (a small pure function, exported for the unit test in this task).

**Design note (added after Task 1, during a mid-plan discussion with the user):** the user asked whether the report's "highlighted functionality" could be tied to the sprint goal automatically. We tested this empirically against real Jira data for Olimpo: Sprint 113's goal was "certificar CxC / avanzar en Ley de protección de Datos", and a JQL full-text search for the literal term `"CxC"` returned two unrelated issues (`OLP-3942`, `OLP-3925`) — Jira's text search does not expand the domain acronym "CxC" (= "Contrato por Custodia") to match issues about "Custodia". Free-text matching against the raw goal string is therefore unreliable and was rejected. What IS reliable: RC epic `RC-22`'s description already enumerates the real issue keys implementing that release ("Historias de Usuario: OLP-3592, OLP-3868, ..."). `linkedIssueKeys` extracts exactly that structured list — it is Jira's own release documentation, not a heuristic guess.

- [ ] **Step 1: Write the failing test for `extractLinkedIssueKeys`**

Create `artifacts/api-server/src/routes/__tests__/release-readiness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractLinkedIssueKeys } from "../release-readiness";

describe("extractLinkedIssueKeys", () => {
  it("extracts issue keys listed in a real RC-22-shaped description", () => {
    // Matches this session's real RC-22 description for Olimpo's "Contrato por Custodia" release.
    const description = `**Paquete de Paso a Producción (PAP)**
**Release**: Orvix-2026.09.02 - Chile
**Proyecto**: OLP (Orvix)

**3. Tarjetas Informadas**
Historias de Usuario: OLP-3592, OLP-3868, OLP-3591, OLP-3590, OLP-3867, OLP-3641, OLP-3751, OLP-3922, OLP-3926, OLP-3730, OLP-3705, OLP-3658, OLP-3750, OLP-3706, OLP-3846, OLP-3866, OLP-3915.
Tareas Técnicas: OLP-3660, OLP-3661, OLP-3664.
Spikes: OLP-3451.

Ver [RC-22](https://nxtaraspa.atlassian.net/browse/RC-22) y [OP-1193](https://nxtaraspa.atlassian.net/browse/OP-1193).`;

    const keys = extractLinkedIssueKeys(description);

    expect(keys).toContain("OLP-3592");
    expect(keys).toContain("OLP-3660");
    expect(keys).toContain("OLP-3451");
    expect(keys).toContain("OP-1193");
    // The epic's own key and self-references must not appear in its own linked list.
    expect(keys).not.toContain("RC-22");
  });

  it("deduplicates repeated keys", () => {
    const keys = extractLinkedIssueKeys("See OLP-100 and again OLP-100.");
    expect(keys.filter((k) => k === "OLP-100")).toHaveLength(1);
  });

  it("returns an empty array for null or empty description", () => {
    expect(extractLinkedIssueKeys(null)).toEqual([]);
    expect(extractLinkedIssueKeys("")).toEqual([]);
  });

  it("excludes the RC project's own keys (RC-*) since those are the epic itself, not linked work", () => {
    const keys = extractLinkedIssueKeys("Related to RC-21 and RC-18, implements OLP-3592.");
    expect(keys).toEqual(["OLP-3592"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/api-server test -- release-readiness`
Expected: FAIL — `Cannot find module '../release-readiness'` (the route file doesn't exist yet).

- [ ] **Step 3: Write the route file**

Create `artifacts/api-server/src/routes/release-readiness.ts`:

```ts
import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { db, releaseEpicsTable, projectReleaseKeywordsTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";

const router: IRouter = Router();

// Pulls the real issue keys an RC (Release Coordination) epic's description already lists
// as "what this release deploys" (see NXT-REG-RRC-style PAP docs, e.g. RC-22's "Historias de
// Usuario: OLP-3592, ..." section). This is Jira's own release documentation, not a guess -
// free-text matching against the sprint goal was tried and rejected (see this task's design
// note in the plan: "CxC" does not text-match "Custodia" issues via Jira search).
export function extractLinkedIssueKeys(description: string | null): string[] {
  if (!description) return [];
  const matches = description.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
  const unique = Array.from(new Set(matches));
  return unique.filter((key) => !key.startsWith("RC-"));
}

router.get(
  "/projects/:projectId/release-readiness",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;

    const keywords = await db
      .select({ keyword: projectReleaseKeywordsTable.keyword })
      .from(projectReleaseKeywordsTable)
      .where(eq(projectReleaseKeywordsTable.projectId, projectId));

    if (keywords.length === 0) {
      res.json({ configured: false });
      return;
    }

    const matchConditions = keywords.flatMap((k) => [
      ilike(releaseEpicsTable.summary, `%${k.keyword}%`),
      ilike(releaseEpicsTable.description, `%${k.keyword}%`),
    ]);

    const epics = await db
      .select()
      .from(releaseEpicsTable)
      .where(or(...matchConditions))
      .orderBy(releaseEpicsTable.jiraUpdatedAt)
      .limit(5);

    res.json({
      configured: true,
      epics: epics.reverse().map((e) => ({
        issueKey: e.issueKey,
        summary: e.summary,
        description: e.description,
        status: e.status,
        statusCategory: e.statusCategory,
        assignee: e.assignee,
        jiraUpdatedAt: e.jiraUpdatedAt.toISOString(),
        linkedIssueKeys: extractLinkedIssueKeys(e.description),
      })),
    });
  }
);

router.get(
  "/admin/projects/:projectId/release-keywords",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const rows = await db
      .select()
      .from(projectReleaseKeywordsTable)
      .where(eq(projectReleaseKeywordsTable.projectId, projectId));
    res.json(rows);
  }
);

router.post(
  "/admin/projects/:projectId/release-keywords",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const { keyword } = req.body as { keyword?: string };
    if (typeof keyword !== "string" || keyword.trim() === "" || keyword.length > 100) {
      res.status(400).json({ error: "keyword must be a non-empty string up to 100 characters" });
      return;
    }
    const saved = await db
      .insert(projectReleaseKeywordsTable)
      .values({ projectId, keyword: keyword.trim() })
      .onConflictDoNothing()
      .returning();
    res.status(201).json(saved[0] ?? null);
  }
);

router.delete(
  "/admin/projects/:projectId/release-keywords/:keywordId",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const keywordId = Array.isArray(req.params.keywordId) ? req.params.keywordId[0]! : req.params.keywordId!;
    await db.delete(projectReleaseKeywordsTable).where(eq(projectReleaseKeywordsTable.id, Number(keywordId)));
    res.status(204).end();
  }
);

export default router;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/api-server test -- release-readiness`
Expected: PASS (4 tests).

- [ ] **Step 5: Register the router**

In `artifacts/api-server/src/routes/index.ts`, add:

```ts
import releaseReadinessRouter from "./release-readiness";
```

and:

```ts
router.use(releaseReadinessRouter);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/release-readiness.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/__tests__/release-readiness.test.ts
git commit -m "feat: add release-readiness endpoint with linked-issue extraction and admin keyword CRUD"
```

---

### Task 6: Seed OLP release keywords

**Files:** none (data seed via API, done in Task 4's already-running stack)

- [ ] **Step 1: Add the two keywords found this session for OLP (project 10003)**

Run (with a real admin bearer token, per project methodology):

```bash
curl -X POST http://localhost/api/admin/projects/10003/release-keywords \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"keyword":"OLP"}'
curl -X POST http://localhost/api/admin/projects/10003/release-keywords \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"keyword":"Orvix Chile"}'
```

- [ ] **Step 2: Confirm release-readiness now returns RC-22/RC-21/RC-18**

Run: `curl http://localhost/api/projects/10003/release-readiness -H "Authorization: Bearer $TOKEN"`
Expected: `{"configured":true,"epics":[...RC-22, RC-21, RC-18...]}`.

(No commit — data seed, not code.)

---

### Task 7: "Decisiones importantes" pure logic + tests

**Files:**
- Create: `artifacts/api-server/src/lib/report-insights.ts`
- Test: `artifacts/api-server/src/lib/__tests__/report-insights.test.ts`

**Interfaces:**
- Produces: `detectCompletionDrop(sprints: ClosedSprintSummary[]): CompletionDropInsight | null`
- Produces: `detectThresholdCrossing(metric: "cycleTime" | "leadTime", current: number | null, previous: number | null, threshold: EffectiveThreshold | undefined): ThresholdCrossingInsight | null`
- Produces: types `ClosedSprintSummary`, `CompletionDropInsight`, `ThresholdCrossingInsight` (consumed by Task 8's route).
- Consumes: `EffectiveThreshold`, `classify` from `../lib/health-thresholds` (already exist).

- [ ] **Step 1: Write the failing tests**

Create `artifacts/api-server/src/lib/__tests__/report-insights.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectCompletionDrop, detectThresholdCrossing } from "../report-insights";

describe("detectCompletionDrop", () => {
  it("flags a drop greater than 15 points between the two most recent closed sprints", () => {
    // Matches this session's real data: Sprint 111 92.2% -> Sprint 112 66.7%.
    const sprints = [
      { name: "Tablero Sprint 111", state: "closed" as const, completionRate: 92.2 },
      { name: "Tablero Sprint 112", state: "closed" as const, completionRate: 66.7 },
      { name: "Tablero Sprint 113", state: "active" as const, completionRate: 15.2 },
    ];
    const result = detectCompletionDrop(sprints);
    expect(result).not.toBeNull();
    expect(result?.previousSprintName).toBe("Tablero Sprint 111");
    expect(result?.currentSprintName).toBe("Tablero Sprint 112");
    expect(result?.dropPoints).toBeCloseTo(25.5, 1);
  });

  it("returns null when the drop is 15 points or less", () => {
    const sprints = [
      { name: "S1", state: "closed" as const, completionRate: 80 },
      { name: "S2", state: "closed" as const, completionRate: 66 },
    ];
    expect(detectCompletionDrop(sprints)).toBeNull();
  });

  it("returns null with fewer than two closed sprints", () => {
    const sprints = [{ name: "S1", state: "closed" as const, completionRate: 80 }];
    expect(detectCompletionDrop(sprints)).toBeNull();
  });

  it("ignores the active sprint when picking the two most recent closed ones", () => {
    const sprints = [
      { name: "S1", state: "closed" as const, completionRate: 90 },
      { name: "S2", state: "closed" as const, completionRate: 85 },
      { name: "S3", state: "active" as const, completionRate: 10 },
    ];
    expect(detectCompletionDrop(sprints)).toBeNull();
  });
});

describe("detectThresholdCrossing", () => {
  const cycleTimeThreshold = { goodValue: 15, warningValue: 25, isOverride: false };

  it("flags a metric that crossed from good/warning into critical", () => {
    const result = detectThresholdCrossing("cycleTime", 38.1, 13.1, cycleTimeThreshold);
    expect(result).not.toBeNull();
    expect(result?.metric).toBe("cycleTime");
    expect(result?.toBand).toBe("critical");
  });

  it("returns null when the metric was already critical (no crossing)", () => {
    const result = detectThresholdCrossing("cycleTime", 38.1, 30, cycleTimeThreshold);
    expect(result).toBeNull();
  });

  it("returns null when either value is missing", () => {
    expect(detectThresholdCrossing("cycleTime", null, 13.1, cycleTimeThreshold)).toBeNull();
    expect(detectThresholdCrossing("cycleTime", 38.1, null, cycleTimeThreshold)).toBeNull();
  });

  it("returns null when no threshold is configured", () => {
    expect(detectThresholdCrossing("cycleTime", 38.1, 13.1, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @workspace/api-server test -- report-insights`
Expected: FAIL — `Cannot find module '../report-insights'`.

- [ ] **Step 3: Implement the pure functions**

Create `artifacts/api-server/src/lib/report-insights.ts`:

```ts
import { classify, type EffectiveThreshold, type HealthBand } from "./health-thresholds";

export interface ClosedSprintSummary {
  name: string;
  state: "closed" | "active";
  completionRate: number;
}

export interface CompletionDropInsight {
  type: "completionDrop";
  previousSprintName: string;
  previousCompletionRate: number;
  currentSprintName: string;
  currentCompletionRate: number;
  dropPoints: number;
}

// A drop this large between two consecutive closed sprints is worth surfacing in a
// monthly report even without knowing *why* it happened - it's a concrete number the
// PO/SM can bring to retro, not a diagnosis.
const COMPLETION_DROP_THRESHOLD_POINTS = 15;

export function detectCompletionDrop(sprints: ClosedSprintSummary[]): CompletionDropInsight | null {
  const closed = sprints.filter((s) => s.state === "closed");
  if (closed.length < 2) return null;

  const [previous, current] = closed.slice(-2);
  const dropPoints = previous!.completionRate - current!.completionRate;
  if (dropPoints <= COMPLETION_DROP_THRESHOLD_POINTS) return null;

  return {
    type: "completionDrop",
    previousSprintName: previous!.name,
    previousCompletionRate: previous!.completionRate,
    currentSprintName: current!.name,
    currentCompletionRate: current!.completionRate,
    dropPoints,
  };
}

export interface ThresholdCrossingInsight {
  type: "thresholdCrossing";
  metric: "cycleTime" | "leadTime";
  previousValue: number;
  currentValue: number;
  fromBand: HealthBand;
  toBand: HealthBand;
}

export function detectThresholdCrossing(
  metric: "cycleTime" | "leadTime",
  currentValue: number | null,
  previousValue: number | null,
  threshold: EffectiveThreshold | undefined
): ThresholdCrossingInsight | null {
  if (currentValue === null || previousValue === null || !threshold) return null;

  const fromBand = classify(previousValue, threshold, "lowerBetter");
  const toBand = classify(currentValue, threshold, "lowerBetter");
  if (toBand !== "critical" || fromBand === "critical") return null;

  return {
    type: "thresholdCrossing",
    metric,
    previousValue,
    currentValue,
    fromBand,
    toBand,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/api-server test -- report-insights`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/report-insights.ts artifacts/api-server/src/lib/__tests__/report-insights.test.ts
git commit -m "feat: add auto-generated report insight rules with tests"
```

---

### Task 8: Report insights endpoint

**Files:**
- Modify: `artifacts/api-server/src/routes/sprint-metrics.ts` (export `computeSprintMetrics`, `SprintMetric`; widen `requireSectionView`)
- Modify: `artifacts/api-server/src/routes/analytics.ts` (export `computePeriodMetrics`)
- Modify: `artifacts/api-server/src/routes/report-insights.ts` (add the `/report-insights` route to the file created in Task 1)

**Interfaces:**
- Consumes: `computeSprintMetrics`, `SprintMetric` (now exported from `sprint-metrics.ts`).
- Consumes: `computePeriodMetrics` (now exported from `analytics.ts`).
- Consumes: `detectCompletionDrop`, `detectThresholdCrossing` from Task 7.
- Produces: `GET /projects/:projectId/report-insights` → `(CompletionDropInsight | ThresholdCrossingInsight)[]`.

- [ ] **Step 1: Export what's needed from `sprint-metrics.ts`**

In `artifacts/api-server/src/routes/sprint-metrics.ts`, change:

```ts
interface SprintMetric {
```
to:
```ts
export interface SprintMetric {
```

and change:

```ts
async function computeSprintMetrics(
```
to:
```ts
export async function computeSprintMetrics(
```

Also widen its route guard — change:

```ts
router.get(
  "/projects/:projectId/sprints/:period",
  requireAuth,
  requireSectionView("sprints"),
```

to:

```ts
router.get(
  "/projects/:projectId/sprints/:period",
  requireAuth,
  requireSectionView("sprints", "report"),
```

- [ ] **Step 2: Export `computePeriodMetrics` from `analytics.ts`**

Change:

```ts
async function computePeriodMetrics(
```
to:
```ts
export async function computePeriodMetrics(
```

- [ ] **Step 3: Add the insights route**

Append to `artifacts/api-server/src/routes/report-insights.ts` (created in Task 1), adding these imports at the top alongside the existing ones:

```ts
import {
  getJiraSprints,
  getSprintIssues,
  getProjectBoardType,
  getResolvedJiraIssuesInRange,
  getEffectiveIssueType,
  resolvePeriodDays,
  type JiraIssue,
} from "../lib/jira";
import { computeSprintMetrics } from "./sprint-metrics";
import { computePeriodMetrics } from "./analytics";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { getEffectiveThresholds } from "../lib/health-thresholds";
import { detectCompletionDrop, detectThresholdCrossing } from "../lib/report-insights";
```

and add the new route below the existing `/sprint-goal` one:

```ts
router.get(
  "/projects/:projectId/report-insights",
  requireAuth,
  requireSectionView("report"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const insights: unknown[] = [];

    // --- Completion drop between the last two closed sprints ---
    const boardType = await getProjectBoardType(projectId);
    if (boardType === "scrum") {
      const sprints = await getJiraSprints(projectId, 50);
      const relevant = [...sprints]
        .filter((s) => s.state === "closed" || s.state === "active")
        .sort((a, b) => {
          const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
          const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
          return aEnd - bEnd;
        })
        .slice(-3);

      if (relevant.length >= 2) {
        const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
        const summaries = await Promise.all(
          relevant.map(async (s) => {
            const issues = await getSprintIssues(s.id);
            const metric = await computeSprintMetrics(s, issues, allowedIssueTypes, sprints);
            return { name: s.name, state: s.state as "closed" | "active", completionRate: metric.completionRate };
          })
        );
        const drop = detectCompletionDrop(summaries);
        if (drop) insights.push(drop);
      }
    }

    // --- Cycle/lead time threshold crossing (current 1m vs previous 1m) ---
    const periodDays = 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);
    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();

    const currentIssues = await getResolvedJiraIssuesInRange(projectId, periodDays, 0, { includeChangelog: true }).catch(
      () => [] as JiraIssue[]
    );
    const prevStart = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const prevIssues = await getResolvedJiraIssuesInRange(projectId, periodDays * 2, periodDays, {
      includeChangelog: true,
    }).catch(() => [] as JiraIssue[]);

    const currentFiltered = currentIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
    const prevFiltered = prevIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));

    if (currentFiltered.length > 0 && prevFiltered.length > 0) {
      const current = await computePeriodMetrics(currentFiltered, startDate);
      const previous = await computePeriodMetrics(prevFiltered, prevStart, startDate);
      const thresholds = await getEffectiveThresholds(projectId);

      const cycleCrossing = detectThresholdCrossing(
        "cycleTime", current.avgCycleTime, previous.avgCycleTime, thresholds["cycleTime"]
      );
      if (cycleCrossing) insights.push(cycleCrossing);

      const leadCrossing = detectThresholdCrossing(
        "leadTime", current.avgLeadTime, previous.avgLeadTime, thresholds["leadTime"]
      );
      if (leadCrossing) insights.push(leadCrossing);
    }

    res.json(insights);
  }
);
```

Note: `resolvePeriodDays` is imported above for parity with other routes but unused directly here since this route fixes the window to 30/30 days (monthly report scope) rather than accepting a `:period` param — remove it from the import list if `tsc`/lint flags it as unused.

- [ ] **Step 4: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors. If `resolvePeriodDays` is flagged unused, remove it from the import (per the note above).

- [ ] **Step 5: Run the full backend test suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: all tests pass (22 previous + 9 new = 31).

- [ ] **Step 6: Verify against real data**

Run: `curl http://localhost/api/projects/10003/report-insights -H "Authorization: Bearer $TOKEN"`
Expected: an array containing a `completionDrop` insight referencing "Tablero Sprint 111" → "Tablero Sprint 112" (matches this session's manual finding of 92.2% → 66.7%).

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/sprint-metrics.ts artifacts/api-server/src/routes/analytics.ts artifacts/api-server/src/routes/report-insights.ts
git commit -m "feat: add /report-insights endpoint computing auto-generated decisions"
```

---

### Task 9: i18n keys

**Files:**
- Modify: `artifacts/dashboard/src/i18n/locales/es.json`
- Modify: `artifacts/dashboard/src/i18n/locales/en.json`

**Interfaces:**
- Produces: all `page.report.*` keys consumed by Task 11's rewritten page.

- [ ] **Step 1: Add the `page.report` block to `es.json`**

Find the `"page"` object in `artifacts/dashboard/src/i18n/locales/es.json` and add a `"report"` key (sibling of `"team"`, `"flow"`, etc.) with this content:

```json
"report": {
  "title": "Informe",
  "subtitle": "Avances, decisiones, bloqueos y próximos pasos del período",
  "reportTitle": "Informe del proyecto",
  "sprintGoal": "Objetivo del sprint",
  "throughput": "Throughput",
  "cycleTime": "Cycle Time",
  "leadTime": "Lead Time",
  "resolved": "Resueltos",
  "healthScore": "Flow Health",
  "qaRejectionRate": "Tasa de Rechazo QA",
  "percentiles": "Percentiles",
  "cfdTitle": "Flujo Acumulado",
  "membersTitle": "Top Contribuidores",
  "memberName": "Miembro",
  "memberResolved": "Resueltos",
  "memberCycle": "Cycle Time",
  "memberPoints": "Story Points",
  "flowTitle": "Tiempo en Estado",
  "flowStatus": "Estado",
  "flowAvgDays": "Prom. Días",
  "flowIssues": "Issues",
  "decisionsTitle": "Decisiones importantes",
  "blockersTitle": "Bloqueos e impedimentos",
  "blockersEmpty": "Sin bloqueos activos en este período",
  "productionTitle": "Próximos pasos a producción",
  "productionNotConfigured": "Configurar en Admin → Releases",
  "productionLinkedIssues": "Issues que implementan este release",
  "sprintsTitle": "Detalle de sprints"
}
```

- [ ] **Step 2: Add the equivalent English block to `en.json`**

```json
"report": {
  "title": "Report",
  "subtitle": "Progress, decisions, blockers and next steps for the period",
  "reportTitle": "Project report",
  "sprintGoal": "Sprint goal",
  "throughput": "Throughput",
  "cycleTime": "Cycle Time",
  "leadTime": "Lead Time",
  "resolved": "Resolved",
  "healthScore": "Flow Health",
  "qaRejectionRate": "QA Rejection Rate",
  "percentiles": "Percentiles",
  "cfdTitle": "Cumulative Flow",
  "membersTitle": "Top Contributors",
  "memberName": "Member",
  "memberResolved": "Resolved",
  "memberCycle": "Cycle Time",
  "memberPoints": "Story Points",
  "flowTitle": "Time in Status",
  "flowStatus": "Status",
  "flowAvgDays": "Avg. Days",
  "flowIssues": "Issues",
  "decisionsTitle": "Key decisions",
  "blockersTitle": "Blockers and impediments",
  "blockersEmpty": "No active blockers this period",
  "productionTitle": "Next steps to production",
  "productionNotConfigured": "Configure in Admin → Releases",
  "productionLinkedIssues": "Issues implementing this release",
  "sprintsTitle": "Sprint breakdown"
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors (JSON isn't typechecked directly, but this confirms nothing else broke).

- [ ] **Step 4: Commit**

```bash
git add artifacts/dashboard/src/i18n/locales/es.json artifacts/dashboard/src/i18n/locales/en.json
git commit -m "feat: add i18n keys for the report tab"
```

---

### Task 10: `useReportData` hook

**Files:**
- Create: `artifacts/dashboard/src/hooks/use-report-data.ts`

**Interfaces:**
- Consumes: `getAuthToken` from `@/lib/auth` (existing).
- Produces: `useReportData(projectId: string | undefined, period: "1m" | "3m")` returning `{ loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate, blockedIssues, sprints, sprintGoal, releaseReadiness, insights }` (consumed by Task 11).

- [ ] **Step 1: Write the hook**

Create `artifacts/dashboard/src/hooks/use-report-data.ts`, adapting the existing `useEffect`/`fetch` pattern already in `project-report.tsx` (kept as manual `fetch` calls, matching how the rest of that page already works — see `CLAUDE.md` note on the app's per-tab fetch pattern) and adding the four new calls:

```ts
import { useState, useEffect } from "react";
import { getAuthToken } from "@/lib/auth";

export interface SprintGoal {
  sprintName: string;
  goal: string;
}

export interface ReleaseEpic {
  issueKey: string;
  summary: string;
  description: string | null;
  status: string;
  statusCategory: string;
  assignee: string | null;
  jiraUpdatedAt: string;
  linkedIssueKeys: string[];
}

export type ReleaseReadiness = { configured: false } | { configured: true; epics: ReleaseEpic[] };

export function useReportData(projectId: string | undefined, period: "1m" | "3m") {
  const [cfdData, setCfdData] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [timeInStatus, setTimeInStatus] = useState<any[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [qaRejectionRate, setQaRejectionRate] = useState<number | null>(null);
  const [blockedIssues, setBlockedIssues] = useState<any[]>([]);
  const [sprints, setSprints] = useState<any[]>([]);
  const [sprintGoal, setSprintGoal] = useState<SprintGoal | null>(null);
  const [releaseReadiness, setReleaseReadiness] = useState<ReleaseReadiness | null>(null);
  const [insights, setInsights] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = getAuthToken();

  useEffect(() => {
    if (!projectId || !token) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers = { Authorization: `Bearer ${token}` };
    const opts = { signal: controller.signal, headers };

    setLoading(true);
    setError(null);

    const jsonOrThrow = (label: string) => (r: Response) => {
      if (!r.ok) throw new Error(`${label} request failed: ${r.status}`);
      return r.json();
    };

    Promise.all([
      fetch(`/api/projects/${projectId}/cfd/${period}`, opts).then(jsonOrThrow("CFD")),
      fetch(`/api/projects/${projectId}/members/${period}`, opts).then(jsonOrThrow("Members")),
      fetch(`/api/projects/${projectId}/analytics/${period}`, opts).then(jsonOrThrow("Analytics")),
      fetch(`/api/projects/${projectId}/health/${period}`, opts).then(jsonOrThrow("Health")),
      fetch(`/api/projects/${projectId}/qa-rejected/${period}`, opts).then(jsonOrThrow("QA rejected")),
      fetch(`/api/projects/${projectId}/sprints/${period}`, opts).then(jsonOrThrow("Sprints")),
      fetch(`/api/projects/${projectId}/sprint-goal`, opts).then(jsonOrThrow("Sprint goal")),
      fetch(`/api/projects/${projectId}/release-readiness`, opts).then(jsonOrThrow("Release readiness")),
      fetch(`/api/projects/${projectId}/report-insights`, opts).then(jsonOrThrow("Report insights")),
    ])
      .then(([cfd, memberRows, analytics, health, qaRejected, sprintData, goal, readiness, insightRows]) => {
        setCfdData(cfd?.dataPoints ?? []);
        setMembers(Array.isArray(memberRows) ? memberRows : []);
        setTimeInStatus(analytics?.timeInStatus ?? []);
        setBlockedIssues((analytics?.blockedIssues ?? []).filter((b: any) => b.isCurrentlyBlocked));
        const flowHealthDimension = health?.dimensions?.find((d: any) => d.name === "Flow Health Score");
        setHealthScore(typeof flowHealthDimension?.value === "number" ? flowHealthDimension.value : null);
        setQaRejectionRate(
          typeof qaRejected?.overallRejectionRate === "number" ? qaRejected.overallRejectionRate : null
        );
        setSprints(sprintData?.sprints ?? []);
        setSprintGoal(goal ?? null);
        setReleaseReadiness(readiness ?? { configured: false });
        setInsights(Array.isArray(insightRows) ? insightRows : []);
      })
      .catch((err) => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, period, token]);

  return {
    loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate,
    blockedIssues, sprints, sprintGoal, releaseReadiness, insights,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/dashboard/src/hooks/use-report-data.ts
git commit -m "feat: add useReportData hook composing report tab data sources"
```

---

### Task 11: Rewrite `project-report.tsx`

**Files:**
- Modify: `artifacts/dashboard/src/pages/project-report.tsx` (full rewrite)

**Interfaces:**
- Consumes: `useReportData` from Task 10.
- Consumes: `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card` (already used by this file).

- [ ] **Step 1: Check the existing `Card` component's variant classes**

Run: `grep -n "critical\|warning\|border-l" artifacts/dashboard/src/pages/project-health.tsx | head -20`

Use whatever severity-border class convention that file already uses (e.g. `border-l-4 border-destructive` or similar Tailwind token) — do not invent new color literals; the whole point of this rewrite is to stop hardcoding `bg-white text-black` and instead use the app's existing theme tokens so the page works in dark mode too.

- [ ] **Step 2: Rewrite the component**

Replace the full contents of `artifacts/dashboard/src/pages/project-report.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectMetrics, getGetProjectMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users } from "lucide-react";
import CfdChart from "@/components/cfd-chart";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";
import { useReportData } from "@/hooks/use-report-data";

type Period = "1m" | "3m";

export default function ProjectReport() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: metrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectMetricsQueryKey(projectId!, period) },
  });

  const {
    loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate,
    blockedIssues, sprints, sprintGoal, releaseReadiness, insights,
  } = useReportData(projectId, period);

  if (loading) return <div>{t("common.loading")}</div>;
  if (!project) return <div>{t("page.team.notFound")}</div>;
  if (error) return <div>{error}</div>;

  const sortedTimeInStatus = [...timeInStatus].sort((a: any, b: any) => b.avgDays - a.avgDays);
  const topMembers = [...(members ?? [])].sort((a: any, b: any) => b.issuesResolved - a.issuesResolved).slice(0, 5);
  const closedSprints = [...sprints].filter((s: any) => s.state === "closed");

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {project.name}
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.report.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.report.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-background border border-border rounded-md p-1">
            {(["1m", "3m"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ProjectTabs projectId={projectId!} active="report" />

      <Card>
        <CardHeader>
          <CardTitle>{project.name} — {t("page.report.reportTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{period.toUpperCase()} · {new Date().toLocaleDateString()}</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.throughput")}</div>
            <div className="text-xl font-bold">{metrics?.throughput?.toFixed(1) ?? "—"} /wk</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.cycleTime")}</div>
            <div className="text-xl font-bold">{metrics?.cycleTime?.toFixed(1) ?? "—"}d</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.leadTime")}</div>
            <div className="text-xl font-bold">{metrics?.leadTime?.toFixed(1) ?? "—"}d</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.resolved")}</div>
            <div className="text-xl font-bold">{metrics?.resolvedCount ?? "—"}</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.healthScore")}</div>
            <div className="text-xl font-bold">{healthScore ?? "—"}{healthScore !== null ? "/100" : ""}</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.qaRejectionRate")}</div>
            <div className="text-xl font-bold">{qaRejectionRate ?? "—"}{qaRejectionRate !== null ? "%" : ""}</div>
          </div>
        </CardContent>
      </Card>

      {sprintGoal && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.sprintGoal")} — {sprintGoal.sprintName}</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-line text-sm">{sprintGoal.goal}</p></CardContent>
        </Card>
      )}

      {insights.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.decisionsTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {insights.map((insight: any, i: number) =>
              insight.type === "completionDrop" ? (
                <p key={i} className="text-sm border-l-2 border-destructive pl-3">
                  {insight.previousSprintName} ({insight.previousCompletionRate.toFixed(1)}%) → {insight.currentSprintName} ({insight.currentCompletionRate.toFixed(1)}%): caída de {insight.dropPoints.toFixed(1)} puntos en finalización.
                </p>
              ) : (
                <p key={i} className="text-sm border-l-2 border-destructive pl-3">
                  {insight.metric === "cycleTime" ? t("page.report.cycleTime") : t("page.report.leadTime")} pasó de {insight.previousValue.toFixed(1)}d a {insight.currentValue.toFixed(1)}d — cruzó a estado crítico.
                </p>
              )
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("page.report.blockersTitle")}</CardTitle></CardHeader>
        <CardContent>
          {blockedIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("page.report.blockersEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {blockedIssues.map((b: any) => (
                <div key={b.issueKey} className="border-l-2 border-destructive pl-3 text-sm">
                  <div className="font-medium">{b.issueKey} — {b.summary}</div>
                  <div className="text-muted-foreground">{b.flagReason ?? ""}</div>
                  <div className="text-xs text-muted-foreground">{b.totalDays?.toFixed(1)}d bloqueado</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {releaseReadiness?.configured && releaseReadiness.epics.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.productionTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {releaseReadiness.epics.map((e) => (
              <div key={e.issueKey} className="border-l-2 border-primary pl-3 text-sm">
                <div className="font-medium">{e.issueKey} — {e.summary}</div>
                <div className="text-xs text-muted-foreground">{e.status}{e.assignee ? ` · ${e.assignee}` : ""}</div>
                {e.linkedIssueKeys.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("page.report.productionLinkedIssues")}: {e.linkedIssueKeys.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {cfdData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.cfdTitle")}</CardTitle></CardHeader>
          <CardContent className="h-[200px]"><CfdChart data={cfdData} /></CardContent>
        </Card>
      )}

      {topMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1"><Users size={14} />{t("page.report.membersTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.report.memberName")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberResolved")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberCycle")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberPoints")}</th>
                </tr>
              </thead>
              <tbody>
                {topMembers.map((m: any) => (
                  <tr key={m.accountId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{m.displayName}</td>
                    <td className="py-1 text-right">{m.issuesResolved}</td>
                    <td className="py-1 text-right">{m.avgCycleTime?.toFixed(1) ?? "—"}d</td>
                    <td className="py-1 text-right">{m.storyPoints ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {closedSprints.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.sprintsTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">Sprint</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">SP</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">%</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">Cycle Time</th>
                </tr>
              </thead>
              <tbody>
                {closedSprints.map((s: any) => (
                  <tr key={s.sprintId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{s.sprintName}</td>
                    <td className="py-1 text-right">{s.completedStoryPoints}/{s.totalStoryPoints}</td>
                    <td className="py-1 text-right">{s.completionRate.toFixed(1)}%</td>
                    <td className="py-1 text-right">{s.avgCycleTimeDays?.toFixed(1) ?? "—"}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {sortedTimeInStatus.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.flowTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.report.flowStatus")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.flowAvgDays")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.flowIssues")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimeInStatus.slice(0, 6).map((entry: any) => (
                  <tr key={entry.status} className="border-b border-border/50">
                    <td className="py-1 font-medium">{entry.status}</td>
                    <td className="py-1 text-right">{entry.avgDays.toFixed(1)}d</td>
                    <td className="py-1 text-right">{entry.issueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 4: Rebuild and verify in the browser**

Run: `docker compose up -d --build`, log in, navigate to `/projects/10003/report` (via the "Más" dropdown → Report, or directly by URL).
Expected: sections render with real Olimpo data — sprint goal ("certificar CxC..."), the completion-drop insight (S111→S112), 3 active blockers, RC-22/RC-21/RC-18 in "Próximos pasos a producción", sprint breakdown table. Toggle the OS/app theme to dark mode and confirm text stays legible (no white-on-white or black-on-black).

- [ ] **Step 5: Commit**

```bash
git add artifacts/dashboard/src/pages/project-report.tsx
git commit -m "feat: rewrite report tab with goal, blockers, insights and production readiness"
```

---

### Task 12: Admin UI for release keywords

**Files:**
- Create: `artifacts/dashboard/src/pages/admin-release-keywords.tsx`
- Modify: `artifacts/dashboard/src/App.tsx` (register the route)
- Modify: `artifacts/dashboard/src/pages/admin.tsx` (add a nav entry)

**Interfaces:**
- Consumes: `getAuthToken` from `@/lib/auth`, `useGetProjects` (or equivalent existing hook — confirm exact name via `grep -n "useGetProjects\|useListProjects" artifacts/dashboard/src/pages/admin.tsx` before writing this task's code) to populate a project picker.

- [ ] **Step 1: Locate the Admin nav pattern**

Run: `grep -n "Health\|NavLink\|nav-item\|href=\"/admin" artifacts/dashboard/src/pages/admin.tsx | head -30`

This reveals the exact existing pattern for Admin sub-sections (e.g. how "Admin → Health" is wired) — use the same structure (same component, same styling classes) for the new "Releases" entry. Do not invent a new nav pattern.

- [ ] **Step 2: Write the admin page**

Create `artifacts/dashboard/src/pages/admin-release-keywords.tsx` following the exact list/detail structure found in Step 1 (project picker on one side, keyword chips with an "add" input and a delete button per chip on the other — same interaction shape as an existing Admin CRUD sub-section such as targets or thresholds). Fetch `GET /api/admin/projects/:projectId/release-keywords`, `POST` to add, `DELETE .../release-keywords/:keywordId` to remove, using the same manual-`fetch`-with-bearer-token pattern as `use-report-data.ts` (Task 10).

Because the exact surrounding Admin page structure can only be confirmed by reading the live file (Step 1), the executing agent must model this file after whatever CRUD sub-section pattern Step 1 turns up rather than inventing one — this is a deliberate "match existing patterns" step per the project's `CLAUDE.md` and the writing-plans skill's "follow existing patterns" rule, not a placeholder.

- [ ] **Step 3: Register the route**

In `artifacts/dashboard/src/App.tsx`, add the import next to the other admin-related imports:

```ts
import AdminReleaseKeywords from "@/pages/admin-release-keywords";
```

and a route next to the existing `/admin` route (using the same `AdminRoute` wrapper already used for `Admin`):

```tsx
<Route path="/admin/release-keywords">
  {() => <AdminRoute component={AdminReleaseKeywords} />}
</Route>
```

- [ ] **Step 4: Add the nav entry**

In `artifacts/dashboard/src/pages/admin.tsx`, add a link to `/admin/release-keywords` labeled "Releases" (Spanish: "Releases" or "Producción" — check the label style of neighboring entries such as "Health" to match capitalization/tone) in the same nav list found in Step 1.

- [ ] **Step 5: Typecheck**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 6: Verify in the browser**

Navigate to `/admin/release-keywords`, select Olimpo (project 10003), confirm the two keywords seeded in Task 6 ("OLP", "Orvix Chile") appear, add and remove a test keyword to confirm the CRUD round-trips.

- [ ] **Step 7: Commit**

```bash
git add artifacts/dashboard/src/pages/admin-release-keywords.tsx artifacts/dashboard/src/App.tsx artifacts/dashboard/src/pages/admin.tsx
git commit -m "feat: add Admin UI for mapping RC release keywords per project"
```

---

### Task 13: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `pnpm run typecheck`
Expected: no errors across the whole workspace.

- [ ] **Step 2: Full backend test suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: all tests pass (31 total per Task 8).

- [ ] **Step 3: Lint**

Run: `pnpm run lint`
Expected: 0 errors (warnings at or below the existing ~114 baseline — do not introduce new `any` beyond what's already used in this plan's code, which mirrors the existing file's own use of `any` for loosely-typed API responses).

- [ ] **Step 4: End-to-end browser walkthrough**

With the stack rebuilt (`docker compose up -d --build`), as `admin`:
1. Navigate to `/projects/10003/report` via the "Más" dropdown.
2. Confirm every section from Task 11's Step 4 checklist still renders correctly.
3. Log in as a `member` user and confirm the report tab is visible (per RBAC, `report` section defaults to viewable) and that `/admin/release-keywords` correctly redirects away (admin-only).

(No commit — final verification.)
