import { Router, type IRouter } from "express";
import {
  listJiraProjects,
  getJiraIssuesForProject,
  isIssueDone,
  isIssueInProgress,
  getLeadTimeDays,
  getCycleTimeDays,
  getResolutionDate,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

router.get("/portfolio", requireAuth, async (_req, res): Promise<void> => {
  const jiraProjects = await listJiraProjects();

  const portfolio = await Promise.all(
    jiraProjects.map(async (p) => {
      const issues = await getJiraIssuesForProject(p.id, 30);
      const done = issues.filter((i) => isIssueDone(i));
      const inProgress = issues.filter((i) => isIssueInProgress(i));

      const resolvedWithDates = await Promise.all(
        done.map(async (i) => ({
          issue: i,
          resolvedAt: await getResolutionDate(i),
        }))
      );
      const recentResolved = resolvedWithDates.filter((r) => {
        if (!r.resolvedAt) return false;
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return r.resolvedAt >= d;
      }).map((r) => r.issue);

      const leadTimes = (await Promise.all(recentResolved.map((i) => getLeadTimeDays(i)))).filter((v): v is number => v !== null);
      const cycleTimes = (await Promise.all(recentResolved.map((i) => getCycleTimeDays(i)))).filter((v): v is number => v !== null);

      const sortedLead = [...leadTimes].sort((a, b) => a - b);
      const p50 = sortedLead.length > 0 ? sortedLead[Math.floor(sortedLead.length * 0.5)] : null;

      return {
        id: p.id,
        key: p.key,
        name: p.name,
        issueCount: issues.length,
        doneCount: done.length,
        inProgressCount: inProgress.length,
        throughput: recentResolved.length,
        cycleTimeP50: p50,
        leadTimeAvg: leadTimes.length > 0 ? Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) * 10) / 10 : null,
      };
    })
  );

  portfolio.sort((a, b) => b.throughput - a.throughput);

  res.json(portfolio);
});

export default router;
