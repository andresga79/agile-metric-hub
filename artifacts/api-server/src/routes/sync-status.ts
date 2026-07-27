import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getSyncStatus, triggerSyncNow } from "../lib/jira-cache";

const router: IRouter = Router();

router.get("/sync/status", (_req, res) => {
  res.json(getSyncStatus());
});

// Triggering a manual sync is an action (hits Jira, mutates the cache), not a read —
// restricted to admin so read-only roles (member) can only view, never kick off a sync.
router.post("/sync/run", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const result = await triggerSyncNow("manual");
  res.status(result.started ? 202 : 409).json(result);
});

export default router;
