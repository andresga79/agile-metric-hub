import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { getEffectiveThresholds } from "../lib/health-thresholds";

// Read-only effective thresholds (global defaults with per-project overrides applied) for any
// authenticated user. The dashboard used to read /api/admin/metric-thresholds directly, which is
// admin-only: members got 403 and every screen silently fell back to factory defaults, so the
// same number could be green for a member and red for an admin (e.g. customized cycleTime 5/7
// vs factory 15/25). Open to every authenticated role like /metrics - the thresholds color the
// overview and Resumen Ejecutivo, which aren't gated per section.
const router: IRouter = Router();

router.get("/thresholds", requireAuth, async (_req, res): Promise<void> => {
  res.json(await getEffectiveThresholds());
});

router.get("/projects/:projectId/thresholds", requireAuth, async (req, res): Promise<void> => {
  const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
  res.json(await getEffectiveThresholds(projectId));
});

export default router;
