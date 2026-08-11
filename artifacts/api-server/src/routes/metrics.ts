import { Router, type IRouter } from "express";
import {
  getJiraIssuesForProject,
  getOpenIssuesForProject,
  getProjectBoardType,
  listJiraProjects,
  periodToDays,
  isIssueDone,
  isIssueInProgress,
  isIssueCurrentlyBlocked,
  isBlockedEligibleIssueType,
  getStoryPoints,
  getLeadTimeDays,
  getCycleTimeDays,
  getResolutionDate,
  getJiraSprints,
  resolveSprintWindowDays,
  resolvePeriodDays,
  buildSprintVelocityBuckets,
  getEffectiveIssueType,
  mapIssueType,
  type JiraIssue,
  type JiraSprint,
  type ProjectBoardType,
} from "../lib/jira";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { filterVisibleProjects, isProjectKeyVisible } from "../lib/project-visibility";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { db, portfolioCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const VALID_PERIODS = ["1m", "3m"] as const;
type Period = (typeof VALID_PERIODS)[number];

// "<N>s" = últimos N sprints CERRADOS (solo válido para proyectos Scrum; ver
// resolveSprintWindowDays). Solo se soportan los dos valores publicados en el
// contrato OpenAPI (lib/api-spec/openapi.yaml): "2s", "6s".
const SPRINT_WINDOW_RE = /^(2|6)s$/;

function isValidPeriod(p: string): p is Period {
  return (VALID_PERIODS as readonly string[]).includes(p);
}

// Only the /projects/:projectId/metrics/:period route understands "Ns" sprint-window
// tokens (via sprintWindowCount/resolveSprintWindowDays below) — the other routes in
// this file (members, team/in-progress, issues) call periodToDays(period) directly,
// which has no "Ns" case and would silently fall to its 90-day default. Keep them on
// the strict isValidPeriod so a token like "2s" still 400s there.
function isValidMetricsPeriod(p: string): boolean {
  return isValidPeriod(p) || SPRINT_WINDOW_RE.test(p);
}

function parseSprintWindowToken(p: string): number | null {
  const match = SPRINT_WINDOW_RE.exec(p);
  return match ? Number(match[1]) : null;
}

function getStartDate(periodDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - periodDays);
  return d;
}

function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function computePercentiles(
  sorted: number[]
): { p50: number; p75: number; p85: number; p95: number } {
  if (sorted.length === 0) return { p50: 0, p75: 0, p85: 0, p95: 0 };
  const p = (k: number) => {
    const idx = k * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return Math.round(sorted[lo] * 1000) / 1000;
    return Math.round((sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo)) * 1000) / 1000;
  };
  return { p50: p(0.5), p75: p(0.75), p85: p(0.85), p95: p(0.95) };
}

async function computeMetrics(
  issues: JiraIssue[],
  period: string,
  periodDays: number,
  projectId: string,
  boardType: ProjectBoardType,
  sprints: JiraSprint[],
  allowedIssueTypes: string[],
  sprintWindowSprints: JiraSprint[] | null
) {
  const startDate = getStartDate(periodDays);

  const filteredIssues = issues.filter((issue) =>
    allowedIssueTypes.includes(getEffectiveIssueType(issue))
  );

  const resolvedWithDates = await Promise.all(
    filteredIssues
      .filter((i) => isIssueDone(i))
      .map(async (i) => ({
        issue: i,
        resolvedAt: await getResolutionDate(i),
      }))
  );
  const resolved = resolvedWithDates
    .filter((r) => r.resolvedAt && r.resolvedAt >= startDate)
    .map((r) => r.issue);

  const storyPointsTotal = resolved.reduce(
    (sum, i) => sum + getStoryPoints(i),
    0
  );

  const isScrum = boardType === "scrum";

  // Velocity based on real sprints completed in period, fall back to estimate
  const completedSprints = sprints.filter((s) => {
    if (!s.completeDate) return false;
    return new Date(s.completeDate) >= startDate;
  });
  const sprintCount = Math.max(1, sprintWindowSprints !== null
    ? sprintWindowSprints.length
    : completedSprints.length > 0
      ? completedSprints.length
      : Math.ceil(periodDays / 14)
  );
  const velocity = isScrum
    ? Math.round((storyPointsTotal / sprintCount) * 10) / 10
    : null;

  // Lead time: created -> resolved. Cycle time: first in-progress -> resolved.
  const leadTimes = (
    await Promise.all(resolved.map((i) => getLeadTimeDays(i)))
  ).filter((v): v is number => v !== null);
  const cycleTimes = (
    await Promise.all(resolved.map((i) => getCycleTimeDays(i)))
  ).filter((v): v is number => v !== null);

  const avg = (arr: number[]) =>
    arr.length > 0
      ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1000) / 1000
      : 0;

  const avgLeadTime = avg(leadTimes);
  const avgCycleTime = avg(cycleTimes);

  const sortedLT = [...leadTimes].sort((a, b) => a - b);
  const sortedCT = [...cycleTimes].sort((a, b) => a - b);
  const cycleTimePercentiles = computePercentiles(sortedCT);
  const leadTimePercentiles = computePercentiles(sortedLT);

  const weeks = Math.max(1, Math.ceil(periodDays / 7));
  const throughput = resolved.length;
  const totalResolved = resolved.length;

  const resolvedMap = new Map<string, Date>(
    resolvedWithDates
      .filter((r) => r.resolvedAt && r.resolvedAt >= startDate)
      .map((r) => [r.issue.id, r.resolvedAt!])
  );

  const velocityByWeek = sprintWindowSprints !== null
    ? buildSprintVelocityBuckets(resolved, resolvedMap, sprintWindowSprints)
    : buildWeeklyVelocity(resolved, resolvedMap, periodDays, isScrum);

  // Trend: compare first half vs second half of the period
  const halfDays = Math.max(1, Math.floor(periodDays / 2));
  const midDate = getStartDate(halfDays);

  const secondHalfSp = resolved
    .filter((i) => {
      const d = resolvedMap.get(i.id);
      return d && d >= midDate;
    })
    .reduce((s, i) => s + getStoryPoints(i), 0);
  const firstHalfSp = resolved
    .filter((i) => {
      const d = resolvedMap.get(i.id);
      return d && d >= startDate && d < midDate;
    })
    .reduce((s, i) => s + getStoryPoints(i), 0);
  const secondHalfCount = resolved.filter((i) => {
    const d = resolvedMap.get(i.id);
    return d && d >= midDate;
  }).length;
  const firstHalfCount = resolved.filter((i) => {
    const d = resolvedMap.get(i.id);
    return d && d >= startDate && d < midDate;
  }).length;

  const velocityTrend = isScrum
    ? calculateTrend(secondHalfSp, firstHalfSp)
    : calculateTrend(secondHalfCount, firstHalfCount);
  const throughputTrend = calculateTrend(secondHalfCount, firstHalfCount);

  const cycleTimeDistribution = await buildCycleTimeDistribution(resolved);

  return {
    projectId,
    period,
    boardType,
    isScrum,
    velocity,
    cycleTime: avgCycleTime,
    leadTime: avgLeadTime,
    throughput,
    resolvedCount: totalResolved,
    velocityTrend,
    throughputTrend,
    velocityByWeek,
    cycleTimeDistribution,
    cycleTimePercentiles,
    leadTimePercentiles,
  };
}

function buildWeeklyVelocity(
  resolved: JiraIssue[],
  resolvedMap: Map<string, Date>,
  periodDays: number,
  isScrum: boolean
): { label: string; value: number }[] {
  const weeks = Math.min(Math.ceil(periodDays / 7), 24);
  const now = new Date();
  const result: { label: string; value: number }[] = [];

  for (let w = weeks - 1; w >= 0; w--) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - w * 7);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 7);

    const weekIssues = resolved.filter((i) => {
      const d = resolvedMap.get(i.id);
      return d && d >= weekStart && d < weekEnd;
    });

    const sp = isScrum
      ? weekIssues.reduce((sum, i) => sum + getStoryPoints(i), 0)
      : weekIssues.length;

    const label = weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    result.push({ label, value: sp });
  }

  return result;
}

async function buildCycleTimeDistribution(
  issues: JiraIssue[]
): Promise<{ range: string; count: number }[]> {
  const buckets = [
    { range: "0-1d", min: 0, max: 1 },
    { range: "1-3d", min: 1, max: 3 },
    { range: "3-7d", min: 3, max: 7 },
    { range: "7-14d", min: 7, max: 14 },
    { range: "14d+", min: 14, max: Infinity },
  ];

  const days = await Promise.all(issues.map((i) => getCycleTimeDays(i)));

  return buckets.map(({ range, min, max }) => ({
    range,
    count: days.filter((d): d is number => d !== null && d >= min && d < max).length,
  }));
}

router.get(
  "/projects/:projectId/metrics/:period",
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

    if (!isValidMetricsPeriod(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m, 3m, or Ns (e.g. 2s, 6s) for Scrum projects." });
      return;
    }

    const [allProjects, boardType, sprints, portfolioRows, allowedIssueTypes] = await Promise.all([
      listJiraProjects(),
      getProjectBoardType(projectId),
      getJiraSprints(projectId),
      db.select().from(portfolioCacheTable),
      getPortfolioAllowedIssueTypes(),
    ]);

    const requestedSprintWindowCount = parseSprintWindowToken(period);
    if (requestedSprintWindowCount !== null && boardType !== "scrum") {
      res.status(400).json({
        error: "Sprint-window periods (2s/6s) are only valid for Scrum projects.",
      });
      return;
    }

    const sprintWindowCount = boardType === "scrum" ? requestedSprintWindowCount : null;
    const sprintWindow = sprintWindowCount !== null
      ? resolveSprintWindowDays(sprints, sprintWindowCount)
      : null;
    const periodDays = sprintWindow?.days ?? periodToDays(period);

    const issues = await getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true });

    let project = allProjects.find(
      (p) => p.id === projectId || p.key === projectId
    );

    // Fallback to portfolio cache if project not found in Jira
    if (!project) {
      const portfolioRow = portfolioRows.find(
        (r) => r.projectId === projectId || r.projectKey === projectId
      );
      if (!portfolioRow) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      project = {
        id: portfolioRow.projectId,
        key: portfolioRow.projectKey,
        name: portfolioRow.projectName,
        description: undefined,
        projectTypeKey: "software",
        avatarUrls: { "48x48": "" },
        lead: { displayName: "" },
        self: "",
      };

      // If no issues from Jira, return estimated metrics from portfolio cache
      if (issues.length === 0 && portfolioRow) {
        const throughput = portfolioRow.doneCount > 0 ? Math.ceil(portfolioRow.doneCount / 4) : 0; // Estimate for 1 week
        
        res.json({
          leadTime: 5, // Default estimate
          cycleTime: 3, // Default estimate
          throughput: throughput,
          velocity: 0,
          percentiles: {
            leadTime: { p50: 5, p75: 7, p85: 10, p95: 15 },
            cycleTime: { p50: 3, p75: 5, p85: 7, p95: 12 },
          },
          trend: { value: 0 },
          velocityByWeek: [],
        });
        return;
      }
    }

    const unique = Array.from(new Map(issues.map((i) => [i.key, i])).values());
    const metrics = await computeMetrics(unique, period, periodDays, projectId, boardType, sprints, allowedIssueTypes, sprintWindow?.sprintsIncluded ?? null);

    res.json(metrics);
  }
);

router.get(
  "/projects/:projectId/members/:period",
  requireAuth,
  requireSectionView("team", "report"),
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period)
      ? req.params.period[0]
      : req.params.period;

    const projectId = rawId ?? "";
    const period = rawPeriod ?? "1m";

    if (!isValidMetricsPeriod(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m, 3m, or Ns (e.g. 2s, 6s) for Scrum projects." });
      return;
    }

    const boardType = await getProjectBoardType(projectId);
    const resolvedWindow = await resolvePeriodDays(projectId, period, boardType);
    if ("error" in resolvedWindow) {
      res.status(400).json({ error: resolvedWindow.error });
      return;
    }
    const { periodDays } = resolvedWindow;

    const [allProjects, issues, openIssues, allowedIssueTypes, portfolioRows] = await Promise.all([
      listJiraProjects(),
      // includeChangelog is required for getCycleTimeDays() below to find the actual
      // first-in-progress transition — without it, every issue silently falls back to lead time.
      getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true }),
      // Unbounded by period — an issue opened before the period window but still open/blocked
      // today must still count against its assignee's current WIP.
      getOpenIssuesForProject(projectId),
      getPortfolioAllowedIssueTypes(),
      db.select().from(portfolioCacheTable),
    ]);

    let project = allProjects.find(
      (p) => p.id === projectId || p.key === projectId
    );

    // Fallback to portfolio cache if project not found in Jira
    if (!project) {
      const portfolioRow = portfolioRows.find(
        (r) => r.projectId === projectId || r.projectKey === projectId
      );
      if (!portfolioRow) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      project = {
        id: portfolioRow.projectId,
        key: portfolioRow.projectKey,
        name: portfolioRow.projectName,
        description: undefined,
        projectTypeKey: "software",
        avatarUrls: { "48x48": "" },
        lead: { displayName: "" },
        self: "",
      };
    }

        const visible = await isProjectKeyVisible(project!.key);
    if (!visible) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // If there's truly nothing to show (no period activity and nothing currently open), bail out.
    if (issues.length === 0 && openIssues.length === 0) {
      res.json([]);
      return;
    }

    const filtered = issues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
    const openFiltered = openIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
    const startDate = getStartDate(periodDays);

    const memberMap = new Map<
      string,
      {
        accountId: string;
        displayName: string;
        avatarUrl: string | null;
        resolved: number;
        resolvedWithPoints: number;
        storyPoints: number;
        cycleTimes: number[];
        leadTimes: number[];
        inProgress: number;
        blocked: number;
      }
    >();

    const getOrCreateMember = (assignee: { accountId: string; displayName: string; avatarUrls?: Record<string, string> }) => {
      if (!memberMap.has(assignee.accountId)) {
        memberMap.set(assignee.accountId, {
          accountId: assignee.accountId,
          displayName: assignee.displayName,
          avatarUrl: assignee.avatarUrls?.["48x48"] ?? null,
          resolved: 0,
          resolvedWithPoints: 0,
          storyPoints: 0,
          cycleTimes: [],
          leadTimes: [],
          inProgress: 0,
          blocked: 0,
        });
      }
      return memberMap.get(assignee.accountId)!;
    };

    // --- Work completed in this period: resolved count, story points, cycle/lead time ---
    for (const issue of filtered) {
      const assignee = issue.fields.assignee;
      if (!assignee) continue;

      const resolvedAt = await getResolutionDate(issue);
      if (!isIssueDone(issue) || !resolvedAt || resolvedAt < startDate) continue;

      const member = getOrCreateMember(assignee);
      member.resolved++;
      const points = getStoryPoints(issue);
      member.storyPoints += points;
      if (points > 0) member.resolvedWithPoints++;

      const [cycleTime, leadTime] = await Promise.all([getCycleTimeDays(issue), getLeadTimeDays(issue)]);
      if (cycleTime !== null) member.cycleTimes.push(cycleTime);
      if (leadTime !== null) member.leadTimes.push(leadTime);
    }

    // --- Current state, unbounded by period: WIP and active blocks ---
    for (const issue of openFiltered) {
      const assignee = issue.fields.assignee;
      if (!assignee) continue;

      const member = getOrCreateMember(assignee);
      if (isIssueInProgress(issue)) member.inProgress++;
      if (isBlockedEligibleIssueType(issue) && isIssueCurrentlyBlocked(issue)) member.blocked++;
    }

    const avg = (values: number[]) =>
      values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0;

    const members = Array.from(memberMap.values()).map((m) => ({
      accountId: m.accountId,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
      issuesResolved: m.resolved,
      issuesResolvedWithPoints: m.resolvedWithPoints,
      storyPoints: Math.round(m.storyPoints * 10) / 10,
      avgCycleTime: avg(m.cycleTimes),
      avgLeadTime: avg(m.leadTimes),
      issuesInProgress: m.inProgress,
      issuesBlocked: m.blocked,
    }));

    // Whoever needs attention first: blocked work, then a heavy WIP load, then who's shipped most.
    members.sort((a, b) =>
      b.issuesBlocked - a.issuesBlocked
      || b.issuesInProgress - a.issuesInProgress
      || b.issuesResolved - a.issuesResolved
    );

    res.json(members);
  }
);

router.get(
  "/team/in-progress/:period",
  requireAuth,
  requireSectionView("team"),
  async (req, res): Promise<void> => {
    const rawPeriod = Array.isArray(req.params.period)
      ? req.params.period[0]
      : req.params.period;
    const period = rawPeriod ?? "1m";

    if (!isValidPeriod(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m or 3m." });
      return;
    }

    const days = periodToDays(period);
    const visibleProjects = await filterVisibleProjects(await listJiraProjects());
    const allowedIssueTypes = await getPortfolioAllowedIssueTypes();

    const perProject = await Promise.all(
      visibleProjects.map(async (project) => {
        const issues = await getJiraIssuesForProject(project.id, days);
        const unique = Array.from(new Map(issues.map((i) => [i.key, i])).values());
        const filtered = unique.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
        return {
          project,
          inProgressIssues: filtered.filter((issue) => isIssueInProgress(issue)),
        };
      })
    );

    const items = perProject
      .flatMap(({ project, inProgressIssues }) =>
        inProgressIssues.map((issue) => ({
          projectId: project.id,
          projectKey: project.key,
          projectName: project.name,
          issueId: issue.id,
          issueKey: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status.name,
          assignee: issue.fields.assignee?.displayName ?? null,
          priority: issue.fields.priority.name,
          createdAt: issue.fields.created,
          updatedAt: issue.fields.updated,
        }))
      )
      .sort((left, right) => {
        const byProject = left.projectName.localeCompare(right.projectName);
        if (byProject !== 0) return byProject;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });

    res.json(items);
  }
);

router.get(
  "/projects/:projectId/issues/:period",
  requireAuth,
  requireSectionView("team"),
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period)
      ? req.params.period[0]
      : req.params.period;

    const projectId = rawId ?? "";
    const period = rawPeriod ?? "1m";

    if (!isValidMetricsPeriod(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m, 3m, or Ns (e.g. 2s, 6s) for Scrum projects." });
      return;
    }

    const boardType = await getProjectBoardType(projectId);
    const resolvedWindow = await resolvePeriodDays(projectId, period, boardType);
    if ("error" in resolvedWindow) {
      res.status(400).json({ error: resolvedWindow.error });
      return;
    }

    const [issues, openIssues, allowedIssueTypes] = await Promise.all([
      // includeChangelog: required for getCycleTimeDays() to find the real first-in-progress
      // transition — without it this silently degrades to lead time for every issue.
      getJiraIssuesForProject(projectId, resolvedWindow.periodDays, { includeChangelog: true }),
      // Merged in below so "currently open" issues older than the period window still show up —
      // otherwise a ticket opened 60 days ago and still in progress silently vanishes from a 1M view.
      getOpenIssuesForProject(projectId),
      getPortfolioAllowedIssueTypes(),
    ]);
    const combined = Array.from(new Map([...issues, ...openIssues].map((i) => [i.id, i])).values());
    const filtered = combined.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));

    const mapped = await Promise.all(
      filtered.map(async (i) => {
        const resolvedAt = await getResolutionDate(i);
        const rawCycleTime = await getCycleTimeDays(i);
        const cycleTimeDays = rawCycleTime !== null ? Math.round(rawCycleTime * 10) / 10 : null;

        return {
          id: i.id,
          key: i.key,
          summary: i.fields.summary,
          status: i.fields.status.name,
          issueType: i.fields.issuetype.name,
          priority: i.fields.priority.name,
          assignee: i.fields.assignee?.displayName ?? null,
          assigneeAccountId: i.fields.assignee?.accountId ?? null,
          isInProgress: isIssueInProgress(i),
          storyPoints: getStoryPoints(i) || null,
          createdAt: i.fields.created,
          resolvedAt: resolvedAt?.toISOString() ?? null,
          cycleTimeDays,
        };
      })
    );

    res.json(mapped);
  }
);

router.get(
  "/projects/:projectId/issues/:period/csv",
  requireAuth,
  requireSectionView("team"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : req.params.projectId;
    const period = Array.isArray(req.params.period)
      ? req.params.period[0]
      : req.params.period;

    const [issues, allowedIssueTypes] = await Promise.all([
      // includeChangelog: required for getCycleTimeDays() below to find the real first-in-progress
      // transition — without it this silently degrades to lead time for every issue.
      getJiraIssuesForProject(projectId!, periodToDays(period ?? "1m"), { includeChangelog: true }),
      getPortfolioAllowedIssueTypes(),
    ]);
    const filtered = issues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));

    const rows = await Promise.all(
      filtered.map(async (i) => {
        const resolvedAt = await getResolutionDate(i);
        const rawCycleTime = await getCycleTimeDays(i);
        const cycleTimeDays = rawCycleTime !== null ? Math.round(rawCycleTime * 10) / 10 : null;
        return {
          key: i.key,
          summary: i.fields.summary,
          status: i.fields.status.name,
          issueType: i.fields.issuetype.name,
          priority: i.fields.priority.name,
          assignee: i.fields.assignee?.displayName ?? "",
          storyPoints: getStoryPoints(i) || "",
          createdAt: i.fields.created,
          resolvedAt: resolvedAt?.toISOString() ?? "",
          cycleTimeDays: cycleTimeDays ?? "",
        };
      })
    );

    const header = "key,summary,status,issueType,priority,assignee,storyPoints,createdAt,resolvedAt,cycleTimeDays";
    const csv = rows
      .map((r) =>
        [r.key, `"${r.summary.replace(/"/g, '""')}"`, r.status, r.issueType, r.priority, r.assignee, r.storyPoints, r.createdAt, r.resolvedAt, r.cycleTimeDays].join(",")
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${projectId}-issues-${period}.csv"`);
    res.send(`${header}\n${csv}`);
  }
);

export default router;
