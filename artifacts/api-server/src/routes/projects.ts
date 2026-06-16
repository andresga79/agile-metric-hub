import { Router, type IRouter } from "express";
import {
  listJiraProjects,
  isJiraConfigured,
  getProjectBoardType,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";
import { filterVisibleProjects, isProjectKeyVisible } from "../lib/project-visibility";
import { db, portfolioCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/projects", requireAuth, async (_req, res): Promise<void> => {
  const [jiraProjects, portfolioRows] = await Promise.all([
    filterVisibleProjects(await listJiraProjects()),
    db.select().from(portfolioCacheTable),
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

  const projects = sourceProjects.map((p) => {
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
      visible: true,
      lead: p.lead?.displayName ?? null,
      url: null,
      usingMockData: !isJiraConfigured(),
    };
  });

  res.json(projects);
});

router.get("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId)
    ? req.params.projectId[0]
    : req.params.projectId;
  const projectId = raw ?? "";

  const [allProjects, cached, boardType] = await Promise.all([
    listJiraProjects(),
    db
      .select()
      .from(portfolioCacheTable)
      .where(eq(portfolioCacheTable.projectId, projectId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getProjectBoardType(projectId).catch(() => "simple" as const),
  ]);

  const jiraProject = allProjects.find(
    (p) => p.id === projectId || p.key === projectId
  );

  const fallbackProject = cached
    ? {
        id: cached.projectId,
        key: cached.projectKey,
        name: cached.projectName,
        description: null,
        projectTypeKey: "software",
        avatarUrls: { "48x48": "" },
        lead: { displayName: null },
        self: "",
      }
    : null;

  const sourceProject = jiraProject ?? fallbackProject;
  if (!sourceProject) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const visible = await isProjectKeyVisible(sourceProject.key);
  if (!visible) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({
    id: sourceProject.id,
    key: sourceProject.key,
    name: sourceProject.name,
    description: sourceProject.description ?? null,
    projectType: sourceProject.projectTypeKey,
    boardType,
    methodology: boardType === "scrum" ? "Scrum" : "Kanban",
    avatarUrl: sourceProject.avatarUrls?.["48x48"] ?? null,
    issueCount: cached?.issueCount ?? 0,
    doneCount: cached?.doneCount ?? 0,
    inProgressCount: cached?.inProgressCount ?? 0,
    visible: true,
    lead: sourceProject.lead?.displayName ?? null,
    url: null,
    usingMockData: !isJiraConfigured(),
  });
});

export default router;
