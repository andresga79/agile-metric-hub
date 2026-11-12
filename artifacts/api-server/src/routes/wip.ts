import { Router, type IRouter } from "express";
import { requireAuth, requireSectionView } from "../middleware/auth";
import {
  getJiraProject,
  getOpenIssuesForProject,
  getJiraIssuesForWindow,
  getEffectiveIssueType,
  isIssueDone,
  isIssueInProgress,
  getDeliveryDate,
  getCycleTimeDays,
  getWorkStartDate,
  type JiraIssue,
} from "../lib/jira";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { buildWip, flowByWeek, sustainableWip, WIP_FLOW_WEEKS, type WipIssueInput } from "../lib/wip";

const router: IRouter = Router();

/** Work in progress for Scrumban teams: what is in flight now and how old it is, started vs
 *  delivered per week, and the WIP the team sustains at its pace (Little's law). "In progress" =
 *  open issue whose work started (same start as cycle time), so an item's age and its eventual
 *  cycle time are measured from the same instant and can be compared with the team's P50/P85. */
router.get(
  "/projects/:projectId/wip",
  requireAuth,
  requireSectionView("flow"),
  async (req, res): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      const project = await getJiraProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const now = new Date();
      const [open, recent, allowedIssueTypes] = await Promise.all([
        getOpenIssuesForProject(projectId, { includeChangelog: true }),
        getJiraIssuesForWindow(projectId, WIP_FLOW_WEEKS * 7 + 7, { includeChangelog: true }),
        getPortfolioAllowedIssueTypes(),
      ]);
      const allowed = (i: JiraIssue) =>
        i.key.startsWith(`${project.key}-`) && allowedIssueTypes.includes(getEffectiveIssueType(i));

      const openAllowed = open.filter((i) => allowed(i) && !isIssueDone(i));
      const openStarts = await Promise.all(openAllowed.map((i) => getWorkStartDate(i)));
      const wipInputs: WipIssueInput[] = [];
      openAllowed.forEach((i, idx) => {
        const startedAt = openStarts[idx];
        if (!startedAt) return;
        wipInputs.push({
          key: i.key,
          summary: i.fields.summary,
          assignee: i.fields.assignee?.displayName ?? null,
          issueType: i.fields.issuetype.name,
          status: i.fields.status.name,
          active: isIssueInProgress(i),
          startedAt,
        });
      });
      const { items, byStatus } = buildWip(wipInputs, now);

      // Started / delivered per week: every allowed issue seen in the window or open now, once.
      const all = Array.from(new Map([...recent, ...open].filter(allowed).map((i) => [i.key, i])).values());
      const [starts, deliveries, cycles] = await Promise.all([
        Promise.all(all.map((i) => getWorkStartDate(i))),
        Promise.all(all.map((i) => (isIssueDone(i) ? getDeliveryDate(i) : Promise.resolve(null)))),
        Promise.all(all.map((i) => (isIssueDone(i) ? getCycleTimeDays(i) : Promise.resolve(null)))),
      ]);
      const weeks = flowByWeek(
        starts.filter((d): d is Date => d !== null),
        deliveries.filter((d): d is Date => d !== null),
        now
      );
      const windowStart = new Date(weeks[0]!.weekStart).getTime();
      const windowCycles = cycles.filter(
        (c, idx): c is number => c !== null && deliveries[idx] !== null && deliveries[idx]!.getTime() >= windowStart
      );
      const meanCycle = windowCycles.length ? windowCycles.reduce((a, b) => a + b, 0) / windowCycles.length : null;

      res.json({
        total: items.length,
        items,
        byStatus,
        weeks,
        sustainableWip: sustainableWip(weeks, meanCycle),
        meanCycleTimeDays: meanCycle === null ? null : Math.round(meanCycle * 10) / 10,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  }
);

export default router;
