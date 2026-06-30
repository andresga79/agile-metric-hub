import { Router, type IRouter } from "express";
import { db, defaultMetricThresholdsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEFAULT_HEALTH_THRESHOLDS } from "./constants";

const router: IRouter = Router();

router.get("/metric-thresholds", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .orderBy(defaultMetricThresholdsTable.metric);

  if (rows.length === 0) {
    const inserted = await db
      .insert(defaultMetricThresholdsTable)
      .values(DEFAULT_HEALTH_THRESHOLDS.map((threshold) => ({
        metric: threshold.metric,
        goodValue: String(threshold.goodValue),
        warningValue: String(threshold.warningValue),
      })))
      .returning();
    res.json(inserted);
    return;
  }

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
    .where(eq(defaultMetricThresholdsTable.metric, metric))
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
      .values({ metric, goodValue: String(gv), warningValue: String(wv) })
      .returning();
  }

  res.json(result);
});

export default router;
