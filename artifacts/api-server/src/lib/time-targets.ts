/** Target for lead/cycle time, the rule Evolution used (moved here when Evolution was removed):
 *  the project's own target for the 3m period, else any project target for the metric, else the
 *  Admin → Health "good" threshold (global or this project's override). Null when none exists. */
export function pickTimeTarget(
  targets: { metric: string; period: string; targetValue: string }[],
  thresholds: Record<string, { goodValue: number }>,
  metric: "leadTime" | "cycleTime"
): number | null {
  const match = targets.find((t) => t.metric === metric && t.period === "3m") ?? targets.find((t) => t.metric === metric);
  if (match) return Number(match.targetValue);
  return thresholds[metric]?.goodValue ?? null;
}
