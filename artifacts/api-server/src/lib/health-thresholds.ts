import { db, defaultMetricThresholdsTable } from "@workspace/db";
import { eq, isNull, or } from "drizzle-orm";
import { DEFAULT_HEALTH_THRESHOLDS } from "../routes/admin/constants";

export interface EffectiveThreshold {
  goodValue: number;
  warningValue: number;
  isOverride: boolean;
}

async function ensureGlobalDefaultsSeeded(): Promise<void> {
  const existing = await db
    .select({ metric: defaultMetricThresholdsTable.metric })
    .from(defaultMetricThresholdsTable)
    .where(isNull(defaultMetricThresholdsTable.projectId));

  const existingMetrics = new Set(existing.map((r) => r.metric));
  const missing = DEFAULT_HEALTH_THRESHOLDS.filter((t) => !existingMetrics.has(t.metric));
  if (missing.length === 0) return;

  await db
    .insert(defaultMetricThresholdsTable)
    .values(missing.map((threshold) => ({
      metric: threshold.metric,
      projectId: null,
      goodValue: String(threshold.goodValue),
      warningValue: String(threshold.warningValue),
    })));
}

/**
 * Merges global default thresholds with per-project overrides (if any) for the given project.
 * This is the single source of truth every "health" computation in the app should read from —
 * server-side (analytics.ts, project-health.ts) and client-side (via the /admin/metric-thresholds
 * endpoints, which use this same merge logic).
 */
export async function getEffectiveThresholds(projectId?: string): Promise<Record<string, EffectiveThreshold>> {
  await ensureGlobalDefaultsSeeded();

  const rows = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .where(
      projectId
        ? or(isNull(defaultMetricThresholdsTable.projectId), eq(defaultMetricThresholdsTable.projectId, projectId))
        : isNull(defaultMetricThresholdsTable.projectId),
    );

  const result: Record<string, EffectiveThreshold> = {};
  for (const row of rows) {
    result[row.metric] = {
      goodValue: Number(row.goodValue),
      warningValue: Number(row.warningValue),
      isOverride: row.projectId != null,
    };
  }
  // Per-project rows are read after global rows in the same pass above (order not guaranteed),
  // so re-apply overrides last to make sure they win regardless of row order.
  for (const row of rows) {
    if (row.projectId === projectId && projectId) {
      result[row.metric] = {
        goodValue: Number(row.goodValue),
        warningValue: Number(row.warningValue),
        isOverride: true,
      };
    }
  }

  return result;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Normalizes a raw metric value to a 0-100 score against admin-configured anchors.
 *  worst/best are reference points, not numerically ordered — worst maps to score 0, best to
 *  score 100, regardless of whether worst > best (lower-is-better metric) or worst < best
 *  (higher-is-better metric). The value is clamped into [worst, best] BEFORE computing the ratio,
 *  so a value past the worst anchor can't wrap the fraction's sign and read back out as 100. */
export function normalize(value: number, worst: number, best: number): number {
  if (worst === best) return 100;
  const clampedValue = clamp(value, Math.min(worst, best), Math.max(worst, best));
  const raw = ((clampedValue - worst) / (best - worst)) * 100;
  return Math.round(clamp(raw, 0, 100));
}

export type HealthBand = "good" | "warning" | "critical";

export function classify(
  value: number,
  threshold: EffectiveThreshold | undefined,
  direction: "lowerBetter" | "higherBetter",
): HealthBand {
  if (!threshold) return "good";
  const { goodValue, warningValue } = threshold;
  if (direction === "lowerBetter") {
    if (value <= goodValue) return "good";
    if (value <= warningValue) return "warning";
    return "critical";
  }
  if (value >= goodValue) return "good";
  if (value >= warningValue) return "warning";
  return "critical";
}
