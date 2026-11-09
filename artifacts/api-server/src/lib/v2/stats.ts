export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1); null with fewer than 2 values. */
export function sampleStdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const ss = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(ss / (values.length - 1));
}

/** Relative change in %; null when there is no usable baseline. */
export function pctChange(before: number | null, after: number | null): number | null {
  if (before === null || before === 0 || after === null) return null;
  return ((after - before) / before) * 100;
}

/** Absolute change in percentage points. */
export function ppChange(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return after - before;
}

export type PredictabilityBand = "alta" | "media" | "baja";

export function predictabilityBand(
  stdDevPp: number | null,
  t: { goodValue: number; warningValue: number },
): PredictabilityBand | null {
  if (stdDevPp === null) return null;
  if (stdDevPp <= t.goodValue) return "alta";
  if (stdDevPp <= t.warningValue) return "media";
  return "baja";
}
