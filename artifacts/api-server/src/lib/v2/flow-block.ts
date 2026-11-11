import { isWaitingStatus, type TimeInStatusEntry, type WipAgingItem } from "../flow-insights";
import { median, percentile } from "../stats";
import { mean } from "./stats";
import type { FlowBlock, TimeInStatusRow, WipBlock } from "./types";

const p85 = (v: number[]): number | null => {
  const p = percentile(v, 0.85);
  return p === null ? null : Math.round(p * 10) / 10;
};

/** Flow statuses only, longest first: in-progress statuses plus the mid-flow waiting ones Jira files
 *  under To Do ("Ready for DEV"). The plain backlog ("To Do", "Backlog", "Open") never matches
 *  isWaitingStatus. */
export function flowStatusRows(timeInStatus: TimeInStatusEntry[]): TimeInStatusRow[] {
  return timeInStatus
    .filter((t) => t.category === "indeterminate" || (t.category === "new" && isWaitingStatus(t.status)))
    .sort((a, b) => b.avgDays - a.avgDays)
    .map((t) => ({ status: t.status, avgDays: t.avgDays, waiting: isWaitingStatus(t.status) }));
}

/** Work in progress today and the part of it that is ageing (critical/warning). */
export function wipBlock(wipAging: WipAgingItem[]): WipBlock {
  return {
    total: wipAging.length,
    aged: wipAging.filter((w) => w.alertLevel === "critical" || w.alertLevel === "warning"),
  };
}

/** Flow block shared by the Scrum and Kanban team views. `wipAging` null = no "today" WIP in this
 *  view (Scrum windows: the sprint in progress lives in the current-sprint view). */
export function buildFlowBlock(
  cycles: number[],
  leads: number[],
  cycleMedianDeltaPct: number | null,
  timeInStatus: TimeInStatusEntry[],
  wipAging: WipAgingItem[] | null,
): FlowBlock {
  const cycleMean = mean(cycles);
  const leadMean = mean(leads);
  return {
    cycleMedian: median(cycles),
    cycleP85: p85(cycles),
    cycleMedianDeltaPct,
    leadMedian: median(leads),
    leadP85: p85(leads),
    flowEfficiencyPct: cycleMean === null || leadMean === null || leadMean === 0 ? null : (cycleMean / leadMean) * 100,
    timeInStatus: flowStatusRows(timeInStatus),
    wip: wipAging === null ? null : wipBlock(wipAging),
  };
}
