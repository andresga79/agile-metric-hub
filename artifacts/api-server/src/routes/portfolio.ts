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

  async function processProject(p: { id: string; key: string; name: string }) {
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
  }

  const portfolio: Array<Record<string, unknown>> = [];
  const batchSize = 5;
  for (let i = 0; i < jiraProjects.length; i += batchSize) {
    const batch = jiraProjects.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((p, idx) =>
        Promise.race<Record<string, unknown> | null>([
          processProject(p),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 30000)
          ).then(() => {
            return { id: p.id, key: p.key, name: p.name, issueCount: 0, doneCount: 0, inProgressCount: 0, throughput: 0, cycleTimeP50: null, leadTimeAvg: null, error: "timeout" } as Record<string, unknown>;
          }),
        ])
      )
    );
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx]!;
      if (r.status === "fulfilled" && r.value !== null) {
        portfolio.push(r.value);
      }
    }
  }

  portfolio.sort((a, b) => (b.throughput as number) - (a.throughput as number));

  res.json(portfolio);
});

export default router;
