import { Router, type IRouter } from "express";
import {
  getJiraProject,
  getJiraIssuesForProject,
  periodToDays,
  getCycleTimeDays,
  getResolutionDate,
  isIssueDone,
  isIssueInProgress,
  type JiraIssue,
} from "../lib/jira";
import { requireAuth } from "../middleware/auth";

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

async function buildTimeline(issue: JiraIssue): Promise<StatusTimeline> {
  const created = new Date(issue.fields.created);
  let firstInProgress: Date | null = null;
  const resolved = await getResolutionDate(issue);

  const histories = issue.changelog?.histories ?? [];
  for (const h of histories) {
    const statusItem = h.items.find((it) => it.field === "status");
    if (!statusItem) continue;
    const toStatus = statusItem.toString ?? "";
    const toLower = toStatus.trim().toLowerCase();
    if (
      !firstInProgress &&
      isActiveStatus(toLower)
    ) {
      firstInProgress = new Date(h.created);
    }
  }

  return { created, firstInProgress, resolved };
}

function isActiveStatus(name: string): boolean {
  const activeKeywords = [
    "in progress", "in-progress", "inprogress",
    "review", "development", "implementing",
    "en curso", "progreso", "desarrollo",
  ];
  return activeKeywords.some((k) => name.includes(k));
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

  const timelines = await Promise.all(issues.map(buildTimeline));

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
    const issues = await getJiraIssuesForProject(projectId, periodDays);
    const dataPoints = await computeCfd(issues, periodDays);

    res.json({
      projectId,
      period,
      dataPoints,
    });
  }
);

export default router;
