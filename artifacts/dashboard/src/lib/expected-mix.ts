/** Splits the recommended commitment (midpoint of the issue range) by the share each work type
 *  had over the last closed sprints (Composición del sprint, 6s). Rounded per type, types that round
 *  to 0 are dropped — shown with "~", so the parts need not add up exactly to the midpoint. */
export function expectedMix(
  issueRange: [number, number],
  rows: { category: string; issueShare: number }[]
): { category: string; issues: number }[] {
  const midpoint = (issueRange[0] + issueRange[1]) / 2;
  return rows
    .map((r) => ({ category: r.category, issues: Math.round((midpoint * r.issueShare) / 100) }))
    .filter((m) => m.issues > 0);
}
