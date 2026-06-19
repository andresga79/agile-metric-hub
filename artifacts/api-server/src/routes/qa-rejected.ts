import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import {
  getJiraProject,
  getJiraIssuesForProject,
  getJiraSprints,
  getQaStatusSet,
  getDevReturnStatusSet,
  getQaStatuses,
  getDevReturnStatuses,
  findQaRejections,
  extractLinkedBugs,
  isBugIssue,
  periodToDays,
  isJiraConfigured,
  type JiraSprint,
  type JiraIssue,
  type QaRejection,
  type LinkedBug,
} from "../lib/jira";

const router: IRouter = Router();

const VALID_PERIODS = ["1m", "3m"] as const;
type Period = (typeof VALID_PERIODS)[number];

function isValidPeriod(p: string): p is Period {
  return (VALID_PERIODS as readonly string[]).includes(p);
}

function countQaEntries(
  issues: JiraIssue[],
  qaStatusSet: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    const histories = issue.changelog?.histories ?? [];
    let entries = 0;
    for (const h of histories) {
      for (const item of h.items) {
        if (item.field !== "status") continue;
        const to = item.toString?.trim() ?? "";
        if (to && qaStatusSet.has(to.toLowerCase())) {
          entries++;
        }
      }
    }
    if (entries > 0) {
      counts.set(issue.key, entries);
    }
  }
  return counts;
}

function findSprintForDate(
  date: Date,
  sprints: JiraSprint[]
): JiraSprint | null {
  for (const s of sprints) {
    if (!s.startDate) continue;
    const start = new Date(s.startDate);
    const end = s.endDate
      ? new Date(s.endDate)
      : s.completeDate
        ? new Date(s.completeDate)
        : null;
    if (!end) continue;
    if (date >= start && date <= end) return s;
  }
  return null;
}

function getMockQaQuality(): {
  qaStatuses: string[];
  devReturnStatuses: string[];
  totalRejectedReversions: number;
  totalIssuesRejected: number;
  totalIssuesThatEnteredQa: number;
  overallRejectionRate: number;
  totalLinkedBugs: number;
  totalStandaloneBugs: number;
  overallBugRate: number;
  overallQaImpactRate: number;
  bySprint: {
    sprintName: string;
    rejectedCount: number;
    totalEnteredQa: number;
    rate: number;
    bugsCount: number;
    bugRate: number;
    qaImpactRate: number;
  }[];
  rejectedIssues: {
    key: string;
    summary: string;
    issueType: string;
    fromStatus: string;
    toStatus: string;
    transitionedAt: string;
    sprintName: string | null;
  }[];
  linkedBugs: {
    bugKey: string;
    bugSummary: string;
    bugStatus: string;
    bugCreated: string;
    parentStoryKey: string;
    parentStorySummary: string;
    parentStoryRejected: boolean;
  }[];
} {
  return {
    qaStatuses: ["QA In Progress", "Testing"],
    devReturnStatuses: ["To Do", "Ready for Dev", "Dev In Progress", "In Progress"],
    totalRejectedReversions: 3,
    totalIssuesRejected: 2,
    totalIssuesThatEnteredQa: 8,
    overallRejectionRate: 25,
    totalLinkedBugs: 4,
    totalStandaloneBugs: 1,
    overallBugRate: 50,
    overallQaImpactRate: 62.5,
    bySprint: [
      { sprintName: "Sprint 10", rejectedCount: 2, totalEnteredQa: 5, rate: 40, bugsCount: 3, bugRate: 60, qaImpactRate: 80 },
      { sprintName: "Sprint 11", rejectedCount: 1, totalEnteredQa: 3, rate: 33.3, bugsCount: 1, bugRate: 33.3, qaImpactRate: 66.7 },
    ],
    rejectedIssues: [
      { key: "PLATFORM-105", summary: "Implement user authentication flow", issueType: "Story", fromStatus: "QA In Progress", toStatus: "Ready for Dev", transitionedAt: "2026-05-10T14:30:00.000Z", sprintName: "Sprint 10" },
      { key: "PLATFORM-108", summary: "Optimize database queries", issueType: "Story", fromStatus: "Testing", toStatus: "Dev In Progress", transitionedAt: "2026-05-12T09:15:00.000Z", sprintName: "Sprint 10" },
      { key: "PLATFORM-112", summary: "Add error monitoring integration", issueType: "Task", fromStatus: "QA In Progress", toStatus: "To Do", transitionedAt: "2026-05-22T16:00:00.000Z", sprintName: "Sprint 11" },
    ],
    linkedBugs: [
      { bugKey: "PLATFORM-201", bugSummary: "Login form crashes on empty email", bugStatus: "In Progress", bugCreated: "2026-05-11T10:00:00.000Z", parentStoryKey: "PLATFORM-105", parentStorySummary: "Implement user authentication flow", parentStoryRejected: true },
      { bugKey: "PLATFORM-202", bugSummary: "Password field does not mask characters", bugStatus: "Done", bugCreated: "2026-05-11T11:30:00.000Z", parentStoryKey: "PLATFORM-105", parentStorySummary: "Implement user authentication flow", parentStoryRejected: true },
      { bugKey: "PLATFORM-203", bugSummary: "Query timeout on large datasets", bugStatus: "Ready for Dev", bugCreated: "2026-05-13T08:00:00.000Z", parentStoryKey: "PLATFORM-108", parentStorySummary: "Optimize database queries", parentStoryRejected: true },
      { bugKey: "PLATFORM-205", bugSummary: "Error monitoring shows false positives", bugStatus: "To Do", bugCreated: "2026-05-23T09:00:00.000Z", parentStoryKey: "PLATFORM-112", parentStorySummary: "Add error monitoring integration", parentStoryRejected: true },
    ],
  };
}

router.get(
  "/projects/:projectId/qa-rejected/:period",
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

    if (!isJiraConfigured()) {
      const mock = getMockQaQuality();
      res.json({ projectId, period, ...mock });
      return;
    }

    const periodDays = periodToDays(period);

    const [issues, sprints, qaStatusSet, devStatusSet] = await Promise.all([
      getJiraIssuesForProject(projectId, periodDays, {
        includeChangelog: true,
        includeIssueLinks: true,
      }),
      getJiraSprints(projectId),
      getQaStatusSet(),
      getDevReturnStatusSet(projectId),
    ]);

    // --- Rejection detection (existing) ---
    const allRejections: (QaRejection & { sprintName: string | null })[] = [];
    const rejectedIssueKeys = new Set<string>();

    for (const issue of issues) {
      const rejections = findQaRejections(issue, qaStatusSet, devStatusSet);
      for (const r of rejections) {
        rejectedIssueKeys.add(r.issueKey);
        const sprint = findSprintForDate(r.transitionedAt, sprints);
        allRejections.push({ ...r, sprintName: sprint?.name ?? null });
      }
    }

    const qaEntries = countQaEntries(issues, qaStatusSet);
    const totalIssuesThatEnteredQa = qaEntries.size;
    const totalIssuesRejected = rejectedIssueKeys.size;
    const totalRejectedReversions = allRejections.length;
    const overallRejectionRate =
      totalIssuesThatEnteredQa > 0
        ? Math.round((totalIssuesRejected / totalIssuesThatEnteredQa) * 1000) / 10
        : 0;

    // --- Bug detection (new) ---
    const linkedBugs = extractLinkedBugs(issues, rejectedIssueKeys);
    const linkedBugKeys = new Set(linkedBugs.map((b) => b.bugKey));
    const totalStandaloneBugs = countStandaloneBugs(issues, linkedBugKeys);
    const totalLinkedBugs = linkedBugs.length;

    const totalIssuesWithQaImpact = new Set(rejectedIssueKeys);
    // Stories that didn't get rejected but have linked bugs
    for (const bug of linkedBugs) {
      totalIssuesWithQaImpact.add(bug.parentStoryKey);
    }

    const overallBugRate =
      totalIssuesThatEnteredQa > 0
        ? Math.round((totalLinkedBugs / totalIssuesThatEnteredQa) * 1000) / 10
        : 0;
    const overallQaImpactRate =
      totalIssuesThatEnteredQa > 0
        ? Math.round((totalIssuesWithQaImpact.size / totalIssuesThatEnteredQa) * 1000) / 10
        : 0;

    // --- Sprint grouping with bugs ---
    const sprintMap = new Map<
      string,
      { rejectedCount: number; totalEnteredQa: number; bugsCount: number }
    >();

    for (const issue of issues) {
      const histories = issue.changelog?.histories ?? [];
      for (const h of histories) {
        for (const item of h.items) {
          if (item.field !== "status") continue;
          const to = item.toString?.trim() ?? "";
          if (to && qaStatusSet.has(to.toLowerCase())) {
            const sprint = findSprintForDate(new Date(h.created), sprints);
            const name = sprint?.name ?? "Unknown";
            if (!sprintMap.has(name)) {
              sprintMap.set(name, { rejectedCount: 0, totalEnteredQa: 0, bugsCount: 0 });
            }
            sprintMap.get(name)!.totalEnteredQa++;
          }
        }
      }
    }

    for (const r of allRejections) {
      const name = r.sprintName ?? "Unknown";
      if (!sprintMap.has(name)) {
        sprintMap.set(name, { rejectedCount: 0, totalEnteredQa: 0, bugsCount: 0 });
      }
      sprintMap.get(name)!.rejectedCount++;
    }

    // Count bugs per sprint (by parent story's sprint)
    for (const bug of linkedBugs) {
      const parentIssue = issues.find((i) => i.key === bug.parentStoryKey);
      if (!parentIssue) continue;
      // Find which sprint the parent was in when the bug was created
      const bugDate = new Date(bug.bugCreated);
      const sprint = findSprintForDate(bugDate, sprints);
      const name = sprint?.name ?? "Unknown";
      if (!sprintMap.has(name)) {
        sprintMap.set(name, { rejectedCount: 0, totalEnteredQa: 0, bugsCount: 0 });
      }
      sprintMap.get(name)!.bugsCount++;
    }

    const bySprint = Array.from(sprintMap.entries())
      .map(([sprintName, { rejectedCount, totalEnteredQa, bugsCount }]) => ({
        sprintName,
        rejectedCount,
        totalEnteredQa,
        rate:
          totalEnteredQa > 0
            ? Math.round((rejectedCount / totalEnteredQa) * 1000) / 10
            : 0,
        bugsCount,
        bugRate:
          totalEnteredQa > 0
            ? Math.round((bugsCount / totalEnteredQa) * 1000) / 10
            : 0,
        qaImpactRate:
          totalEnteredQa > 0
            ? Math.round(
                ((rejectedCount + bugsCount) / totalEnteredQa) * 1000
              ) / 10
            : 0,
      }))
      .sort((a, b) => a.sprintName.localeCompare(b.sprintName));

    const qaNames = await getQaStatuses();
    const devNames = await getDevReturnStatuses(projectId);

    res.json({
      projectId,
      period,
      qaStatuses: qaNames,
      devReturnStatuses: devNames,
      totalRejectedReversions,
      totalIssuesRejected,
      totalIssuesThatEnteredQa,
      overallRejectionRate,
      totalLinkedBugs,
      totalStandaloneBugs,
      overallBugRate,
      overallQaImpactRate,
      bySprint,
      rejectedIssues: allRejections.map((r) => ({
        key: r.issueKey,
        summary: r.issueSummary,
        issueType: r.issueType,
        fromStatus: r.fromStatus,
        toStatus: r.toStatus,
        transitionedAt: r.transitionedAt.toISOString(),
        sprintName: r.sprintName,
      })),
      linkedBugs,
    });
  }
);

// Local helper to count standalone bugs (non-linked Bug issues)
function countStandaloneBugs(
  issues: JiraIssue[],
  linkedBugKeys: Set<string>
): number {
  return issues.filter(
    (i) => isBugIssue(i) && !linkedBugKeys.has(i.key)
  ).length;
}

export default router;
