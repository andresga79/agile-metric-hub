import type { EffectiveThreshold } from "../health-thresholds";
import { scrumAttention } from "./attention";
import { predictabilityBand } from "./stats";
import type { TeamView, V2Thresholds } from "./types";

type Thresholds = Record<string, EffectiveThreshold>;

const DEFAULT_COMPLETION = { goodValue: 80, warningValue: 50 };
const DEFAULT_PREDICTABILITY = { goodValue: 8, warningValue: 12 };

/** The Admin → Health values the v2 colour bands and copy are drawn from (spec §5). */
export function v2Thresholds(t: Thresholds): V2Thresholds {
  const c = t.sprintCompletionReal ?? DEFAULT_COMPLETION;
  const p = t.sprintPredictability ?? DEFAULT_PREDICTABILITY;
  return {
    completionGood: c.goodValue,
    completionWarning: c.warningValue,
    predictabilityGood: p.goodValue,
    predictabilityWarning: p.warningValue,
  };
}

/**
 * Re-derives everything in a team view that depends on thresholds (predictability band,
 * attention, `thresholds`) from its numbers. The numbers are cached for 6 h; this runs on every
 * read so an Admin → Health change applies on the next request, not after the cache expires.
 */
export function applyThresholds<T extends TeamView>(view: T, t: Thresholds): T {
  const thresholds = v2Thresholds(t);
  if (view.boardType === "scrum") {
    const band = predictabilityBand(view.compliance.stdDevPp, {
      goodValue: thresholds.predictabilityGood,
      warningValue: thresholds.predictabilityWarning,
    });
    return {
      ...view,
      compliance: { ...view.compliance, band },
      attention: scrumAttention(view.compliance.avgRealRate, band, t),
      thresholds,
    };
  }
  return {
    ...view,
    // Kanban teams stay in the portfolio table but are never flagged (decision 2026-11-09).
    attention: [],
    thresholds,
  };
}
