import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getJiraIssuesForProject,
  periodToDays,
  getCycleTimeDays,
  getResolutionDate,
  getStatusCategoryMap,
  isIssueDone,
  isIssueInProgress,
  type JiraIssue,
} from "../lib/jira";
import { requireAuth, requireSectionView } from "../middleware/auth";

const router: IRouter = Router();

const VALID_PERIODS = ["1m", "3m"] as const;
type Period = (typeof VALID_PERIODS)[number];

function isValidPeriod(p: string): p is Period {
  return (VALID_PERIODS as readonly string[]).includes(p);
}

interface StatusTimeline {
  created: Date;
  firstInProgress: Date | null;
  resolved: Date | null;
}

async function buildTimeline(
  issue: JiraIssue,
  categoryMap: Map<string, string>
): Promise<StatusTimeline> {
  const created = new Date(issue.fields.created);
  let firstInProgress: Date | null = null;
  const resolved = await getResolutionDate(issue);

  const histories = issue.changelog?.histories ?? [];
  for (const h of histories) {
    const statusItem = h.items.find((it) => it.field === "status");
    if (!statusItem) continue;
    const toStatus = statusItem.toString ?? "";
    if (
      !firstInProgress &&
      categoryMap.get(toStatus.trim().toLowerCase()) === "indeterminate"
    ) {
      firstInProgress = new Date(h.created);
    }
  }

  return { created, firstInProgress, resolved };
}

interface CfdPoint {
  date: string;
  todo: number;
  inProgress: number;
  done: number;
}

async function computeCfd(
  issues: JiraIssue[],
  periodDays: number
): Promise<CfdPoint[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  const categoryMap = await getStatusCategoryMap();
  const timelines = await Promise.all(issues.map((issue) => buildTimeline(issue, categoryMap)));

  const step = periodDays > 90 ? 7 : 1;
  const points: CfdPoint[] = [];

  const current = new Date(startDate);
  while (current <= endDate) {
    let todo = 0;
    let inProgress = 0;
    let done = 0;

    for (const t of timelines) {
      if (t.created > current) continue;

      if (t.resolved && t.resolved <= current) {
        done++;
      } else if (t.firstInProgress && t.firstInProgress <= current) {
        inProgress++;
      } else {
        todo++;
      }
    }

    points.push({
      date: current.toISOString().split("T")[0],
      todo,
      inProgress,
      done,
    });

    current.setDate(current.getDate() + step);
  }

  return points;
}

router.get(
  "/projects/:projectId/cfd/:period",
  requireAuth,
  requireSectionView("report"),
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period)
      ? req.params.period[0]
      : req.params.period;

    const projectId = rawId ?? "";
    const period = rawPeriod ?? "1m";

    if (!isValidPeriod(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m or 3m." });
      return;
    }

    const project = await getJiraProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const periodDays = periodToDays(period);
    // includeChangelog: required for buildTimeline() to find the first in-progress transition —
    // without it, every issue silently classified as either Done or To Do, and the CFD's "In
    // Progress" band was permanently zero (confirmed: 91/91 days showed inProgress: 0 for a
    // project with 28 real in-progress issues).
    const issues = await getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true });
    const dataPoints = await computeCfd(issues, periodDays);

    res.json({
      projectId,
      period,
      dataPoints,
    });
  }
);

export default router;
