import { Router, type IRouter, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, sprintCapacityTable, type SprintCapacityRow } from "@workspace/db";
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
  recommend,
  sprintSample,
  summarizeAssigned,
  teamRate,
  validateCapacityRows,
  type CapacityIssue,
  type MemberAvailability,
} from "../lib/capacity";

const router: IRouter = Router();

const NOT_SCRUM = "Capacity is only available for Scrum projects";

function toMember(row: SprintCapacityRow): MemberAvailability {
  return {
    accountId: row.accountId,
    displayName: row.displayName,
    absenceDays: Number(row.absenceDays),
    dedicationPct: row.dedicationPct,
    included: row.included,
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
      const next = future[0] ?? sprints.find((s) => s.state === "active") ?? null;

      const sprintIds = [...closed.map((s) => String(s.id)), ...(next ? [String(next.id)] : [])];
      const savedRows = sprintIds.length
        ? await db
            .select()
            .from(sprintCapacityTable)
            .where(and(eq(sprintCapacityTable.projectId, projectId), inArray(sprintCapacityTable.sprintId, sprintIds)))
        : [];
      const savedFor = (sprintId: number) =>
        savedRows.filter((r) => r.sprintId === String(sprintId)).map(toMember);

      const [closedIssues, nextIssues] = await Promise.all([
        Promise.all(closed.map((s) => loadSprintIssues(s, project.key, allowedIssueTypes, categoryMap))),
        next ? loadSprintIssues(next, project.key, allowedIssueTypes, categoryMap) : Promise.resolve([]),
      ]);

      const samples = closed
        .map((s, idx) =>
          sprintSample({ startDate: s.startDate, endDate: s.completeDate ?? s.endDate, issues: closedIssues[idx]!, saved: savedFor(s.id) })
        )
        .filter((s): s is NonNullable<typeof s> => s !== null);
      const rate = teamRate(samples);

      const warnings: string[] = [];
      if (!rate) warnings.push("Faltan sprints cerrados para recomendar (mínimo 3 con fechas y personas asignadas).");
      if (!next) warnings.push("No hay sprint activo ni futuro en Jira.");

      const assigned = summarizeAssigned(nextIssues);
      if (assigned.unestimated > 0) warnings.push(`${assigned.unestimated} issues sin estimar en el próximo sprint.`);

      const team = buildTeam({ recentIssues: closedIssues.flat(), nextIssues, saved: next ? savedFor(next.id) : [] });
      const included = team.filter((m) => m.included);
      const availablePersonDays = included.reduce((sum, m) => sum + availableDays(m, NEXT_SPRINT_WORKING_DAYS), 0);
      const range = rate ? recommend(availablePersonDays, rate) : null;

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
              workingDays: NEXT_SPRINT_WORKING_DAYS,
            }
          : null,
        recommendation: range
          ? {
              range,
              availabilityPct: availabilityPct(availablePersonDays, included.length),
              availablePersonDays: Math.round(availablePersonDays * 10) / 10,
              band: {
                sp: commitmentBand(assigned.total.sp, range.sp),
                issues: commitmentBand(assigned.total.issues, range.issues),
              },
            }
          : null,
        committed: { ...assigned.total, unestimated: assigned.unestimated },
        rate,
        team: buildTeamRows(team, assigned.byAccount, rate),
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
      const rows: MemberAvailability[] = parsed.data;
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
          await tx.insert(sprintCapacityTable).values(
            rows.map((r) => ({
              projectId,
              sprintId,
              accountId: r.accountId,
              displayName: r.displayName,
              absenceDays: String(r.absenceDays),
              dedicationPct: r.dedicationPct,
              included: r.included,
              updatedBy: authReq.user?.userId ?? null,
            }))
          );
        }
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

export default router;
