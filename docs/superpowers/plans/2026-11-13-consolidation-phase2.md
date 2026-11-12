# Consolidation Phase 2 (merge views) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge screens into "Entrega y Planning" and "Calidad", move Analytics' useful parts into Métricas, and reduce Equipo/Report per-person data to actionable signals.

**Architecture:** Express API + React dashboard (pnpm monorepo), API contract in `lib/api-spec/openapi.yaml` + orval codegen. Pure logic in `api-server/src/lib` (vitest). Dashboard has no test runner: UI tasks are verified by typecheck + lint + browser. Sub-views are existing pages wrapped by a shared sub-navigation; their URLs stay.

**Tech Stack:** TypeScript 5.9, Express 5, React + TanStack Query + Recharts, vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-13-consolidation-phase2-design.md`

## Global Constraints

- Branch `consolidation-phase2`; push only when the user asks.
- Reuse metric rules as they are: P50 headline, P85 for "atrasados", "% real cerrado" base stays SP, issues first in display.
- API: add fields, don't remove old ones in the same deploy — except fields of the page being deleted (Analytics-only fields).
- Day buckets: exactly `0-1d, 1-3d, 3-7d, 7-14d, 14-30d, 30d+` (half-open `[min,max)`).
- QA weekly rate uses distinct issues: `rejected distinct keys ÷ entered-QA distinct keys` per ISO week, rounded to 0.1 %.
- Every task ends: `pnpm run typecheck`, `pnpm --filter @workspace/api-server test`, `pnpm run lint` (0 errors, warnings ≤ 125).
- Copy in es + en.

## Review Focus

- Kanban project on Rechazos QA: weekly series shows real weeks (no single "Unknown" bucket) — test in Task 4.
- A week with QA entries but no rejections: rate 0, not NaN; a week with rejections whose QA entry fell before the window: counted with its own entries only, rate ≤ 100 — test in Task 4.
- Role with Equipo but without Flujo: Equipo still loads (no 403 from `/wip`) — check in Task 7.
- Old bookmark `/projects/:id/analytics`: lands on Métricas, not a blank page — check in Task 3.
- Métricas with zero delivered issues in the period: bucket charts show zeros / empty state, weekly chart empty, no crash — test in Task 1 (`bucketDays([])`).

---

### Task 0: Branch
- [ ] `git switch -c consolidation-phase2` → `Switched to a new branch`.

---

### Task 1: `/metrics` gains 6-bucket distributions and delivered-per-week

**Files:**
- Create: `artifacts/api-server/src/lib/time-buckets.ts`; Test: `artifacts/api-server/src/lib/__tests__/time-buckets.test.ts`
- Modify: `artifacts/api-server/src/routes/metrics.ts` (`computeMetrics` return), `lib/api-spec/openapi.yaml` (`ProjectMetrics`), regenerate

**Interfaces:**
- Produces:
  - `DAY_BUCKETS: { range: string; min: number; max: number }[]` (the 6 above).
  - `bucketDays(days: number[]): { range: string; count: number }[]` — always 6 entries in order.
  - `deliveredByWeek(dates: Date[]): { week: string; count: number }[]` — key = `isoWeekLabel(date)` (from `lib/iso-week.ts`, the label `issues-by-week` and the drill-down modal already use), sorted ascending.
  - `/metrics/:period` new fields: `leadTimeBuckets`, `cycleTimeBuckets` (`{range,count}[]`), `deliveredByWeek` (`{week,count}[]`), computed over the same `resolved` issues / `resolvedMap` dates as the rest of Métricas.

- [ ] **Step 1: Failing tests** in `time-buckets.test.ts`:
  - `"bucketDays([]) gives the 6 buckets with zero"` → ranges `["0-1d","1-3d","3-7d","7-14d","14-30d","30d+"]`, all counts 0.
  - `"bucket edges are half-open"`: `bucketDays([0, 1, 2.9, 3, 14, 29.9, 30, 427])` → counts `[1, 2, 1, 0, 2, 2]`.
  - `"deliveredByWeek groups by ISO week label, ascending"`: dates `2026-11-02T10Z, 2026-11-04T10Z, 2026-10-28T10Z` → `[{week: isoWeekLabel(2026-10-28), count:1}, {week: isoWeekLabel(2026-11-02), count:2}]`.
- [ ] **Step 2:** `pnpm --filter @workspace/api-server test time-buckets` → FAIL (module missing).
- [ ] **Step 3:** Implement; add the three fields in `computeMetrics`; spec + codegen.
- [ ] **Step 4:** Tests PASS; full suite green.
- [ ] **Step 5:** Commit `feat(metrics): 6-bucket lead/cycle distributions and delivered-per-week in /metrics`.

---

### Task 2: Métricas shows them

**Files:** Modify `artifacts/dashboard/src/pages/project-metrics.tsx`, i18n.

**Interfaces:** Consumes Task 1 fields; reuses `DrillDownModal` (`components/drill-down-modal.tsx`, props `{ open, onClose, projectId, week, period }`).

- [ ] **Step 1:** Below the per-sprint charts add: (a) "Entregados por semana" line chart of `deliveredByWeek`; clicking a point opens `DrillDownModal` for that `week` (same behaviour Analytics had); (b) two bar charts "Distribución de lead time" / "… de cycle time" from `leadTimeBuckets` / `cycleTimeBuckets`. Empty arrays → existing "no data" text, no chart.
- [ ] **Step 2:** typecheck, lint; rebuild; browser on Tablero: the drill-down list length equals the week's point value for 2–3 weeks (if the `issues-by-week` population differs, ledger it as a ruling and note the gap — do not change `issues-by-week` here).
- [ ] **Step 3:** Commit `feat(metrics): weekly delivered (with drill-down) and day-bucket distributions`.

---

### Task 3: Calidad tab (Rechazos QA · Trabajo QA · SLA)

**Files:**
- Create: `artifacts/dashboard/src/components/sub-nav.tsx` (shared), `artifacts/dashboard/src/components/sla-section.tsx` (SLA card extracted from `project-analytics.tsx`), `artifacts/dashboard/src/pages/project-sla.tsx`
- Modify: `project-qa-rejected.tsx`, `project-qa-work.tsx` (render `SubNav` under the tabs), `App.tsx` (route `/projects/:projectId/sla` with `SectionRoute section="qa-rejected"`), `components/project-tabs.tsx`, `lib/project-section-permissions.ts`, `api-server/src/routes/sla.ts` (`requireSectionView("qa-rejected", "analytics")`), i18n

**Interfaces:**
- Produces: `SubNav({ items }: { items: { href: string; label: string; active: boolean }[] })` — horizontal pill links; used again in Task 5.
- Produces: `SlaSection({ projectId, period }: { projectId: string; period: TimeWindow })`.
- Tabs model (also used in Task 5): a primary tab can own several sections; `project-tabs.tsx` gets a `GROUPED_TABS` entry `{ key: "quality", label: "Calidad", sections: ["qa-rejected","qa-work"] , href: first permitted sub-view }`; `active` matches when the page's section is in `sections`.

- [ ] **Step 1:** Implement `SubNav`, `SlaSection`, `project-sla.tsx` (header + period filter + tabs + SubNav + SlaSection); add SubNav (Rechazos QA · Trabajo QA · SLA, filtered by permission) to the two QA pages; tabs: Calidad replaces the two QA entries in "Más".
- [ ] **Step 2:** typecheck, lint; rebuild; as admin and as member: Calidad tab opens Rechazos QA; the 3 sub-views switch; `/projects/10003/sla` loads; API `/sla/1m` with a member token → 200.
- [ ] **Step 3:** Commit `feat(quality): Calidad tab groups QA rejections, QA work and SLA`.

---

### Task 4: Weekly QA rejection rate (Kanban coverage)

**Files:**
- Create: `artifacts/api-server/src/lib/qa-rate.ts`; Test: `artifacts/api-server/src/lib/__tests__/qa-rate.test.ts`
- Modify: `artifacts/api-server/src/routes/qa-rejected.ts` (return `byWeek`), openapi (`QaRejectedResponse.byWeek`), regenerate; `project-qa-rejected.tsx` (show the weekly series; for Kanban it replaces the per-sprint table, for Scrum it is shown below it)

**Interfaces:**
- Produces: `qaRateByWeek(entered: { key: string; at: Date }[], rejected: { key: string; at: Date }[]): { weekStart: string; totalEnteredQa: number; rejectedCount: number; rate: number }[]` — week = `isoWeekStart(at)`, distinct keys per week, `rate = round(rejected/entered × 1000)/10`, `0` when entered is 0, ascending by week. Route feeds it the same QA-entry events (`since`-filtered) and `allRejections` (`r.issueKey`, rejection date) the per-sprint table uses.

- [ ] **Step 1: Failing tests:**
  - `"distinct issues per ISO week"`: entries A,A,B in week 1, rejections A,A in week 1 → `{ totalEnteredQa: 2, rejectedCount: 1, rate: 50 }`.
  - `"a week with entries and no rejections is 0, not NaN"`.
  - `"no data gives []"`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + wire route + spec + UI. **Step 4:** PASS, suite green.
- [ ] **Step 5:** Browser: a Kanban project's Rechazos QA shows weekly rows (no single "Unknown"); Tablero shows the sprint table plus the weekly series.
- [ ] **Step 6:** Commit `feat(quality): weekly QA rejection rate (covers Kanban)`.

---

### Task 5: Entrega y Planning tab (Entrega · Capacidad · Pronóstico)

**Files:** Modify `project-sprints.tsx`, `project-kanban.tsx`, `project-capacity.tsx`, `project-forecast.tsx` (add `SubNav`), `components/project-tabs.tsx` (`GROUPED_TABS` entry `{ key: "delivery", label: "Entrega y Planning", sections: ["sprints","kanban","capacity","forecast"] }`), `lib/project-section-permissions.ts`, i18n.

**Interfaces:** Consumes `SubNav` and the grouped-tab model from Task 3.

- [ ] **Step 1:** SubNav items: Entrega (`/sprints` for Scrum, `/kanban` for Kanban), Capacidad (Scrum only), Pronóstico — each only if its section is permitted. Primary tabs become: Resumen, Métricas, Flujo, Equipo, Entrega y Planning, Calidad; "Más" = Reporte.
- [ ] **Step 2:** typecheck, lint; rebuild; Scrum and Kanban project: tab opens Entrega; old URLs `/sprints`, `/kanban`, `/capacity`, `/forecast` load and highlight "Entrega y Planning".
- [ ] **Step 3:** Commit `feat(nav): Entrega y Planning tab groups delivery, capacity and forecast`.

---

### Task 6: Remove the Analytics page

**Files:** Delete `artifacts/dashboard/src/pages/project-analytics.tsx`; Modify `App.tsx` (route → redirect `/projects/:projectId/analytics` to `/projects/:projectId/metrics` keeping `?period`), `project-tabs.tsx`, `project-section-permissions.ts` (drop the Analytics link; keep `"analytics"` in `SECTION_NAMES`), `api-server/src/routes/analytics.ts` (drop `issueTypeDistribution`, `throughputByPriority`, `throughputOverTime`, `leadTimeDistribution`, `flowEfficiency`, `previousPeriod` and their computation), i18n `page.analytics.*` keys unused after the deletion.

**Interfaces:** `/analytics/:period` keeps every field Flujo, Resumen, Report and member report read (`timeInStatus`, `blockedIssues`, `fetchedAt`, …).

- [ ] **Step 1:** `grep -rn "issueTypeDistribution\|throughputByPriority\|throughputOverTime\|leadTimeDistribution\|flowEfficiency\|previousPeriod\|compareTo" artifacts/dashboard/src` → only `project-analytics.tsx` (and the /metrics `previousPeriod`, which is a different endpoint — leave it). Otherwise stop and ledger.
- [ ] **Step 2:** Delete/edit; typecheck, tests, lint.
- [ ] **Step 3:** Rebuild; `/projects/10003/analytics?period=6s` lands on Métricas with `6s`; Flujo, Resumen and Reporte still load.
- [ ] **Step 4:** Commit `chore: drop the Analytics page; its useful charts live in Métricas and Calidad`.

---

### Task 7: Sprints table (§3.4)

**Files:** Modify `artifacts/dashboard/src/pages/project-sprints.tsx`, i18n.

- [ ] **Step 1:** Column order: Sprint · Comprometido (issues · SP) · **Real cerrado** (issues cerrados al cierre · % sobre SP, with its existing color) · **Rovo (Done hoy)** (% acumulado, secondary style) · Entró después (issues · % SP, neutral text) · Arrastrado (issues · SP, neutral text) · Cycle time P50. Cards: issues first, SP as secondary line. No red/orange/sky color on "entró después" or "arrastrado".
- [ ] **Step 2:** typecheck, lint; rebuild; Tablero Sprint 117 row shows real cerrado 53,5 % with its issue count first, Rovo % beside it, and no colored "entró después/arrastrado" cells.
- [ ] **Step 3:** Commit `feat(sprints): real-closed first, Rovo as reference, unplanned work as neutral context`.

---

### Task 8: Equipo and the Report: actionable per person only

**Files:**
- Create: `artifacts/dashboard/src/hooks/use-team-attention.ts`
- Modify: `artifacts/api-server/src/routes/wip.ts` (`requireSectionView("flow", "team", "report")`), `artifacts/dashboard/src/pages/project-team.tsx`, `artifacts/dashboard/src/pages/project-report.tsx` (top-5 table, ~lines 360–375; `topMembers` in its data hook), i18n

**Interfaces:**
- Produces: `useTeamAttention(projectId: string, period: TimeWindow): { rows: { assignee: string; inProgress: number; blocked: number; overdue: number; workingOn: { key: string; summary: string; ageDays: number; blocked: boolean }[] }[]; p85: number | null; loading: boolean }` — from `GET /wip` items grouped by `assignee` (null → "Sin asignar" last) and `cycleTimePercentiles.p85` of `/metrics/:period`; `overdue = items with ageDays > p85` (0 when p85 is null); sorted by blocked desc, overdue desc, inProgress desc.

- [ ] **Step 1:** Implement the hook; Equipo table = Persona · En curso · Bloqueados · Atrasados (> P85) · Trabajando en; remove resolved/SP/cycle/lead columns and the member-report link. Report: replace the top-5 table with the same rows (top 5 by the same order), title "Atención por persona".
- [ ] **Step 2:** typecheck, lint; tests (wip route guard change); rebuild. Tablero: a person's "Atrasados" equals the number of red items of that person in Flujo → WIP; total "En curso" across rows equals `/wip` total. Role check: with a member account Equipo loads (no 403).
- [ ] **Step 3:** Commit `feat(team): per-person view shows only in progress, blocked and overdue`.

---

### Task 9: Docs, verification, review

- [ ] **Step 1:** `METRICS.md`: Analytics section → removed (where each chart went); Calidad (weekly QA rate formula), Equipo/Report per-person rule, 6 buckets, Sprints display. `CLAUDE.md`: lint baseline 125 (header and Run & Operate).
- [ ] **Step 2:** Spec §5 acceptance list with evidence (browser on Tablero 10003 and one Kanban project; curl with a user-provided token).
- [ ] **Step 3:** Whole-branch review (fresh reviewer, most capable model), fix Critical/Important, then finishing-a-development-branch; push only on request.
