import {
  getJiraIssuesForWindow,
  getEffectiveIssueType,
  isIssueDone,
  getDeliveryDate,
  getLeadTimeDays,
  getCycleTimeDays,
  buildSprintVelocityBuckets,
  type JiraIssue,
  type JiraSprint,
} from "./jira";
import { getPortfolioAllowedIssueTypes } from "./portfolio-metric-settings";
import { median } from "./stats";

export interface SprintDeliveryTimes {
  /** Median lead/cycle time per sprint, keyed by sprint id. */
  perSprint: Map<number, { lead: number | null; cycle: number | null }>;
  /** Median over every issue delivered inside a CLOSED sprint's window (active sprint excluded,
   *  its numbers are still moving), for "the window's cycle time" cards. */
  closedPooled: { lead: number | null; cycle: number | null };
}

/** Lead/cycle time per sprint by DELIVERY date: each issue counts once, in the sprint whose
 *  [start, close) window it was delivered in — the same buckets as the Resumen chart and the
 *  Métricas tab (buildSprintVelocityBuckets), so Sprints, Evolution and Métricas show the same
 *  number for a sprint. Sprint membership would credit an issue to every sprint it passed through
 *  (OLP-3330, 427 d, in both 116 and 117). */
export async function sprintDeliveryTimes(projectId: string, sprints: JiraSprint[]): Promise<SprintDeliveryTimes> {
  const perSprint = new Map<number, { lead: number | null; cycle: number | null }>();
  const withStart = sprints.filter((s) => s.startDate);
  if (withStart.length === 0) return { perSprint, closedPooled: { lead: null, cycle: null } };

  const oldestStart = Math.min(...withStart.map((s) => new Date(s.startDate!).getTime()));
  const days = Math.ceil((Date.now() - oldestStart) / 86_400_000) + 1;

  const [issues, allowedIssueTypes] = await Promise.all([
    getJiraIssuesForWindow(projectId, days, { includeChangelog: true }),
    getPortfolioAllowedIssueTypes(),
  ]);
  const unique = Array.from(new Map(issues.map((i) => [i.key, i])).values()).filter(
    (i) => allowedIssueTypes.includes(getEffectiveIssueType(i)) && isIssueDone(i)
  );
  const withDates = await Promise.all(unique.map(async (i) => ({ issue: i, at: await getDeliveryDate(i) })));
  const delivered = withDates.filter((r): r is { issue: JiraIssue; at: Date } => r.at !== null);
  const resolvedMap = new Map(delivered.map((r) => [r.issue.id, r.at]));
  const resolved = delivered.map((r) => r.issue);
  const leadCycle = new Map(
    await Promise.all(
      resolved.map(async (i) => [i.id, { lead: await getLeadTimeDays(i), cycle: await getCycleTimeDays(i) }] as const)
    )
  );

  const buckets = buildSprintVelocityBuckets(resolved, resolvedMap, withStart, leadCycle);
  const byName = new Map(buckets.map((b) => [b.label, b]));
  for (const s of withStart) {
    const b = byName.get(s.name);
    perSprint.set(s.id, { lead: b?.medianLeadTime ?? null, cycle: b?.medianCycleTime ?? null });
  }

  const closedWindows = withStart
    .filter((s) => s.state === "closed")
    .map((s) => ({
      start: new Date(s.startDate!).getTime(),
      end: new Date(s.completeDate ?? s.endDate ?? Date.now()).getTime(),
    }));
  const inClosed = resolved.filter((i) => {
    const t = resolvedMap.get(i.id)!.getTime();
    return closedWindows.some((w) => t >= w.start && t < w.end);
  });
  const pick = (k: "lead" | "cycle") =>
    inClosed.map((i) => leadCycle.get(i.id)?.[k]).filter((v): v is number => v !== null && v !== undefined);

  return { perSprint, closedPooled: { lead: median(pick("lead")), cycle: median(pick("cycle")) } };
}
