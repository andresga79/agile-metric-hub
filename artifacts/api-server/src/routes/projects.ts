import { Router, type IRouter } from "express";
import {
  listJiraProjects,
  getJiraProject,
  getJiraIssuesForProject,
  getProjectBoardType,
  isIssueDone,
  isIssueInProgress,
  isJiraConfigured,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";
import { filterVisibleProjects, isProjectKeyVisible } from "../lib/project-visibility";

const router: IRouter = Router();

function computeIssueStats(issues: Awaited<ReturnType<typeof getJiraIssuesForProject>>) {
  const done = issues.filter((i) => isIssueDone(i)).length;
  const inProgress = issues.filter((i) => isIssueInProgress(i)).length;
  return { issueCount: issues.length, doneCount: done, inProgressCount: inProgress };
}

router.get("/projects", requireAuth, async (_req, res): Promise<void> => {
  const jiraProjects = await filterVisibleProjects(await listJiraProjects());

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
        visible: true,
        lead: p.lead?.displayName ?? null,
        url: null,
        usingMockData: !isJiraConfigured(),
      };
    })
  );

  res.json(projects);
});

router.get("/projects/:projectId", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId)
    ? req.params.projectId[0]
    : req.params.projectId;
  const projectId = raw ?? "";

  const jiraProject = await getJiraProject(projectId);
  if (!jiraProject) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const visible = await isProjectKeyVisible(jiraProject.key);
  if (!visible) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [issues, boardType] = await Promise.all([
    getJiraIssuesForProject(projectId, 30),
    getProjectBoardType(projectId),
  ]);
  const stats = computeIssueStats(issues);

  res.json({
    id: jiraProject.id,
    key: jiraProject.key,
    name: jiraProject.name,
    description: jiraProject.description ?? null,
    projectType: jiraProject.projectTypeKey,
    boardType,
    methodology: boardType === "scrum" ? "Scrum" : "Kanban",
    avatarUrl: jiraProject.avatarUrls?.["48x48"] ?? null,
    issueCount: stats.issueCount,
    doneCount: stats.doneCount,
    inProgressCount: stats.inProgressCount,
    visible: true,
    lead: jiraProject.lead?.displayName ?? null,
    url: null,
    usingMockData: !isJiraConfigured(),
  });
});

export default router;
