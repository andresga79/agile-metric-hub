import { Router, type IRouter } from "express";
import { db, userProjectSettingsTable, portfolioCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import {
  listJiraProjects,
  isJiraConfigured,
  getProjectBoardType,
} from "../lib/jira";

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
  async (req, res): Promise<void> => {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.userId;

    const [jiraProjects, settings, portfolioRows] = await Promise.all([
      listJiraProjects(),
      db
        .select()
        .from(userProjectSettingsTable)
        .where(eq(userProjectSettingsTable.userId, userId)),
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

    const settingsMap = new Map(
      settings.map((s) => [s.projectId, s.visible])
    );

    const boardTypes = await Promise.all(
      sourceProjects.map(async (p) => {
        const bt = await getProjectBoardType(p.id).catch(() => "simple" as const);
        return [p.id, bt] as const;
      })
    );
    const boardTypeMap = new Map(boardTypes);

    const projects: ProjectWithVisibility[] = sourceProjects.map((p) => {
      const visible = settingsMap.get(p.id) ?? true;
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
  async (req, res): Promise<void> => {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.userId;
    const body = req.body;

    if (!Array.isArray(body)) {
      res
        .status(400)
        .json({ error: "Body must be an array of { projectId, visible }" });
      return;
    }

    await db.transaction(async (tx) => {
      for (const item of body) {
        if (!item.projectId || typeof item.visible !== "boolean") {
          res
            .status(400)
            .json({
              error: `Invalid item: ${JSON.stringify(item)}`,
            });
          return;
        }
        await tx
          .insert(userProjectSettingsTable)
          .values({
            userId,
            projectId: item.projectId,
            visible: item.visible,
          })
          .onConflictDoUpdate({
            target: [
              userProjectSettingsTable.userId,
              userProjectSettingsTable.projectId,
            ],
            set: { visible: item.visible },
          });
      }
    });

    res.json({ ok: true });
  }
);

export default router;
