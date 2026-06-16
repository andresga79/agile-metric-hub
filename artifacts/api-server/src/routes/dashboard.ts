import { Router, type IRouter } from "express";
import { db, portfolioCacheTable, userProjectSettingsTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";

const router: IRouter = Router();
const DASHBOARD_OVERVIEW_PERIOD_DAYS = 30;

function formatDurationDays(value: number): string {
  const totalMinutes = Math.round(value * 24 * 60);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`;
  if (totalMinutes < 24 * 60) return `${Math.round(totalMinutes / 60)}h`;
  return `${Math.round((totalMinutes / (24 * 60)) * 10) / 10}d`;
}

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;

  const userSettings = await db
    .select({ projectId: userProjectSettingsTable.projectId })
    .from(userProjectSettingsTable)
    .where(
      sql`${userProjectSettingsTable.userId} = ${userId} AND ${userProjectSettingsTable.visible} = false`
    );
  const hiddenIds = new Set(userSettings.map((s) => s.projectId));

  const cached = await db
    .select()
    .from(portfolioCacheTable)
    .orderBy(desc(portfolioCacheTable.throughput));

  const visible = hiddenIds.size > 0
    ? cached.filter((p) => !hiddenIds.has(p.projectId))
    : cached;

  const totalResolved = visible.reduce((sum, p) => sum + (p.doneCount ?? 0), 0);
  const cycleValues = visible
    .map((p) => (p.cycleTimeP50 ? Number(p.cycleTimeP50) : null))
    .filter((v): v is number => v !== null);
  const avgCycleTime =
    cycleValues.length > 0
      ? Math.round(
          (cycleValues.reduce((a, b) => a + b, 0) / cycleValues.length) * 10
        ) / 10
      : 0;

  const topProject = visible.reduce<string | null>(
    (best, p) =>
      (p.doneCount ?? 0) > (visible.find((x) => x.projectName === best)?.doneCount ?? 0)
        ? p.projectName
        : best,
    null
  );
  res.json({
    totalProjects: visible.length,
    totalIssuesResolved: totalResolved,
    avgVelocity: 0,
    avgCycleTime,
    activeProjects: visible.length,
    topPerformingProject: topProject,
    usingMockData: false,
  });
});

export default router;
