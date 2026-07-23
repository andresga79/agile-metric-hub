import { Router, type IRouter } from "express";
import { db, defaultMetricThresholdsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { DEFAULT_HEALTH_THRESHOLDS } from "./constants";

const router: IRouter = Router();

router.get("/metric-thresholds", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .where(isNull(defaultMetricThresholdsTable.projectId))
    .orderBy(defaultMetricThresholdsTable.metric);

  // Seed only the metrics that aren't already there yet, not just on a fully-empty table — a
  // metric added to DEFAULT_HEALTH_THRESHOLDS after this table was first seeded (e.g.
  // sprintCompletion) would otherwise never appear until someone truncates the whole table.
  const existingMetrics = new Set(rows.map((r) => r.metric));
  const missing = DEFAULT_HEALTH_THRESHOLDS.filter((t) => !existingMetrics.has(t.metric));

  if (missing.length > 0) {
    const inserted = await db
      .insert(defaultMetricThresholdsTable)
      .values(missing.map((threshold) => ({
        metric: threshold.metric,
        projectId: null,
        goodValue: String(threshold.goodValue),
        warningValue: String(threshold.warningValue),
      })))
      .returning();
    res.json([...rows, ...inserted].sort((a, b) => a.metric.localeCompare(b.metric)));
    return;
  }

  res.json(rows);
});

// Per-project overrides only (does not include the global rows) — an empty array means
// the project inherits every global default as-is.
router.get("/metric-thresholds/project/:projectId", async (req, res): Promise<void> => {
  const { projectId } = req.params;
  const rows = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .where(eq(defaultMetricThresholdsTable.projectId, projectId))
    .orderBy(defaultMetricThresholdsTable.metric);

  res.json(rows);
});

router.put("/metric-thresholds/:metric", async (req, res): Promise<void> => {
  const metric = req.params.metric;
  const { goodValue, warningValue } = req.body;

  if (goodValue === undefined || warningValue === undefined) {
    res.status(400).json({ error: "goodValue and warningValue are required" });
    return;
  }

  const gv = Number(goodValue);
  const wv = Number(warningValue);
  if (isNaN(gv) || isNaN(wv)) {
    res.status(400).json({ error: "goodValue and warningValue must be valid numbers" });
    return;
  }

  const existing = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .where(and(eq(defaultMetricThresholdsTable.metric, metric), isNull(defaultMetricThresholdsTable.projectId)))
    .limit(1);

  let result;
  if (existing.length > 0) {
    [result] = await db
      .update(defaultMetricThresholdsTable)
      .set({ goodValue: String(gv), warningValue: String(wv) })
      .where(eq(defaultMetricThresholdsTable.id, existing[0].id))
      .returning();
  } else {
    [result] = await db
      .insert(defaultMetricThresholdsTable)
      .values({ metric, projectId: null, goodValue: String(gv), warningValue: String(wv) })
      .returning();
  }

  res.json(result);
});

router.put("/metric-thresholds/:metric/project/:projectId", async (req, res): Promise<void> => {
  const { metric, projectId } = req.params;
  const { goodValue, warningValue } = req.body;

  if (goodValue === undefined || warningValue === undefined) {
    res.status(400).json({ error: "goodValue and warningValue are required" });
    return;
  }

  const gv = Number(goodValue);
  const wv = Number(warningValue);
  if (isNaN(gv) || isNaN(wv)) {
    res.status(400).json({ error: "goodValue and warningValue must be valid numbers" });
    return;
  }

  const existing = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .where(and(eq(defaultMetricThresholdsTable.metric, metric), eq(defaultMetricThresholdsTable.projectId, projectId)))
    .limit(1);

  let result;
  if (existing.length > 0) {
    [result] = await db
      .update(defaultMetricThresholdsTable)
      .set({ goodValue: String(gv), warningValue: String(wv) })
      .where(eq(defaultMetricThresholdsTable.id, existing[0].id))
      .returning();
  } else {
    [result] = await db
      .insert(defaultMetricThresholdsTable)
      .values({ metric, projectId, goodValue: String(gv), warningValue: String(wv) })
      .returning();
  }

  res.json(result);
});

// Removes a project-level override, reverting that metric back to the global default.
router.delete("/metric-thresholds/:metric/project/:projectId", async (req, res): Promise<void> => {
  const { metric, projectId } = req.params;

  await db
    .delete(defaultMetricThresholdsTable)
    .where(and(eq(defaultMetricThresholdsTable.metric, metric), eq(defaultMetricThresholdsTable.projectId, projectId)));

  res.status(204).end();
});

export default router;
