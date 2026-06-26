import { Router, type IRouter } from "express";
import { db, portfolioCacheTable } from "@workspace/db";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";
import {
  listJiraProjects,
  isJiraConfigured,
  getProjectBoardType,
} from "../lib/jira";
import { getProjectVisibilityMap, upsertProjectVisibility } from "../lib/project-visibility";

const router: IRouter = Router();

interface ProjectWithVisibility {
  id: string;
  key: string;
  name: string;
  description: string | null;
  projectType: string;
  boardType: string;
  methodology: string;
  avatarUrl: string | null;
  issueCount: number;
  doneCount: number;
  inProgressCount: number;
  lead: string | null;
  url: string | null;
  usingMockData: boolean;
  visible: boolean;
}

router.get(
  "/user/projects",
  requireAuth,
  async (_req, res): Promise<void> => {
    const [jiraProjects, visibilityMap, portfolioRows] = await Promise.all([
      listJiraProjects(),
      getProjectVisibilityMap(),
      db
        .select()
        .from(portfolioCacheTable),
    ]);
    const portfolioMap = new Map(portfolioRows.map((r) => [r.projectId, r]));
    const fallbackProjects = portfolioRows.map((r) => ({
      id: r.projectId,
      key: r.projectKey,
      name: r.projectName,
      description: null,
      projectTypeKey: "software",
      avatarUrls: { "48x48": "" },
      lead: { displayName: null },
      self: "",
    }));
    const sourceProjects = jiraProjects.length > 0 ? jiraProjects : fallbackProjects;

    const boardTypes = await Promise.all(
      sourceProjects.map(async (p) => {
        const bt = await getProjectBoardType(p.id).catch(() => "simple" as const);
        return [p.id, bt] as const;
      })
    );
    const boardTypeMap = new Map(boardTypes);

    const projects: ProjectWithVisibility[] = sourceProjects.map((p) => {
      const visible = visibilityMap.get(p.key.trim().toUpperCase()) !== false;
      const cached = portfolioMap.get(p.id);
      const boardType = boardTypeMap.get(p.id) ?? "simple";

      return {
        id: p.id,
        key: p.key,
        name: p.name,
        description: p.description ?? null,
        projectType: p.projectTypeKey,
        boardType,
        methodology: boardType === "scrum" ? "Scrum" : "Kanban",
        avatarUrl: p.avatarUrls?.["48x48"] ?? null,
        issueCount: cached?.issueCount ?? 0,
        doneCount: cached?.doneCount ?? 0,
        inProgressCount: cached?.inProgressCount ?? 0,
        lead: p.lead?.displayName ?? null,
        url: null,
        usingMockData: !isJiraConfigured(),
        visible,
      };
    });

    res.json(projects);
  }
);

const updateSchema = {
  type: "object",
  properties: {
    projectId: { type: "string" },
    visible: { type: "boolean" },
  },
  required: ["projectId", "visible"],
};

router.put(
  "/user/projects",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.userId;
    const body = req.body as unknown;

    if (!Array.isArray(body)) {
      res
        .status(400)
        .json({ error: "Body must be an array of { projectId, visible }" });
      return;
    }

    const [jiraProjects, portfolioRows] = await Promise.all([
      listJiraProjects(),
      db.select().from(portfolioCacheTable),
    ]);

    const idToKey = new Map<string, string>();
    for (const project of jiraProjects) {
      idToKey.set(project.id, project.key);
    }
    for (const row of portfolioRows) {
      if (!idToKey.has(row.projectId)) {
        idToKey.set(row.projectId, row.projectKey);
      }
    }

    const parsedEntries: { projectKey: string; visible: boolean }[] = [];
    for (const item of body as { projectId?: unknown; visible?: unknown }[]) {
      if (typeof item.projectId !== "string" || typeof item.visible !== "boolean") {
        res.status(400).json({ error: `Invalid item: ${JSON.stringify(item)}` });
        return;
      }

      const projectKey = idToKey.get(item.projectId);
      if (!projectKey) {
        res.status(400).json({ error: `Unknown projectId: ${item.projectId}` });
        return;
      }

      parsedEntries.push({ projectKey, visible: item.visible });
    }

    await upsertProjectVisibility(parsedEntries, userId);

    res.json({ ok: true });
  }
);

export default router;
