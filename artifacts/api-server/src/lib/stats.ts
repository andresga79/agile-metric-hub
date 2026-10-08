/** Linear-interpolated median, rounded to 1 decimal. null for an empty sample.
 *  Cycle/lead time are judged by their median everywhere a health status is derived (Resumen
 *  semaphore, Health tab, report insights): the mean is dragged for 90 days by any backlog cleanup
 *  that closes a handful of year-old tickets, even when the team's current pace is fine. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * 0.5;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const value = lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
  return Math.round(value * 10) / 10;
}

/** Linear-interpolated percentile (p in 0..1), not rounded. null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}
