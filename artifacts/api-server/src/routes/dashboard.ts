import { Router, type IRouter } from "express";
import {
  listJiraProjects,
  getJiraIssuesForProject,
  getProjectBoardType,
  isIssueDone,
  getStoryPoints,
  isJiraConfigured,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";
import { filterVisibleProjects } from "../lib/project-visibility";

const router: IRouter = Router();
const DASHBOARD_OVERVIEW_PERIOD_DAYS = 30;

function formatDurationDays(value: number): string {
  const totalMinutes = Math.round(value * 24 * 60);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`;
  if (totalMinutes < 24 * 60) return `${Math.round(totalMinutes / 60)}h`;
  return `${Math.round((totalMinutes / (24 * 60)) * 10) / 10}d`;
}

router.get("/dashboard/summary", requireAuth, async (_req, res): Promise<void> => {
  const projects = await filterVisibleProjects(await listJiraProjects());

  let totalResolved = 0;
  let totalVelocity = 0;
  let scrumProjectCount = 0;
  let totalCycleTime = 0;
  let totalLeadTime = 0;
  let cycleTimeCount = 0;
  let leadTimeCount = 0;
  let totalWip = 0;
  let topProject: string | null = null;
  let topProjectResolved = 0;

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const [issues, boardType] = await Promise.all([
        getJiraIssuesForProject(project.id, DASHBOARD_OVERVIEW_PERIOD_DAYS),
        getProjectBoardType(project.id),
      ]);
      return { project, issues, boardType };
    })
  );

  for (const { project, issues, boardType } of perProject) {
    const resolved = issues.filter((i) => isIssueDone(i));
    const wip = issues.filter((i) => i.fields.status.statusCategory?.key === "indeterminate");

    totalResolved += resolved.length;
    totalWip += wip.length;

    if (boardType === "scrum") {
      const sp = resolved.reduce((sum, i) => sum + getStoryPoints(i), 0);
      totalVelocity += sp / 2;
      scrumProjectCount++;
    }

    const withCycle = resolved.filter((i) => i.fields.resolutiondate);
    if (withCycle.length > 0) {
      const avgCycle =
        withCycle.reduce((sum, i) => {
          return (
            sum +
            (new Date(i.fields.resolutiondate!).getTime() -
              new Date(i.fields.created).getTime()) /
              (1000 * 60 * 60 * 24)
          );
        }, 0) / withCycle.length;
      totalCycleTime += avgCycle;
      cycleTimeCount++;
    }

    const withLead = resolved.filter((i) => i.fields.resolutiondate);
    if (withLead.length > 0) {
      const avgLead =
        withLead.reduce((sum, i) => {
          return (
            sum +
            (new Date(i.fields.resolutiondate!).getTime() -
              new Date(i.fields.created).getTime()) /
              (1000 * 60 * 60 * 24)
          );
        }, 0) / withLead.length;
      totalLeadTime += avgLead;
      leadTimeCount++;
    }

    if (resolved.length > topProjectResolved) {
      topProjectResolved = resolved.length;
      topProject = project.name;
    }
  }

  const avgVelocity =
    scrumProjectCount > 0
      ? Math.round((totalVelocity / scrumProjectCount) * 10) / 10
      : 0;

  const avgCycleTime =
    cycleTimeCount > 0
      ? Math.round((totalCycleTime / cycleTimeCount) * 10) / 10
      : 0;

  const avgLeadTime =
    leadTimeCount > 0
      ? Math.round((totalLeadTime / leadTimeCount) * 10) / 10
      : 0;

  res.json({
    totalProjects: projects.length,
    totalIssuesResolved: totalResolved,
    avgVelocity,
    avgCycleTime,
    avgLeadTime,
    totalWip,
    avgCycleTimeDisplay: formatDurationDays(avgCycleTime),
    avgLeadTimeDisplay: formatDurationDays(avgLeadTime),
    activeProjects: projects.length,
    topPerformingProject: topProject,
    usingMockData: !isJiraConfigured(),
  });
});

export default router;
