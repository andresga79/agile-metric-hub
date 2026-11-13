import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getProjectBoardType,
  getJiraSprints,
  getSprintIssues,
  resolveSprintWindowDays,
  getJiraIssuesForWindow,
  getEffectiveIssueType,
  getStoryPoints,
  isIssueDone,
  isNonDeliveryClosure,
  wasIssueDoneAt,
  sprintCloseTime,
  getStatusCategoryMap,
  isAddedAfterPlanning,
  getDeliveryDate,
  getCycleTimeDays,
  type JiraIssue,
} from "../lib/jira";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import {
  buildSprintComposition,
  type CompositionDelivered,
  type CompositionSprintInput,
} from "../lib/sprint-composition";

const router: IRouter = Router();

const WINDOW_SPRINTS: Record<string, number> = { "2s": 2, "6s": 6 };

/** Composición del sprint por tipo de trabajo over the last 2 / 6 CLOSED sprints (the active one
 *  never counts: its numbers still move). Read by the Sprints card and Capacity's expected mix.
 *  Scope per sprint = the Sprints table's (allowed types, minus closed non-delivery) plus
 *  Capacity's project-key filter: a board filter can pull in another project's issues. */
router.get(
  "/projects/:projectId/sprint-composition/:window",
  requireAuth,
  requireSectionView("sprints", "capacity"),
  async (req, res): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      const sprintCount = WINDOW_SPRINTS[String(req.params.window)];
      if (!sprintCount) {
        res.status(400).json({ error: "window debe ser '2s' o '6s'" });
        return;
      }

      const project = await getJiraProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if ((await getProjectBoardType(projectId)) !== "scrum") {
        res.status(400).json({ error: "Sprint metrics only available for Scrum projects" });
        return;
      }

      const window = resolveSprintWindowDays(await getJiraSprints(projectId, 50), sprintCount);
      if (!window) {
        res.json(buildSprintComposition([], []));
        return;
      }
      // Newest first from resolveSprintWindowDays; the card reads oldest → newest.
      const included = [...window.sprintsIncluded].reverse();

      const [allowedIssueTypes, categoryMap] = await Promise.all([
        getPortfolioAllowedIssueTypes(),
        getStatusCategoryMap(),
      ]);
      const inScopeType = (i: JiraIssue): boolean =>
        i.key.startsWith(`${project.key}-`) && allowedIssueTypes.includes(getEffectiveIssueType(i));

      const sprintInputs: CompositionSprintInput[] = await Promise.all(
        included.map(async (sprint) => {
          const typed = (await getSprintIssues(sprint.id)).filter(inScopeType);
          const nonDelivery = await Promise.all(typed.map((i) => isNonDeliveryClosure(i)));
          const scope = typed.filter((i, idx) => !(nonDelivery[idx] && isIssueDone(i)));
          const closeTime = sprintCloseTime(sprint);
          return {
            sprintId: sprint.id,
            sprintName: sprint.name,
            issues: scope.map((i) => ({
              key: i.key,
              category: getEffectiveIssueType(i),
              storyPoints: getStoryPoints(i),
              doneAtClose: closeTime ? wasIssueDoneAt(i, closeTime, categoryMap) : isIssueDone(i),
              addedAfterPlanning: isAddedAfterPlanning(i, sprint),
            })),
          };
        })
      );

      // Cycle time by delivery date, inside the [start, close) of one of the included sprints —
      // the same population as sprintDeliveryTimes.closedPooled (Métricas), without the gaps
      // between sprints.
      const sprintWindows = included
        .filter((s) => s.startDate)
        .map((s) => ({
          start: new Date(s.startDate!).getTime(),
          end: new Date(s.completeDate ?? s.endDate ?? Date.now()).getTime(),
        }));
      const fetched = await getJiraIssuesForWindow(projectId, window.days, { includeChangelog: true });
      const candidates = Array.from(new Map(fetched.map((i) => [i.key, i])).values()).filter(
        (i) => inScopeType(i) && isIssueDone(i)
      );
      const delivered: CompositionDelivered[] = (
        await Promise.all(
          candidates.map(async (i) => {
            const at = await getDeliveryDate(i);
            if (!at) return null;
            const t = at.getTime();
            if (!sprintWindows.some((w) => t >= w.start && t < w.end)) return null;
            return { key: i.key, category: getEffectiveIssueType(i), cycleTimeDays: await getCycleTimeDays(i) };
          })
        )
      ).filter((d): d is CompositionDelivered => d !== null);

      res.json(buildSprintComposition(sprintInputs, delivered));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

export default router;
