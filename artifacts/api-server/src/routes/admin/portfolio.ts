import { Router, type IRouter } from "express";
import { type AuthRequest } from "../../middleware/auth";
import {
  getPortfolioAllowedIssueTypes,
  updatePortfolioAllowedIssueTypes,
} from "../../lib/portfolio-metric-settings";
import { getPortfolioRecalculationStatus } from "../../lib/portfolio-cache";

const router: IRouter = Router();

router.post("/portfolio/recalculate", async (_req, res): Promise<void> => {
  try {
    const { calculateAndCachePortfolio } = await import("../../lib/portfolio-cache");

    res.json({
      success: true,
      message: "Portfolio cache recalculation started in background",
    });

    setImmediate(async () => {
      await calculateAndCachePortfolio();
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/portfolio/issue-types", async (_req, res): Promise<void> => {
  try {
    const issueTypes = await getPortfolioAllowedIssueTypes();
    res.json({ issueTypes });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get("/portfolio/recalculate-status", async (_req, res): Promise<void> => {
  try {
    const status = await getPortfolioRecalculationStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put("/portfolio/issue-types", async (req, res): Promise<void> => {
  try {
    const { issueTypes } = req.body as { issueTypes?: string[] };
    if (!Array.isArray(issueTypes) || issueTypes.some((value) => typeof value !== "string")) {
      res.status(400).json({ error: "issueTypes must be an array of strings" });
      return;
    }

    const authReq = req as AuthRequest;
    const updatedIssueTypes = await updatePortfolioAllowedIssueTypes(
      issueTypes,
      authReq.user?.userId
    );

    res.json({
      success: true,
      issueTypes: updatedIssueTypes,
      message: "Issue type filter updated. Portfolio recalculation started in background",
    });

    setImmediate(async () => {
      const { calculateAndCachePortfolio } = await import("../../lib/portfolio-cache");
      await calculateAndCachePortfolio();
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

export default router;
