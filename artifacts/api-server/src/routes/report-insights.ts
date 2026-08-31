import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getJiraSprints, getProjectBoardType } from "../lib/jira";

const router: IRouter = Router();

router.get(
  "/projects/:projectId/sprint-goal",
  requireAuth,
  requireSectionView("sprints", "report"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;

    const boardType = await getProjectBoardType(projectId);
    if (boardType !== "scrum") {
      res.json(null);
      return;
    }

    const sprints = await getJiraSprints(projectId, 50);
    const active = sprints.find((s) => s.state === "active");
    if (!active || !active.goal || active.goal.trim() === "") {
      res.json(null);
      return;
    }

    res.json({ sprintName: active.name, goal: active.goal.trim() });
  }
);

export default router;
