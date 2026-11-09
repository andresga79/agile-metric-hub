import type { EffectiveThreshold } from "../health-thresholds";
import type { PredictabilityBand } from "./stats";

type Thresholds = Record<string, EffectiveThreshold>;

const warn = (t: Thresholds, key: string, fallback: number) => t[key]?.warningValue ?? fallback;

const nf = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/**
 * One decimal, es-CL, on the side of the cut-off the value is actually on: a value under the
 * cut-off never reads as the cut-off (49,96 -> "49,9", not "50"), one over it never reads as it
 * (30,04 -> "30,1", not "30").
 */
function pctOutside(value: number, cutoff: number, side: "below" | "above"): string {
  let r = Math.round(value * 10) / 10;
  if (side === "below" && r >= cutoff) r = Math.floor(value * 10) / 10;
  if (side === "above" && r <= cutoff) r = Math.ceil(value * 10) / 10;
  return nf.format(r);
}

export function scrumAttention(avgRealRate: number | null, band: PredictabilityBand | null, t: Thresholds): string[] {
  const out: string[] = [];
  const completion = warn(t, "sprintCompletionReal", 50);
  if (avgRealRate !== null && avgRealRate < completion) {
    out.push(`cumplimiento real ${pctOutside(avgRealRate, completion, "below")}%`);
  }
  if (band === "baja") out.push("predictibilidad baja");
  return out;
}

export function kanbanAttention(throughputDeltaPct: number | null, cycleMedianDeltaPct: number | null, t: Thresholds): string[] {
  const out: string[] = [];
  if (throughputDeltaPct !== null) {
    const drop = -throughputDeltaPct;
    const cut = warn(t, "kanbanThroughputDrop", 30);
    if (drop > cut) out.push(`entregó ${pctOutside(drop, cut, "above")}% menos`);
  }
  const rise = warn(t, "kanbanCycleTimeRise", 30);
  if (cycleMedianDeltaPct !== null && cycleMedianDeltaPct > rise) {
    out.push(`tiempo de ciclo +${pctOutside(cycleMedianDeltaPct, rise, "above")}%`);
  }
  return out;
}
