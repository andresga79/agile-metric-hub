import { isoWeekStart } from "./iso-week";

/** Weeks shown in the "entrada vs salida" chart and used for the sustainable-WIP estimate. */
export const WIP_FLOW_WEEKS = 12;
const DAY_MS = 86_400_000;

export interface WipIssueInput {
  key: string;
  summary: string;
  assignee: string | null;
  issueType: string;
  status: string;
  /** Status category: indeterminate = being worked, anything else mid-flow = waiting. */
  active: boolean;
  /** Blocked right now (status or Flagged field). */
  blocked: boolean;
  startedAt: Date;
}

export interface WipItem {
  key: string;
  summary: string;
  assignee: string | null;
  issueType: string;
  status: string;
  active: boolean;
  blocked: boolean;
  startedAt: string;
  ageDays: number;
}

export interface WipStatusRow {
  status: string;
  active: boolean;
  count: number;
  oldestDays: number;
}

export interface FlowWeek {
  weekStart: string;
  started: number;
  delivered: number;
}

/** Work in progress right now, oldest first, plus how it spreads over statuses. */
export function buildWip(
  issues: WipIssueInput[],
  now: Date
): { items: WipItem[]; byStatus: WipStatusRow[]; blockedNow: number } {
  const items = issues
    .map((i) => ({
      key: i.key,
      summary: i.summary,
      assignee: i.assignee,
      issueType: i.issueType,
      status: i.status,
      active: i.active,
      blocked: i.blocked,
      startedAt: i.startedAt.toISOString(),
      ageDays: Math.max(0, Math.round(((now.getTime() - i.startedAt.getTime()) / DAY_MS) * 10) / 10),
    }))
    .sort((a, b) => b.ageDays - a.ageDays);

  const rows = new Map<string, WipStatusRow>();
  for (const i of items) {
    const row = rows.get(i.status) ?? { status: i.status, active: i.active, count: 0, oldestDays: 0 };
    row.count++;
    row.oldestDays = Math.max(row.oldestDays, i.ageDays);
    rows.set(i.status, row);
  }
  // Being worked first, then waiting; within each, the most loaded status first.
  const byStatus = [...rows.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.count - a.count);
  // Blocked work counted within WIP only, so "% of WIP blocked" can never pass 100 %.
  return { items, byStatus, blockedNow: items.filter((i) => i.blocked).length };
}

/** Started vs delivered per ISO week over the last `weeks` weeks (current week included, partial).
 *  More started than delivered week after week means WIP is piling up even if nobody notices. */
export function flowByWeek(started: Date[], delivered: Date[], now: Date, weeks = WIP_FLOW_WEEKS): FlowWeek[] {
  const out: FlowWeek[] = [];
  const current = new Date(isoWeekStart(now));
  for (let w = weeks - 1; w >= 0; w--) {
    const d = new Date(current.getTime() - w * 7 * DAY_MS);
    out.push({ weekStart: d.toISOString().slice(0, 10), started: 0, delivered: 0 });
  }
  const index = new Map(out.map((w, i) => [w.weekStart, i]));
  for (const s of started) {
    const i = index.get(isoWeekStart(s));
    if (i !== undefined) out[i]!.started++;
  }
  for (const d of delivered) {
    const i = index.get(isoWeekStart(d));
    if (i !== undefined) out[i]!.delivered++;
  }
  return out;
}

/** WIP the team sustains at its current pace, by Little's law: WIP = throughput × mean cycle time.
 *  The MEAN, not the median: Little's law holds for averages. Throughput per calendar day over the
 *  full weeks of the window (the current, partial week is left out so it doesn't drag it down). */
export function sustainableWip(weeksData: FlowWeek[], meanCycleTimeDays: number | null): number | null {
  const full = weeksData.slice(0, -1);
  if (full.length === 0 || meanCycleTimeDays === null) return null;
  const delivered = full.reduce((sum, w) => sum + w.delivered, 0);
  if (delivered === 0) return null;
  const perDay = delivered / (full.length * 7);
  return Math.round(perDay * meanCycleTimeDays * 10) / 10;
}
