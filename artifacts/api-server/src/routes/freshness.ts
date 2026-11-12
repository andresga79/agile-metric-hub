import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { getProjectDataFetchedAt } from "../lib/jira";
import { freshness } from "../lib/freshness";

const router: IRouter = Router();

/** How fresh a project's Jira data is ("Datos de Jira: hace X"), shown on every project page.
 *  Not gated by section: every project page shows it. */
router.get("/projects/:projectId/freshness", requireAuth, async (req, res): Promise<void> => {
  try {
    const fetchedAt = await getProjectDataFetchedAt(String(req.params.projectId));
    res.json(freshness(fetchedAt, new Date()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
