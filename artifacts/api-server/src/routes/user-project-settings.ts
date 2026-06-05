import { Router, type IRouter } from "express";
import { db, userProjectSettingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import {
  listJiraProjects,
  getJiraIssuesForProject,
  getProjectBoardType,
  isIssueDone,
  isIssueInProgress,
  isJiraConfigured,
} from "../lib/jira";

const router: IRouter = Router();

function computeIssueStats(
  issues: Awaited<ReturnType<typeof getJiraIssuesForProject>>
) {
  const done = issues.filter((i) => isIssueDone(i)).length;
  const inProgress = issues.filter((i) => isIssueInProgress(i)).length;
  return {
    issueCount: issues.length,
    doneCount: done,
    inProgressCount: inProgress,
  };
}

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

    const jiraProjects = await listJiraProjects();
    const settings = await db
      .select()
      .from(userProjectSettingsTable)
      .where(eq(userProjectSettingsTable.userId, userId));

    const settingsMap = new Map(
      settings.map((s) => [s.projectId, s.visible])
    );

    const projects = await Promise.all(
      jiraProjects.map(async (p) => {
        const [issues, boardType] = await Promise.all([
          getJiraIssuesForProject(p.id, 30),
          getProjectBoardType(p.id),
        ]);
        const stats = computeIssueStats(issues);
        return {
          id: p.id,
          key: p.key,
          name: p.name,
          description: p.description ?? null,
          projectType: p.projectTypeKey,
          boardType,
          methodology: boardType === "scrum" ? "Scrum" : "Kanban",
          avatarUrl: p.avatarUrls?.["48x48"] ?? null,
          issueCount: stats.issueCount,
          doneCount: stats.doneCount,
          inProgressCount: stats.inProgressCount,
          lead: p.lead?.displayName ?? null,
          url: null,
          usingMockData: !isJiraConfigured(),
          visible: settingsMap.get(p.id) ?? true,
        };
      })
    );

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
