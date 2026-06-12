import { Router, type IRouter } from "express";
import {
  listJiraProjects,
  getRecentlyResolvedIssues,
  getIssuesStatusCounts,
  isIssueDone,
  getLeadTimeDays,
  getCycleTimeDays,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";

const router: IRouter = Router();

router.get("/portfolio", requireAuth, async (_req, res): Promise<void> => {
  const jiraProjects = await listJiraProjects();

  const portfolio = [];
  for (const p of jiraProjects) {
    const result = await Promise.race([
      (async () => {
        try {
          const [counts, resolved] = await Promise.all([
            getIssuesStatusCounts(p.id, 30),
            getRecentlyResolvedIssues(p.id, 30),
          ]);

          const leadTimes = (await Promise.all(resolved.map((i) => getLeadTimeDays(i)))).filter((v): v is number => v !== null);
          const cycleTimes = (await Promise.all(resolved.map((i) => getCycleTimeDays(i)))).filter((v): v is number => v !== null);

          const sortedLead = [...leadTimes].sort((a, b) => a - b);
          const sortedCycle = [...cycleTimes].sort((a, b) => a - b);
          const p50 = sortedLead.length > 0 ? sortedLead[Math.floor(sortedLead.length * 0.5)] : null;
          const cycleP50 = sortedCycle.length > 0 ? sortedCycle[Math.floor(sortedCycle.length * 0.5)] : null;

          return {
            id: p.id,
            key: p.key,
            name: p.name,
            issueCount: counts.total,
            doneCount: counts.done,
            inProgressCount: counts.inProgress,
            throughput: resolved.length,
            cycleTimeP50: cycleP50,
            leadTimeAvg: leadTimes.length > 0 ? Math.round((leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length) * 10) / 10 : null,
          };
        } catch (err) {
          return {
            id: p.id,
            key: p.key,
            name: p.name,
            issueCount: 0,
            doneCount: 0,
            inProgressCount: 0,
            throughput: 0,
            cycleTimeP50: null,
            leadTimeAvg: null,
            error: String(err),
          };
        }
      })(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          resolve(null);
        }, 60000)
      ),
    ]);

    if (result !== null) {
      portfolio.push(result);
    } else {
      portfolio.push({
        id: p.id,
        key: p.key,
        name: p.name,
        issueCount: 0,
        doneCount: 0,
        inProgressCount: 0,
        throughput: 0,
        cycleTimeP50: null,
        leadTimeAvg: null,
        error: "timeout",
      });
    }
  }

  portfolio.sort((a, b) => b.throughput - a.throughput);

  res.json(portfolio);
});

export default router;
