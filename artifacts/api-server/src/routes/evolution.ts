import { Router, type IRouter } from "express";
import { db, metricTargetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getJiraProject } from "../lib/jira";
import { getProjectSnapshots } from "../lib/metric-snapshots";
import { getEffectiveThresholds, type EffectiveThreshold } from "../lib/health-thresholds";

const router: IRouter = Router();

function pickTarget(
  targets: { metric: string; period: string; targetValue: string }[],
  thresholds: Record<string, EffectiveThreshold>,
  metric: string
): number | null {
  const preferred = targets.find((t) => t.metric === metric && t.period === "3m");
  const fallback = targets.find((t) => t.metric === metric);
  const match = preferred ?? fallback;
  if (match) return Number(match.targetValue);

  // No project-specific target configured - fall back to the same admin-configured "good" value
  // (global default, or this project's override if one exists) the project detail page labels "Meta".
  return thresholds[metric]?.goodValue ?? null;
}

router.get(
  "/projects/:projectId/evolution",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : (req.params.projectId ?? "");

    const project = await getJiraProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [snapshots, targets, thresholds] = await Promise.all([
      getProjectSnapshots(projectId),
      db.select().from(metricTargetsTable).where(eq(metricTargetsTable.projectId, projectId)),
      getEffectiveThresholds(projectId),
    ]);

    res.json({
      projectId,
      weeks: snapshots.map((s) => ({
        weekStart: s.weekStart,
        leadTimeAvg: s.leadTimeAvg !== null ? Number(s.leadTimeAvg) : null,
        cycleTimeAvg: s.cycleTimeAvg !== null ? Number(s.cycleTimeAvg) : null,
        throughput: s.throughput,
        qaRejectionRate: s.qaRejectionRate !== null ? Number(s.qaRejectionRate) : null,
      })),
      targets: {
        leadTime: pickTarget(targets, thresholds, "leadTime"),
        cycleTime: pickTarget(targets, thresholds, "cycleTime"),
        throughput: pickTarget(targets, thresholds, "throughput"),
      },
    });
  }
);

export default router;
