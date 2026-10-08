import { Router, type IRouter, type Response } from "express";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db, sprintCapacityTable, capacityRosterTable, type SprintCapacityRow } from "@workspace/db";
import { UpdateProjectCapacityBody, type CapacityResponse } from "@workspace/api-zod";
import { requireAuth, requireAdmin, requireSectionView, type AuthRequest } from "../middleware/auth";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraSprints,
  getFutureJiraSprints,
  getSprintIssues,
  getStoryPoints,
  isIssueDone,
  wasIssueDoneAt,
  sprintCloseTime,
  getStatusCategoryMap,
  getEffectiveIssueType,
  type JiraIssue,
  type JiraSprint,
} from "../lib/jira";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import {
  HISTORY_SPRINTS,
  NEXT_SPRINT_WORKING_DAYS,
  availabilityPct,
  availableDays,
  buildTeam,
  buildTeamRows,
  commitmentBand,
  expectedByToday,
  paceBand,
  recommend,
  sprintClock,
  sprintSample,
  summarizeAssigned,
  teamRate,
  validateCapacityRows,
  type CapacityIssue,
  type MemberAvailability,
  type RosterEntry,
  type TeamMember,
} from "../lib/capacity";

const router: IRouter = Router();

const NOT_SCRUM = "Capacity is only available for Scrum projects";

function toMember(row: SprintCapacityRow): MemberAvailability {
  return {
    accountId: row.accountId,
    displayName: row.displayName,
    absenceDays: Number(row.absenceDays),
    dedicationPct: row.dedicationPct,
    // Who counts is decided by the project roster, not per sprint.
    counts: true,
    manual: false,
  };
}

/** Sprint issues of THIS project only (a board's filter can pull in another project's issues —
 *  why Orvix Internacional I repeated Olimpo Internacional's July sprints) and of the issue types
 *  allowed in Admin, mapped to what lib/capacity needs. */
async function loadSprintIssues(
  sprint: JiraSprint,
  projectKey: string,
  allowedIssueTypes: string[],
  categoryMap: Map<string, string>
): Promise<CapacityIssue[]> {
  const issues = await getSprintIssues(sprint.id);
  const closeTime = sprintCloseTime(sprint);
  return issues
    .filter((i: JiraIssue) => i.key.startsWith(`${projectKey}-`))
    .filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)))
    .map((i) => ({
      key: i.key,
      accountId: i.fields.assignee?.accountId ?? null,
      displayName: i.fields.assignee?.displayName ?? null,
      storyPoints: getStoryPoints(i),
      done: closeTime ? wasIssueDoneAt(i, closeTime, categoryMap) : isIssueDone(i),
    }));
}

async function ensureScrumProject(projectId: string, res: Response) {
  const project = await getJiraProject(projectId);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if ((await getProjectBoardType(projectId)) !== "scrum") {
    res.status(400).json({ error: NOT_SCRUM });
    return null;
  }
  return project;
}

router.get(
  "/projects/:projectId/capacity",
  requireAuth,
  requireSectionView("capacity"),
  async (req, res): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      // ?sprint=active → the sprint in progress; ?sprint=next → the next future one; absent → the
      // next future sprint, else the active one (the page's first load).
      const view = req.query.sprint;
      if (view !== undefined && view !== "active" && view !== "next") {
        res.status(400).json({ error: "sprint debe ser 'active' o 'next'" });
        return;
      }
      const project = await ensureScrumProject(projectId, res);
      if (!project) return;

      const [sprints, future, allowedIssueTypes, categoryMap] = await Promise.all([
        getJiraSprints(projectId, 50),
        getFutureJiraSprints(projectId),
        getPortfolioAllowedIssueTypes(),
        getStatusCategoryMap(),
      ]);
      // getJiraSprints sorts by end date descending.
      const closed = sprints.filter((s) => s.state === "closed").slice(0, HISTORY_SPRINTS);
      const active = sprints.find((s) => s.state === "active") ?? null;
      // A sprint started (or closed) since getJiraSprints was cached must not still read as "future".
      const knownIds = new Set(sprints.map((s) => s.id));
      const nextFuture = future.find((s) => !knownIds.has(s.id)) ?? null;
      const next = view === "active" ? active : view === "next" ? nextFuture : (nextFuture ?? active);
      const isActive = next !== null && next.id === active?.id;

      const rosterRows = await db.select().from(capacityRosterTable).where(eq(capacityRosterTable.projectId, projectId));
      const roster: RosterEntry[] = rosterRows.map((r) => ({
        accountId: r.accountId,
        displayName: r.displayName,
        counts: r.counts,
        manual: r.manual,
      }));
      const notCounting = new Set(roster.filter((r) => !r.counts).map((r) => r.accountId));

      const sprintIds = [...closed.map((s) => String(s.id)), ...(next ? [String(next.id)] : [])];
      const savedRows = sprintIds.length
        ? await db
            .select()
            .from(sprintCapacityTable)
            .where(and(eq(sprintCapacityTable.projectId, projectId), inArray(sprintCapacityTable.sprintId, sprintIds)))
        : [];
      const savedFor = (sprintId: number) =>
        savedRows.filter((r) => r.sprintId === String(sprintId)).map(toMember);

      const [closedIssues, nextIssues, activeIssues] = await Promise.all([
        Promise.all(closed.map((s) => loadSprintIssues(s, project.key, allowedIssueTypes, categoryMap))),
        next ? loadSprintIssues(next, project.key, allowedIssueTypes, categoryMap) : Promise.resolve([]),
        active && !isActive ? loadSprintIssues(active, project.key, allowedIssueTypes, categoryMap) : Promise.resolve([]),
      ]);

      const samples = closed
        .map((s, idx) =>
          sprintSample({
            startDate: s.startDate,
            endDate: s.completeDate ?? s.endDate,
            issues: closedIssues[idx]!,
            saved: savedFor(s.id),
            notCounting,
          })
        )
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const rate = teamRate(samples);

      const warnings: string[] = [];
      if (!rate) warnings.push("Faltan sprints cerrados para recomendar (mínimo 3 con fechas y personas asignadas).");
      if (!next) {
        warnings.push(
          view === "active"
            ? "No hay sprint activo en Jira."
            : view === "next"
              ? "No hay sprint futuro en Jira."
              : "No hay sprint activo ni futuro en Jira."
        );
      }

      const assigned = summarizeAssigned(nextIssues);
      if (assigned.unestimated > 0) {
        warnings.push(`${assigned.unestimated} issues sin estimar en el ${isActive ? "sprint activo" : "próximo sprint"}.`);
      }
      // A sprint in progress is measured with its real dates; one not started yet with the team's 10 days.
      const clock = isActive ? sprintClock(next!.startDate, next!.endDate, new Date()) : null;
      const sprintDays = clock?.workingDays ?? NEXT_SPRINT_WORKING_DAYS;

      // Default team: the roster plus whoever is new in the last closed, the active and the next
      // sprint — not everyone who passed through the 6-sprint window, which inflated availability
      // against a history that only counts each sprint's own assignees.
      const team = buildTeam({
        roster,
        recentIssues: [...(closedIssues[0] ?? []), ...activeIssues, ...nextIssues],
        historyIssues: closedIssues.flat(),
        saved: next ? savedFor(next.id) : [],
      });
      const counting = team.filter((m) => m.counts && m.recent);
      const availablePersonDays = counting.reduce((sum, m) => sum + availableDays(m, sprintDays), 0);
      const range = rate ? recommend(availablePersonDays, rate) : null;
      const expected = clock && range ? expectedByToday(range, clock.elapsedDays, clock.workingDays) : null;

      const history = closed
        .map((s, idx) => {
          const issues = closedIssues[idx]!;
          const done = issues.filter((i) => i.done);
          const committedSp = issues.reduce((sum, i) => sum + i.storyPoints, 0);
          const completedSp = done.reduce((sum, i) => sum + i.storyPoints, 0);
          return {
            sprintId: String(s.id),
            sprintName: s.name,
            committed: { sp: committedSp, issues: issues.length },
            completed: { sp: completedSp, issues: done.length },
            completionPct:
              committedSp > 0
                ? Math.round((completedSp / committedSp) * 100)
                : issues.length > 0
                  ? Math.round((done.length / issues.length) * 100)
                  : 0,
          };
        })
        .reverse(); // oldest first, for the chart

      const body: CapacityResponse = {
        sprint: next
          ? {
              id: String(next.id),
              name: next.name,
              state: next.state === "active" ? "active" : "future",
              startDate: next.startDate ?? null,
              endDate: next.endDate ?? null,
              workingDays: sprintDays,
            }
          : null,
        recommendation: range
          ? {
              range,
              availabilityPct: availabilityPct(availablePersonDays, counting.length, sprintDays),
              availablePersonDays: Math.round(availablePersonDays * 10) / 10,
              band: {
                sp: commitmentBand(assigned.total.sp, range.sp),
                issues: commitmentBand(assigned.total.issues, range.issues),
              },
            }
          : null,
        committed: { ...assigned.total, unestimated: assigned.unestimated },
        progress: clock
          ? {
              elapsedDays: clock.elapsedDays,
              remainingDays: clock.remainingDays,
              done: assigned.done,
              remaining: { sp: assigned.total.sp - assigned.done.sp, issues: assigned.total.issues - assigned.done.issues },
              expected,
              pace: expected
                ? { sp: paceBand(assigned.done.sp, expected.sp), issues: paceBand(assigned.done.issues, expected.issues) }
                : null,
            }
          : null,
        rate,
        team: buildTeamRows(
          team,
          assigned.byAccount,
          rate,
          clock ? { workingDays: clock.workingDays, remainingDays: clock.remainingDays, done: assigned.doneByAccount } : undefined
        ),
        unassigned: assigned.unassigned,
        history,
        warnings,
      };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

router.put(
  "/projects/:projectId/capacity/:sprintId",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const projectId = String(req.params.projectId);
      const sprintId = String(req.params.sprintId);
      const project = await ensureScrumProject(projectId, res);
      if (!project) return;

      const parsed = UpdateProjectCapacityBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Datos de disponibilidad inválidos" });
        return;
      }
      const rows: TeamMember[] = parsed.data;
      const problem = validateCapacityRows(rows);
      if (problem) {
        res.status(400).json({ error: problem });
        return;
      }

      await db.transaction(async (tx) => {
        await tx
          .delete(sprintCapacityTable)
          .where(and(eq(sprintCapacityTable.projectId, projectId), eq(sprintCapacityTable.sprintId, sprintId)));
        if (rows.length > 0) {
          // Availability is per sprint and only for the next sprint's team; people only seen in older
          // sprints are sent just to record whether they count.
          const sprintRows = rows.filter((r) => r.recent);
          if (sprintRows.length > 0) await tx.insert(sprintCapacityTable).values(
            sprintRows.map((r) => ({
              projectId,
              sprintId,
              accountId: r.accountId,
              displayName: r.displayName,
              absenceDays: String(r.absenceDays),
              dedicationPct: r.dedicationPct,
              updatedBy: authReq.user?.userId ?? null,
            }))
          );
          // Who counts is per project and persists across sprints.
          for (const r of rows) {
            await tx
              .insert(capacityRosterTable)
              .values({
                projectId,
                accountId: r.accountId,
                displayName: r.displayName,
                counts: r.counts,
                manual: r.manual,
                updatedBy: authReq.user?.userId ?? null,
              })
              .onConflictDoUpdate({
                target: [capacityRosterTable.projectId, capacityRosterTable.accountId],
                set: { displayName: r.displayName, counts: r.counts, manual: r.manual, updatedBy: authReq.user?.userId ?? null },
              });
          }
        }
        // A manual person left out of the list was removed by the admin. Jira people never are.
        const keptManual = rows.filter((r) => r.manual).map((r) => r.accountId);
        await tx
          .delete(capacityRosterTable)
          .where(
            and(
              eq(capacityRosterTable.projectId, projectId),
              eq(capacityRosterTable.manual, true),
              ...(keptManual.length > 0 ? [notInArray(capacityRosterTable.accountId, keptManual)] : [])
            )
          );
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

export default router;
