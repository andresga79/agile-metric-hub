import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { clearCache, getCacheTimestamp, issuesCacheKey } from "../lib/jira-cache";
import {
  getJiraIssuesForProject,
  getResolvedJiraIssuesInRange,
  getFlaggedJiraIssuesForProject,
  getOpenIssuesForProject,
  getEffectiveIssueType,
  getProjectBoardType,
  isValidPeriodOrSprintWindow,
  resolvePeriodDays,
  isIssueDone,
  isIssueInProgress,
  getResolutionDate,
  getCycleTimeDays,
  getLeadTimeDays,
  getStoryPoints,
  getStatusCategoryMap,
  isBlockedStatus,
  isIssueCurrentlyFlagged,
  isBlockedEligibleIssueType,
  getIssueComments,
  adfToPlainText,
  getBoardStatusNames,
  type JiraIssue,
} from "../lib/jira";
import { logger } from "../lib/logger";
import { getPortfolioAllowedIssueTypes } from "../lib/portfolio-metric-settings";
import { getEffectiveThresholds, type EffectiveThreshold } from "../lib/health-thresholds";
import { detectStructuralBottleneck } from "../lib/report-insights";
import { db, blockedReasonsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

const router: IRouter = Router();

function getStartDate(periodDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - periodDays);
  return d;
}

// isBlockedStatus / isIssueCurrentlyFlagged / isBlockedEligibleIssueType now live in lib/jira.ts
// (shared with metrics.ts's per-member blocked count). isBlockedFlagValue stays local — it's used
// directly here to inspect a changelog transition's raw value, not just the issue's current state.
function isBlockedFlagValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return /block|impediment|bloqueado|obstáculo/i.test(value.trim());
}

function isFlaggedTransition(item: { field: string; fieldId?: string }): boolean {
  const fieldName = item.field.trim().toLowerCase();
  const fieldId = item.fieldId?.trim().toLowerCase() ?? "";
  return fieldId === "customfield_10021" || fieldName === "flagged" || fieldName === "marca";
}

// Some Jira automations post a boilerplate comment when the Flagged field changes
// (e.g. "Marca añadida", "Flag added") instead of an actual explanation - matching
// this exact noise lets a real one- or two-word comment through unfiltered.
const GENERIC_FLAG_COMMENT_RE = /^(marca (a[ñn]adida|quitada|removida)|flag (added|removed))\.?$/i;
function isGenericFlagComment(text: string): boolean {
  return GENERIC_FLAG_COMMENT_RE.test(text.trim());
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const year = d.getFullYear();
  const week = Math.floor((d.getTime() - new Date(year, 0, 4).getTime()) / 604800000) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Admin -> Health configures wipAging as a (goodValue, warningValue) pair (defaults 3d / 14d).
// The "watch"/"warning" split below the two admin cutoffs is derived as their midpoint so the
// existing 3-tier UI (project-flow.tsx, flow-health-card.tsx) keeps working without a 3rd
// admin-configurable number.
function getAlertLevel(days: number | null, threshold: EffectiveThreshold | undefined): "critical" | "warning" | "watch" | null {
  if (days === null) return null;
  const good = threshold?.goodValue ?? 3;
  const warning = threshold?.warningValue ?? 14;
  const midpoint = (good + warning) / 2;
  if (days >= warning) return "critical";
  if (days >= midpoint) return "warning";
  if (days >= good) return "watch";
  return null;
}

interface TimeInStatusEntry {
  status: string;
  category: string;
  totalDays: number;
  avgDays: number;
  medianDays: number;
  issueCount: number;
}

async function computeTimeInStatus(
  issues: JiraIssue[],
  allowedStatuses?: Map<string, string> | null,
): Promise<TimeInStatusEntry[]> {
  const categoryMap = await getStatusCategoryMap();
  const statusMap = new Map<string, Map<string, number>>();

  function addTime(rawStatus: string, issueKey: string, days: number) {
    if (days <= 0) return;
    const key = rawStatus.trim().toLowerCase();
    if (allowedStatuses && !allowedStatuses.has(key)) return;
    // Resolve to the status's current canonical spelling so a mid-project rename (a changelog
    // entry recorded under the old name) merges into the same row as the current name, instead
    // of splitting one board column's time across two near-duplicate entries.
    const status = allowedStatuses?.get(key) ?? rawStatus.trim();
    let issueMap = statusMap.get(status);
    if (!issueMap) {
      issueMap = new Map();
      statusMap.set(status, issueMap);
    }
    issueMap.set(issueKey, (issueMap.get(issueKey) ?? 0) + days);
  }

  for (const issue of issues) {
    const histories = issue.changelog?.histories ?? [];
    const created = new Date(issue.fields.created).getTime();
    const endTime = isIssueDone(issue)
      ? (await getResolutionDate(issue))?.getTime() ?? Date.now()
      : Date.now();

    if (histories.length === 0) {
      addTime(issue.fields.status.name, issue.key, (endTime - created) / (1000 * 60 * 60 * 24));
      continue;
    }

    const transitions = histories
      .filter((h) => h.items.some((it) => it.field === "status"))
      .map((h) => ({
        at: new Date(h.created),
        from: h.items.find((it) => it.field === "status")?.fromString ?? "",
        to: h.items.find((it) => it.field === "status")?.toString ?? "",
      }))
      .filter((t) => t.from || t.to)
      .sort((a, b) => a.at.getTime() - b.at.getTime());

    if (transitions.length === 0) {
      addTime(issue.fields.status.name, issue.key, (endTime - created) / (1000 * 60 * 60 * 24));
      continue;
    }

    let prevTime = created;

    for (const t of transitions) {
      if (t.from) {
        addTime(t.from, issue.key, (t.at.getTime() - prevTime) / (1000 * 60 * 60 * 24));
      }
      prevTime = t.at.getTime();
    }

    const lastTo = transitions[transitions.length - 1]!.to || issue.fields.status.name;
    addTime(lastTo, issue.key, (endTime - prevTime) / (1000 * 60 * 60 * 24));
  }

  const entries: TimeInStatusEntry[] = [];
  for (const [status, issueMap] of statusMap) {
    const dayValues = Array.from(issueMap.values());
    if (dayValues.length === 0) continue;
    const total = dayValues.reduce((a, b) => a + b, 0);
    const sorted = [...dayValues].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
        : sorted[Math.floor(sorted.length / 2)]!;
    entries.push({
      status,
      category: categoryMap.get(status.trim().toLowerCase()) ?? "other",
      totalDays: Math.round(total * 10) / 10,
      avgDays: Math.round((total / dayValues.length) * 10) / 10,
      medianDays: Math.round(median * 10) / 10,
      issueCount: dayValues.length,
    });
  }

  return entries.sort((a, b) => b.avgDays - a.avgDays);
}

export async function computePeriodMetrics(
  issues: JiraIssue[],
  startDate: Date,
  // Upper bound for "resolved in this period." The current-period caller omits this — an issue
  // can't resolve in the future, so resolvedAt >= startDate is already a complete bound. The
  // previous-period caller MUST pass its own end (= current period's startDate), or an issue
  // resolved anytime between then and now — including this very week — counts as "previous
  // period" activity too, overlapping with the current period it's being compared against.
  endDate?: Date,
): Promise<{
  flowEfficiency: number | null;
  avgCycleTime: number | null;
  avgLeadTime: number | null;
  issueTypeDistribution: { name: string; count: number; percentage: number }[];
  throughputByPriority: { priority: string; count: number }[];
  throughputOverTime: { week: string; count: number }[];
  leadTimeDistribution: { range: string; count: number }[];
}> {
  // --- Issue Type Distribution (#1) ---
  const typeCount = new Map<string, number>();
  for (const issue of issues) {
    const t = issue.fields.issuetype.name;
    typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
  }
  const totalIssues = issues.length;
  const issueTypeDistribution = Array.from(typeCount.entries())
    .map(([name, count]) => ({
      name,
      count,
      percentage: totalIssues > 0 ? Math.round((count / totalIssues) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // --- Throughput by Priority (#4) ---
  const resolvedWithDates = await Promise.all(
    issues.filter((i) => isIssueDone(i)).map(async (i) => ({
      issue: i,
      resolvedAt: await getResolutionDate(i),
    }))
  );
  const resolved = resolvedWithDates
    .filter((r) => r.resolvedAt && r.resolvedAt >= startDate && (!endDate || r.resolvedAt < endDate))
    .map((r) => r.issue);

  const priorityCount = new Map<string, number>();
  for (const issue of resolved) {
    const p = issue.fields.priority.name;
    priorityCount.set(p, (priorityCount.get(p) ?? 0) + 1);
  }
  const priorityOrder = ["Highest", "High", "Medium", "Low", "Lowest"];
  const throughputByPriority = Array.from(priorityCount.entries())
    .map(([priority, count]) => ({ priority, count }))
    .sort((a, b) => {
      const ai = priorityOrder.indexOf(a.priority);
      const bi = priorityOrder.indexOf(b.priority);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

  // --- Throughput Over Time / Run Chart (#8) ---
  const weekCount = new Map<string, number>();
  for (const r of resolvedWithDates) {
    if (!r.resolvedAt || r.resolvedAt < startDate || (endDate && r.resolvedAt >= endDate)) continue;
    const week = getISOWeek(r.resolvedAt);
    weekCount.set(week, (weekCount.get(week) ?? 0) + 1);
  }
  const throughputOverTime = Array.from(weekCount.entries())
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // --- Lead Time Distribution (#3) ---
  const leadTimes = (
    await Promise.all(resolved.map((i) => getLeadTimeDays(i)))
  ).filter((v): v is number => v !== null);

  const ltBuckets = [
    { range: "0-1d", min: 0, max: 1 },
    { range: "1-3d", min: 1, max: 3 },
    { range: "3-7d", min: 3, max: 7 },
    { range: "7-14d", min: 7, max: 14 },
    { range: "14-30d", min: 14, max: 30 },
    { range: "30d+", min: 30, max: Infinity },
  ];
  const leadTimeDistribution = ltBuckets.map(({ range, min, max }) => ({
    range,
    count: leadTimes.filter((d) => d >= min && d < max).length,
  }));

  // --- Flow Efficiency (#5) ---
  const cycleTimes = (await Promise.all(resolved.map((i) => getCycleTimeDays(i)))).filter((v): v is number => v !== null);
  const avgCycleTime = cycleTimes.length > 0 ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : null;
  const avgLeadTime = leadTimes.length > 0 ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;
  const flowEfficiency = avgCycleTime !== null && avgLeadTime !== null && avgLeadTime > 0
    ? Math.round((avgCycleTime / avgLeadTime) * 100)
    : null;

  return { flowEfficiency, avgCycleTime, avgLeadTime, issueTypeDistribution, throughputByPriority, throughputOverTime, leadTimeDistribution };
}

router.get(
  "/projects/:projectId/analytics/:period",
  requireAuth,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawPeriod = Array.isArray(req.params.period) ? req.params.period[0] : req.params.period;
    const projectId = rawId ?? "";
    const period = rawPeriod ?? "1m";
    const compareTo = req.query.compareTo === "true";

    if (!isValidPeriodOrSprintWindow(period)) {
      res.status(400).json({ error: "Invalid period. Use 1m, 3m, or Ns (e.g. 2s, 6s) for Scrum projects." });
      return;
    }

    const boardType = await getProjectBoardType(projectId);
    const resolvedWindow = await resolvePeriodDays(projectId, period, boardType);
    if ("error" in resolvedWindow) {
      res.status(400).json({ error: resolvedWindow.error });
      return;
    }
    const { periodDays, windowStart, windowEnd } = resolvedWindow;
    // For a sprint-window period (2s/6s), bound to the sprints' exact dates instead of a rounded
    // periodDays-back calendar date with no upper bound (same bug already fixed in
    // routes/metrics.ts's /metrics/:period — see resolvePeriodDays' comment).
    const startDate = windowStart ?? getStartDate(periodDays);

    if (req.query.refresh === "true") {
      await clearCache(issuesCacheKey(projectId, periodDays));
      await clearCache(`${issuesCacheKey(projectId, periodDays)}:changelog`);
      await clearCache(issuesCacheKey(projectId, 90));
      await clearCache(`${issuesCacheKey(projectId, 90)}:changelog`);
      await clearCache(`issues:${projectId}:flagged`);
      await clearCache(`issues:${projectId}:flagged:changelog`);
    }

    const [issues, blockedScopeIssues, flaggedIssues, openIssues, allowedIssueTypes, effectiveThresholds] = await Promise.all([
      getJiraIssuesForProject(projectId, periodDays, { includeChangelog: true }).catch((err) => {
        logger.warn({ err, projectId }, "Failed to fetch Jira issues for analytics, returning empty");
        return [] as JiraIssue[];
      }),
      // Blocked analysis needs a wider horizon so currently blocked items
      // are still visible even if they were created before the selected period.
      getJiraIssuesForProject(projectId, 90, { includeChangelog: true }).catch((err) => {
        logger.warn({ err, projectId }, "Failed to fetch Jira issues for blocked analysis, returning empty");
        return [] as JiraIssue[];
      }),
      getFlaggedJiraIssuesForProject(projectId, { includeChangelog: true }).catch((err) => {
        logger.warn({ err, projectId }, "Failed to fetch flagged Jira issues for blocked analysis, returning empty");
        return [] as JiraIssue[];
      }),
      // Unbounded by period — feeds time-in-status below so an issue open longer than the
      // selected period (never touched "in period") still counts toward bottleneck analysis.
      getOpenIssuesForProject(projectId, { includeChangelog: true }).catch((err) => {
        logger.warn({ err, projectId }, "Failed to fetch open Jira issues for time-in-status, returning empty");
        return [] as JiraIssue[];
      }),
      getPortfolioAllowedIssueTypes(),
      getEffectiveThresholds(projectId),
    ]);
    const cacheTimestamp = await getCacheTimestamp(issuesCacheKey(projectId, periodDays));

    // Dedup issues by key — Jira API pagination can return the same issue on multiple pages
    const uniqueIssues = Array.from(new Map(issues.map((i) => [i.key, i])).values());
    const blockedSourceIssues = Array.from(
      new Map([...blockedScopeIssues, ...flaggedIssues].map((i) => [i.key, i])).values()
    );
    // Same period-scoped set, merged with every currently-open issue regardless of age — otherwise
    // time-in-status/bottleneck analysis silently drops any issue that's been open longer than the
    // selected period and wasn't resolved in it either.
    const timeInStatusIssues = Array.from(
      new Map([...uniqueIssues, ...openIssues].map((i) => [i.key, i])).values()
    );

    // Issue type filter only applies to portfolio-level comparison.
    // On the project detail page, ALL issue types are included for metrics.
    const metrics = await computePeriodMetrics(uniqueIssues, startDate, windowEnd ?? undefined);

    // --- WIP Aging Report (#2) ---
    // Use the wider 90-day fetch (same one blocked analysis uses), not the
    // period-scoped `uniqueIssues` - otherwise an issue created 45 days ago
    // and still open never matches "resolved in period" nor "created in
    // period" on the 1M view, and silently disappears from its own aging report.
    const uniqueBlockedScopeIssues = Array.from(
      new Map(blockedScopeIssues.map((i) => [i.key, i])).values()
    );
    const inProgressIssues = uniqueBlockedScopeIssues.filter((i) => isIssueInProgress(i));
    const wipAging = await Promise.all(
      inProgressIssues.map(async (i) => {
        const histories = i.changelog?.histories ?? [];
        let enteredInProgress: Date | null = null;

        if (histories.length > 0) {
          const categoryMap = await getStatusCategoryMap();
          const transitions = histories
            .filter((h) => h.items.some((it) => it.field === "status"))
            .map((h) => ({
              at: new Date(h.created),
              to: h.items.find((it) => it.field === "status")?.toString ?? "",
            }))
            .sort((a, b) => b.at.getTime() - a.at.getTime());

          for (const t of transitions) {
            const cat = categoryMap.get(t.to.trim().toLowerCase());
            if (cat === "indeterminate") {
              enteredInProgress = t.at;
              break;
            }
          }
        }

        const fallbackStart = new Date(i.fields.created);
        const effectiveStart = enteredInProgress ?? fallbackStart;
        const daysInProgress = Math.max(
          0,
          Math.round(((Date.now() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) * 10) / 10
        );

        return {
          id: i.id,
          key: i.key,
          summary: i.fields.summary,
          assignee: i.fields.assignee?.displayName ?? null,
          issueType: i.fields.issuetype.name,
          priority: i.fields.priority.name,
          daysInProgress,
          alertLevel: getAlertLevel(daysInProgress, effectiveThresholds.wipAging),
          enteredDate: enteredInProgress?.toISOString() ?? fallbackStart.toISOString(),
        };
      })
    );

    wipAging.sort((a, b) => (b.daysInProgress ?? 0) - (a.daysInProgress ?? 0));
    const wipAgingTotal = wipAging.length;
    const wipAgingTop = wipAging.slice(0, 10);
    // Computed over the FULL list, not wipAgingTop — otherwise "N critical" only counts among the
    // 10 oldest shown, silently hiding critical/warning items ranked 11+ from the tally itself
    // (not just from the visible table).
    const wipAgingCounts = {
      critical: wipAging.filter((i) => i.alertLevel === "critical").length,
      warning: wipAging.filter((i) => i.alertLevel === "warning").length,
      watch: wipAging.filter((i) => i.alertLevel === "watch").length,
    };

    // --- Blocked Time Analysis (#7) ---
    const blockedData = await Promise.all(
      blockedSourceIssues.map(async (i) => {
        if (!isBlockedEligibleIssueType(i)) {
          return {
            key: i.key,
            summary: i.fields.summary,
            assignee: i.fields.assignee?.displayName ?? null,
            issueType: i.fields.issuetype.name,
            priority: i.fields.priority.name,
            totalDays: 0,
            isCurrentlyBlocked: false,
            currentStatus: i.fields.status.name,
            blockReason: null as "status" | "flag" | "both" | null,
            lastFlagAppliedAt: null as number | null,
          };
        }

        const histories = i.changelog?.histories ?? [];
        const createdMs = new Date(i.fields.created).getTime();
        let totalBlockedMs = 0;
        let intervalStart: number | null = null;
        let blockedByStatus = false;
        let blockedByFlag = false;
        // Timestamp of the most recent transition that set the Flagged field to a
        // blocking value - used later to find the comment written alongside it (teams
        // often explain the impediment in a comment when they flag the issue).
        let lastFlagAppliedAt: number | null = null;

        const sortedHistories = [...histories]
          .filter((h) => h.items.some((it) => it.field === "status" || isFlaggedTransition(it)))
          .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

        for (const h of sortedHistories) {
          const transitionTime = new Date(h.created).getTime();
          const wasBlocked = blockedByStatus || blockedByFlag;

          const statusTransition = h.items.find((it) => it.field === "status");
          if (statusTransition?.toString) {
            blockedByStatus = isBlockedStatus(statusTransition.toString);
          }

          const flaggedTransition = h.items.find((it) => isFlaggedTransition(it));
          if (flaggedTransition) {
            const wasFlagged = blockedByFlag;
            blockedByFlag = isBlockedFlagValue(flaggedTransition.toString ?? null);
            if (!wasFlagged && blockedByFlag) {
              lastFlagAppliedAt = transitionTime;
            }
          }

          const isBlockedNow = blockedByStatus || blockedByFlag;
          if (!wasBlocked && isBlockedNow) {
            intervalStart = transitionTime;
          } else if (wasBlocked && !isBlockedNow && intervalStart !== null) {
            totalBlockedMs += transitionTime - intervalStart;
            intervalStart = null;
          }
        }

        // Done issues can't be "currently" blocked, even if the Flagged field or
        // status was never cleared before closing - otherwise a stale flag on an
        // old resolved issue accumulates blocked time forever (seen in practice:
        // 300+ days on an issue that finished long ago).
        const isDone = isIssueDone(i);
        const currentlyBlockedByStatus = !isDone && isBlockedStatus(i.fields.status.name);
        const currentlyBlockedByFlag = !isDone && isIssueCurrentlyFlagged(i);
        const isCurrentlyBlocked = currentlyBlockedByStatus || currentlyBlockedByFlag;

        // Same "no transition observed" edge case as intervalStart below: if it's
        // currently flagged but we never saw the flag-applied transition in the
        // fetched changelog window, fall back to creation time as the best guess.
        if (currentlyBlockedByFlag && lastFlagAppliedAt === null) {
          lastFlagAppliedAt = createdMs;
        }

        if (isCurrentlyBlocked && intervalStart === null) {
          // If the issue is currently blocked but we did not observe a transition
          // in the fetched history, approximate from creation time.
          intervalStart = createdMs;
        }

        if (isCurrentlyBlocked && intervalStart !== null) {
          totalBlockedMs += Date.now() - intervalStart;
        } else if (isDone && intervalStart !== null) {
          // Blocked/flagged when it closed but never explicitly unblocked - stop
          // the clock at resolution time instead of leaving the interval open.
          const resolvedAt = await getResolutionDate(i);
          if (resolvedAt) {
            totalBlockedMs += Math.max(0, resolvedAt.getTime() - intervalStart);
          }
        }

        const totalDays = Math.round((totalBlockedMs / (1000 * 60 * 60 * 24)) * 10) / 10;

        // Report what actually caused the (most recent) block: the status the
        // issue transitioned to, or Jira's Flagged field - useful to tell apart
        // teams that use a dedicated "Blocked" status from ones that just flag.
        const reasonByStatus = isCurrentlyBlocked ? currentlyBlockedByStatus : blockedByStatus;
        const reasonByFlag = isCurrentlyBlocked ? currentlyBlockedByFlag : blockedByFlag;
        const blockReason: "status" | "flag" | "both" | null =
          reasonByStatus && reasonByFlag ? "both" : reasonByStatus ? "status" : reasonByFlag ? "flag" : null;

        return {
          key: i.key,
          summary: i.fields.summary,
          assignee: i.fields.assignee?.displayName ?? null,
          issueType: i.fields.issuetype.name,
          priority: i.fields.priority.name,
          totalDays,
          isCurrentlyBlocked,
          lastFlagAppliedAt: reasonByFlag ? lastFlagAppliedAt : null,
          currentStatus: i.fields.status.name,
          blockReason,
        };
      })
    );

    const blockedIssuesRanked = blockedData
      .filter((b) => b.totalDays > 0 || b.isCurrentlyBlocked)
      .sort((a, b) => {
        if (a.isCurrentlyBlocked !== b.isCurrentlyBlocked) return a.isCurrentlyBlocked ? -1 : 1;
        return b.totalDays - a.totalDays;
      });

    // Jira's Flagged field carries no reason text of its own (it's just a binary
    // "Impediment" marker) - the actual explanation, when someone bothers to write
    // one, lives in a regular issue comment posted around the same time the flag was
    // applied. Only fetched for rows that are actually flag-blocked, and only for the
    // already-filtered/sorted rows shown in the table, to keep this to one extra Jira
    // call per visible flagged row instead of one per project issue.
    const FLAG_COMMENT_TOLERANCE_MS = 10 * 60 * 1000; // 10 minutes
    const flagBlockedKeys = blockedIssuesRanked
      .filter((b) => b.blockReason === "flag" || b.blockReason === "both")
      .map((b) => b.key);

    // Manual notes (added from the UI, see routes/blocked-reasons.ts) take priority
    // over an auto-detected Jira comment - if someone bothered to write a curated
    // note, prefer it over a heuristic guess at the nearest comment.
    const manualReasons =
      flagBlockedKeys.length > 0
        ? await db
            .select({ issueKey: blockedReasonsTable.issueKey, reason: blockedReasonsTable.reason })
            .from(blockedReasonsTable)
            .where(inArray(blockedReasonsTable.issueKey, flagBlockedKeys))
        : [];
    const manualReasonByKey = new Map(manualReasons.map((r) => [r.issueKey, r.reason]));

    const blockedIssues = await Promise.all(
      blockedIssuesRanked.map(async ({ lastFlagAppliedAt, ...b }) => {
        const isFlagBlocked = b.blockReason === "flag" || b.blockReason === "both";
        if (!isFlagBlocked) {
          return { ...b, flagReason: null as string | null, flagReasonEditable: false };
        }

        const manualReason = manualReasonByKey.get(b.key);
        if (manualReason) {
          return { ...b, flagReason: manualReason, flagReasonEditable: true };
        }

        if (lastFlagAppliedAt === null) {
          return { ...b, flagReason: null as string | null, flagReasonEditable: true };
        }

        const comments = await getIssueComments(b.key);
        let best: { text: string; diffMs: number } | null = null;
        for (const c of comments) {
          const createdMs = new Date(c.created).getTime();
          const diffMs = Math.abs(createdMs - lastFlagAppliedAt);
          if (diffMs > FLAG_COMMENT_TOLERANCE_MS) continue;
          if (best && diffMs >= best.diffMs) continue;
          const text = adfToPlainText(c.body);
          // Some teams' automation posts a boilerplate comment ("Marca añadida" /
          // "Flag added") alongside the flag change - it says nothing about WHY the
          // issue is blocked, so treat it the same as no comment at all.
          if (text && !isGenericFlagComment(text)) best = { text, diffMs };
        }

        return { ...b, flagReason: best?.text ?? null, flagReasonEditable: true };
      })
    );

    // --- Time in Status (#9) ---
    // Scope the breakdown to the project's board columns so statuses from other
    // workflows living in the same project (SOLVIX, UX/UI, etc.) don't pollute
    // the flow view. Falls back to all statuses when no board is available.
    const boardStatusNames = await getBoardStatusNames(projectId);
    const timeInStatus = await computeTimeInStatus(timeInStatusIssues, boardStatusNames);
    const structuralBottleneck = detectStructuralBottleneck(timeInStatus);

    // --- Period-over-Period (#3) ---
    let previousPeriod: any = null;
    if (compareTo) {
      const prevStartDate = new Date(startDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const prevEndDate = new Date(startDate.getTime());
      // Must use getResolvedJiraIssuesInRange, NOT getJiraIssuesForProject(periodDays * 2):
      // the latter is hard-capped at JIRA_MAX_LOOKBACK_DAYS (90), so for period "3m" (periodDays=90)
      // the requested 180 days silently collapses to 90, leaving the entire previous window
      // [180d, 90d) outside the fetched data and the comparison empty. This range fetch bypasses
      // that cap and returns exactly the issues resolved in [prevStartDate, prevEndDate). Changelog
      // is included so the previous period's cycle time / flow efficiency are real (they'd otherwise
      // degrade to lead time). computePeriodMetrics still does the precise resolved-in-window filter.
      const prevIssues = await getResolvedJiraIssuesInRange(projectId, periodDays * 2, periodDays, {
        includeChangelog: true,
      }).catch(() => [] as JiraIssue[]);
      const prevFiltered = prevIssues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)));
      if (prevFiltered.length > 0) {
        previousPeriod = await computePeriodMetrics(prevFiltered, prevStartDate, prevEndDate);
      }
    }

    res.json({
      projectId,
      period,
      compareTo,
      fetchedAt: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : null,
      ...metrics,
      wipAging: wipAgingTop,
      wipAgingTotal,
      wipAgingCounts,
      blockedIssues,
      timeInStatus,
      structuralBottleneck,
      previousPeriod,
    });
  }
);

export default router;
