import { Router, type IRouter } from "express";
import { getLastSyncedAt, getIsSyncing } from "../lib/jira-cache";

const router: IRouter = Router();

router.get("/sync/status", (_req, res) => {
  const lastSynced = getLastSyncedAt();
  res.json({
    lastSyncedAt: lastSynced ? lastSynced.toISOString() : null,
    isSyncing: getIsSyncing(),
  });
});

export default router;
