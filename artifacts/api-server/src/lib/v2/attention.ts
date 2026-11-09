import type { EffectiveThreshold } from "../health-thresholds";
import type { PredictabilityBand } from "./stats";

type Thresholds = Record<string, EffectiveThreshold>;

const warn = (t: Thresholds, key: string, fallback: number) => t[key]?.warningValue ?? fallback;

export function scrumAttention(avgRealRate: number | null, band: PredictabilityBand | null, t: Thresholds): string[] {
  const out: string[] = [];
  if (avgRealRate !== null && avgRealRate < warn(t, "sprintCompletionReal", 50)) {
    out.push(`cumplimiento real ${Math.round(avgRealRate)}%`);
  }
  if (band === "baja") out.push("predictibilidad baja");
  return out;
}

export function kanbanAttention(throughputDeltaPct: number | null, cycleMedianDeltaPct: number | null, t: Thresholds): string[] {
  const out: string[] = [];
  if (throughputDeltaPct !== null) {
    const drop = -throughputDeltaPct;
    if (drop > warn(t, "kanbanThroughputDrop", 30)) out.push(`entregó ${Math.round(drop)}% menos`);
  }
  if (cycleMedianDeltaPct !== null && cycleMedianDeltaPct > warn(t, "kanbanCycleTimeRise", 30)) {
    out.push(`tiempo de ciclo +${Math.round(cycleMedianDeltaPct)}%`);
  }
  return out;
}
