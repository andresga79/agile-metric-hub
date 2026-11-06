import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraSprints,
  getSprintIssues,
  getStatusCategoryMap,
  isIssueDone,
  sprintCloseTime,
  wasIssueDoneAt,
  type JiraIssue,
  type JiraSprint,
} from "../lib/jira";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { sprintScopeIssues } from "./sprint-metrics";
import { buildSprintSummary, buildSprintSummaryKpis, previousClosedSprint } from "../lib/sprint-summary";

const router: IRouter = Router();

/** "Completed" for the summary: done at the moment a closed sprint closed (the "% real cerrado"
 *  rule), or the current status for a sprint that hasn't closed yet. */
async function doneRule(sprint: JiraSprint): Promise<(i: JiraIssue) => boolean> {
  const closeTime = sprintCloseTime(sprint);
  if (!closeTime) return isIssueDone;
  const categoryMap = await getStatusCategoryMap();
  return (i) => wasIssueDoneAt(i, closeTime, categoryMap);
}

router.get(
  "/projects/:projectId/sprint-summary/:sprintId",
  requireAuth,
  requireSectionView("sprints", "report"),
  async (req, res): Promise<void> => {
    const projectId = String(req.params.projectId);
    const sprintId = Number(req.params.sprintId);
    if (!Number.isInteger(sprintId)) {
      res.status(400).json({ error: "Invalid sprint id" });
      return;
    }

    const jiraProject = await getJiraProject(projectId);
    if (!jiraProject) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if ((await getProjectBoardType(projectId)) !== "scrum") {
      res.status(400).json({ error: "Sprint summary only available for Scrum projects" });
      return;
    }

    const sprints = await getJiraSprints(projectId, 50);
    const sprint = sprints.find((s) => s.id === sprintId);
    if (!sprint) {
      res.status(404).json({ error: "Sprint not found" });
      return;
    }
    const previous = previousClosedSprint(sprint, sprints);

    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();
    const [currentScope, previousScope] = await Promise.all([
      getSprintIssues(sprint.id).then((issues) => sprintScopeIssues(issues, allowedIssueTypes)),
      previous
        ? getSprintIssues(previous.id).then((issues) => sprintScopeIssues(issues, allowedIssueTypes))
        : Promise.resolve(null),
    ]);

    const current = buildSprintSummary(sprint, currentScope, await doneRule(sprint));
    const previousKpis = previous && previousScope
      ? buildSprintSummaryKpis(previous, previousScope, await doneRule(previous))
      : null;

    res.json({ ...current, previous: previousKpis });
  }
);

export default router;
