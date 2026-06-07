type TrendDirection = "up" | "down" | "stable";

function getTrendDirection(trendPercent: number): TrendDirection {
  if (Math.abs(trendPercent) < 3) return "stable";
  return trendPercent >= 0 ? "up" : "down";
}

export function describeTrend(
  metricKey: string,
  trendPercent: number | undefined | null,
  currentValue: number | undefined | null,
  t: (key: string, opts?: any) => string
): string | null {
  if (trendPercent === undefined || trendPercent === null || currentValue === undefined || currentValue === null) return null;
  const direction = getTrendDirection(trendPercent);
  const absPct = Math.abs(trendPercent).toFixed(0);
  return t(`trend.${direction}`, { metric: t(metricKey), pct: absPct, value: typeof currentValue === 'number' ? currentValue.toFixed(1) : String(currentValue) });
}

export function isImproving(
  metricKey: string,
  trendPercent: number | undefined | null,
  isLowerBetter: boolean
): boolean | null {
  if (trendPercent === undefined || trendPercent === null) return null;
  if (Math.abs(trendPercent) < 3) return null;
  return isLowerBetter ? trendPercent < 0 : trendPercent > 0;
}
