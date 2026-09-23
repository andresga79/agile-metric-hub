import { Router, type IRouter } from "express";
import { listJiraProjects } from "../../lib/jira";
import { filterVisibleProjects } from "../../lib/project-visibility";
import { backfillWeeklySnapshots } from "../../lib/metric-snapshots";

const router: IRouter = Router();

// POST /api/admin/snapshots/backfill?days=180[&projectId=10003]
// Repairs weekly Evolution snapshots older than the live 90-day window (see
// backfillWeeklySnapshots). One project at a time, same as the sync, to stay within memory.
router.post("/snapshots/backfill", async (req, res): Promise<void> => {
  const days = Number(req.query.days ?? 180);
  if (!Number.isInteger(days) || days < 91 || days > 365) {
    res.status(400).json({ error: "days must be an integer between 91 and 365" });
    return;
  }
  const onlyProject = typeof req.query.projectId === "string" ? req.query.projectId : null;

  const projects = onlyProject
    ? [{ id: onlyProject }]
    : await filterVisibleProjects(await listJiraProjects());

  const results: { projectId: string; weeksUpdated?: string[]; error?: string }[] = [];
  for (const project of projects) {
    try {
      const { weeksUpdated } = await backfillWeeklySnapshots(project.id, days);
      results.push({ projectId: project.id, weeksUpdated });
    } catch (err) {
      results.push({ projectId: project.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  res.json({ days, results });
});

export default router;
