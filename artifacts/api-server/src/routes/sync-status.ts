import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { getSyncStatus, triggerSyncNow } from "../lib/jira-cache";

const router: IRouter = Router();

router.get("/sync/status", (_req, res) => {
  res.json(getSyncStatus());
});

router.post("/sync/run", requireAuth, async (_req, res): Promise<void> => {
  const result = await triggerSyncNow("manual");
  res.status(result.started ? 202 : 409).json(result);
});

export default router;
