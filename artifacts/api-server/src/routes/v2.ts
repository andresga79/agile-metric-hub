import { Router, type IRouter } from "express";
import { getJiraProject } from "../lib/jira";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { parseDayWindow, parseSprintWindow } from "../lib/v2/window";
import { getPortfolioView, getTeamView } from "../lib/v2/service";

const router: IRouter = Router();

// Same baseline as /portfolio: any authenticated user (it feeds the executive overview).
router.get("/v2/portfolio", requireAuth, async (req, res): Promise<void> => {
  res.json(await getPortfolioView(parseSprintWindow(req.query.sprints)));
});

router.get(
  "/v2/projects/:projectId/team",
  requireAuth,
  requireSectionView("sprints", "kanban"),
  async (req, res): Promise<void> => {
    const projectId = String(req.params.projectId);
    const project = await getJiraProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    // getTeamView picks by board type: Scrum reads `sprints` (3|6|12, default 6), Kanban/simple
    // reads `days` (30|90|180, default 90); the other one is ignored.
    const view = await getTeamView(projectId, {
      sprints: parseSprintWindow(req.query.sprints),
      days: parseDayWindow(req.query.days),
      project: { id: project.id, key: project.key, name: project.name },
    });
    res.json(view);
  },
);

export default router;
