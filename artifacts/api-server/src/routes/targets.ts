import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";
import { db, rolePermissionsTable } from "@workspace/db";
import { metricTargetsTable, type InsertMetricTarget } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/projects/:projectId/targets", requireAuth, async (req, res): Promise<void> => {
  const projectId = Array.isArray(req.params.projectId)
    ? req.params.projectId[0]
    : (req.params.projectId ?? "");
  const targets = await db
    .select()
    .from(metricTargetsTable)
    .where(eq(metricTargetsTable.projectId, projectId));
  res.json(targets);
});

router.post("/projects/:projectId/targets", requireAuth, async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const userRole = authReq.user?.role;

  // Only admin or users with can_edit on "targets" may modify targets
  if (userRole !== "admin") {
    const perm = await db
      .select()
      .from(rolePermissionsTable)
      .where(and(eq(rolePermissionsTable.role, userRole ?? ""), eq(rolePermissionsTable.section, "targets")))
      .limit(1);

    if (perm.length === 0 || !perm[0].canEdit) {
      res.status(403).json({ error: "Forbidden: insufficient permissions" });
      return;
    }
  }
  const projectId = Array.isArray(req.params.projectId)
    ? req.params.projectId[0]
    : (req.params.projectId ?? "");
  const { metric, targetValue, period } = req.body as { metric: string; targetValue: number; period?: string };

  if (!metric || targetValue === undefined) {
    res.status(400).json({ error: "metric and targetValue are required" });
    return;
  }

  const existing = await db
    .select()
    .from(metricTargetsTable)
    .where(
      and(
        eq(metricTargetsTable.projectId, projectId),
        eq(metricTargetsTable.metric, metric),
        eq(metricTargetsTable.period, period ?? "1m"),
      )
    );

  let target;
  if (existing.length > 0) {
    target = await db
      .update(metricTargetsTable)
      .set({ targetValue: String(targetValue), period: period ?? "1m" })
      .where(eq(metricTargetsTable.id, existing[0].id))
      .returning();
  } else {
    target = await db
      .insert(metricTargetsTable)
      .values({ projectId, metric, targetValue: String(targetValue), period: period ?? "1m" })
      .returning();
  }

  res.json(target[0] ?? target);
});

router.delete("/projects/:projectId/targets/:targetId", requireAuth, async (req, res): Promise<void> => {
  const targetId = Number(req.params.targetId);
  await db.delete(metricTargetsTable).where(eq(metricTargetsTable.id, targetId));
  res.status(204).end();
});

export default router;
