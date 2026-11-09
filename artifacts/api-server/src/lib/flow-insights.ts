import {
  getStatusCategoryMap,
  statusCategory,
  isIssueDone,
  getResolutionDate,
  type JiraIssue,
} from "./jira";
import type { EffectiveThreshold } from "./health-thresholds";

// Admin -> Health configures wipAging as a (goodValue, warningValue) pair (defaults 3d / 14d).
// The "watch"/"warning" split below the two admin cutoffs is derived as their midpoint so the
// existing 3-tier UI (project-flow.tsx, flow-health-card.tsx) keeps working without a 3rd
// admin-configurable number.
export function getAlertLevel(days: number | null, threshold: EffectiveThreshold | undefined): "critical" | "warning" | "watch" | null {
  if (days === null) return null;
  const good = threshold?.goodValue ?? 3;
  const warning = threshold?.warningValue ?? 14;
  const midpoint = (good + warning) / 2;
  if (days >= warning) return "critical";
  if (days >= midpoint) return "warning";
  if (days >= good) return "watch";
  return null;
}

export interface TimeInStatusEntry {
  status: string;
  category: string;
  totalDays: number;
  avgDays: number;
  medianDays: number;
  issueCount: number;
}

export async function computeTimeInStatus(
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

const WAITING_RE = /ready|accepted|aceptad|listo|espera|waiting|pending|pendiente|review pending|bloquead|blocked/i;

export function isWaitingStatus(name: string): boolean {
  return WAITING_RE.test(name);
}

export interface WipAgingItem {
  id: string;
  key: string;
  summary: string;
  assignee: string | null;
  issueType: string;
  priority: string;
  daysInProgress: number;
  alertLevel: "critical" | "warning" | "watch" | null;
  enteredDate: string;
}

export async function computeWipAging(
  inProgress: JiraIssue[],
  threshold: EffectiveThreshold | undefined,
): Promise<WipAgingItem[]> {
  const items = await Promise.all(
    inProgress.map(async (i): Promise<WipAgingItem> => {
      const histories = i.changelog?.histories ?? [];
      let enteredInProgress: Date | null = null;

      if (histories.length > 0) {
        const categoryMap = await getStatusCategoryMap();
        const transitions = histories
          .filter((h) => h.items.some((it) => it.field === "status"))
          .map((h) => {
            const item = h.items.find((it) => it.field === "status");
            return { at: new Date(h.created), to: item?.toString ?? "", toId: item?.to ?? null };
          })
          .sort((a, b) => b.at.getTime() - a.at.getTime());

        for (const t of transitions) {
          const cat = statusCategory(categoryMap, t.to, t.toId);
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
        alertLevel: getAlertLevel(daysInProgress, threshold),
        enteredDate: enteredInProgress?.toISOString() ?? fallbackStart.toISOString(),
      };
    })
  );
  return items.sort((a, b) => b.daysInProgress - a.daysInProgress);
}
