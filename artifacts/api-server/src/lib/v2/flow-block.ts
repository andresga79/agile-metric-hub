import { isWaitingStatus, type TimeInStatusEntry, type WipAgingItem } from "../flow-insights";
import { median, percentile } from "../stats";
import { mean } from "./stats";
import type { FlowBlock } from "./types";

const p85 = (v: number[]): number | null => {
  const p = percentile(v, 0.85);
  return p === null ? null : Math.round(p * 10) / 10;
};

/** Flow block shared by the Scrum and Kanban team views. */
export function buildFlowBlock(
  cycles: number[],
  leads: number[],
  cycleMedianDeltaPct: number | null,
  timeInStatus: TimeInStatusEntry[],
  wipAging: WipAgingItem[],
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
    timeInStatus: timeInStatus
      .filter((t) => t.category === "indeterminate")
      .sort((a, b) => b.avgDays - a.avgDays)
      .map((t) => ({ status: t.status, avgDays: t.avgDays, waiting: isWaitingStatus(t.status) })),
    wip: {
      total: wipAging.length,
      aged: wipAging.filter((w) => w.alertLevel === "critical" || w.alertLevel === "warning"),
    },
  };
}
