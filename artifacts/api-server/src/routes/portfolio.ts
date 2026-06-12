import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { portfolioCacheTable } from "@workspace/db/schema";
import { isPortfolioCacheStale } from "../lib/portfolio-cache";
import { requireAuth } from "../middleware/auth";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/portfolio", requireAuth, async (_req, res): Promise<void> => {
  try {
    // Fetch cached portfolio data ordered by throughput (highest first)
    const portfolio = await db
      .select()
      .from(portfolioCacheTable)
      .orderBy(desc(portfolioCacheTable.throughput));

    // Convert numeric strings to numbers for response
    const formatted = portfolio.map((item) => ({
      id: item.projectId,
      key: item.projectKey,
      name: item.projectName,
      issueCount: item.issueCount,
      doneCount: item.doneCount,
      inProgressCount: item.inProgressCount,
      throughput: item.throughput,
      cycleTimeP50: item.cycleTimeP50 ? Number(item.cycleTimeP50) : null,
      leadTimeAvg: item.leadTimeAvg ? Number(item.leadTimeAvg) : null,
      error: item.error,
      cachedAt: item.calculatedAt,
    }));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
