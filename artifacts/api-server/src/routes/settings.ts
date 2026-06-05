import { Router, type IRouter } from "express";
import { requireAdmin, requireAuth, type AuthRequest } from "../middleware/auth";
import { listJiraProjects } from "../lib/jira";
import {
  getProjectVisibilityMap,
  upsertProjectVisibility,
} from "../lib/project-visibility";

const router: IRouter = Router();

router.get(
  "/settings/project-visibility",
  requireAuth,
  requireAdmin,
  async (_req, res): Promise<void> => {
    const [jiraProjects, visibility] = await Promise.all([
      listJiraProjects(),
      getProjectVisibilityMap(),
    ]);

    const projects = jiraProjects.map((project) => ({
      projectId: project.id,
      projectKey: project.key,
      name: project.name,
      visible: visibility.get(project.key.trim().toUpperCase()) !== false,
    }));

    res.json({ projects });
  },
);

router.put(
  "/settings/project-visibility",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    const body = req.body as unknown;

    if (!body || typeof body !== "object" || !("projects" in body)) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const projects = (body as { projects?: unknown }).projects;

    if (!Array.isArray(projects)) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    const parsed = projects.map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const projectKey = (item as { projectKey?: unknown }).projectKey;
      const visible = (item as { visible?: unknown }).visible;

      if (typeof projectKey !== "string" || typeof visible !== "boolean") {
        return null;
      }

      return { projectKey, visible };
    });

    if (parsed.some((item) => item === null)) {
      res.status(400).json({ error: "Invalid request body" });
      return;
    }

    await upsertProjectVisibility(
      parsed as { projectKey: string; visible: boolean }[],
      req.user!.userId,
    );

    res.json({ message: "Settings updated" });
  },
);

export default router;
