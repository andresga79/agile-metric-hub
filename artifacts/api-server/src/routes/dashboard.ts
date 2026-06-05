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

router.get("/dashboard/summary", requireAuth, async (_req, res): Promise<void> => {
  const projects = await filterVisibleProjects(await listJiraProjects());

  let totalResolved = 0;
  let totalVelocity = 0;
  let scrumProjectCount = 0;
  let totalCycleTime = 0;
  let cycleTimeCount = 0;
  let topProject: string | null = null;
  let topProjectResolved = 0;

  const perProject = await Promise.all(
    projects.map(async (project) => {
      const [issues, boardType] = await Promise.all([
        getJiraIssuesForProject(project.id, 30),
        getProjectBoardType(project.id),
      ]);
      return { project, issues, boardType };
    })
  );

  for (const { project, issues, boardType } of perProject) {
    const resolved = issues.filter((i) => isIssueDone(i));

    totalResolved += resolved.length;

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

  res.json({
    totalProjects: projects.length,
    totalIssuesResolved: totalResolved,
    avgVelocity,
    avgCycleTime,
    activeProjects: projects.length,
    topPerformingProject: topProject,
    usingMockData: !isJiraConfigured(),
  });
});

export default router;
