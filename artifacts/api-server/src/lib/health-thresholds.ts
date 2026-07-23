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
    .select({ id: defaultMetricThresholdsTable.id })
    .from(defaultMetricThresholdsTable)
    .where(isNull(defaultMetricThresholdsTable.projectId))
    .limit(1);

  if (existing.length > 0) return;

  await db
    .insert(defaultMetricThresholdsTable)
    .values(DEFAULT_HEALTH_THRESHOLDS.map((threshold) => ({
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
