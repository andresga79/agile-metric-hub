import { useMemo } from "react";
import {
  useGetProjectWip, getGetProjectWipQueryKey,
  useGetProjectMetrics, getGetProjectMetricsQueryKey,
} from "@workspace/api-client-react";
import type { TimeWindow } from "@/components/time-window-filter";

export interface TeamAttentionRow {
  /** Display name, or null for work nobody is assigned to (listed last). */
  assignee: string | null;
  inProgress: number;
  blocked: number;
  /** In-progress items older than the period's cycle time P85 (same rule as Flujo → WIP, red). */
  overdue: number;
  workingOn: { key: string; summary: string; status: string; ageDays: number; blocked: boolean; overdue: boolean }[];
}

/** Per-person view without rankings: what each person has in progress, blocked and overdue, from
 *  /wip (work-start rule, same as Flujo) and the P85 of /metrics for the period. No times or SP per
 *  person. Sorted by what needs attention first. */
export function useTeamAttention(projectId: string, period: TimeWindow, enabled = true) {
  const { data: wip, isLoading: loadingWip, isError } = useGetProjectWip(projectId, {
    query: { enabled: enabled && !!projectId, queryKey: getGetProjectWipQueryKey(projectId) },
  });
  const { data: metrics, isLoading: loadingMetrics } = useGetProjectMetrics(projectId, period, {
    query: { enabled: enabled && !!projectId, queryKey: getGetProjectMetricsQueryKey(projectId, period) },
  });
  const p85 = metrics && metrics.resolvedCount > 0 ? metrics.cycleTimePercentiles.p85 : null;

  const rows = useMemo<TeamAttentionRow[]>(() => {
    const byPerson = new Map<string | null, TeamAttentionRow>();
    for (const item of wip?.items ?? []) {
      const key = item.assignee ?? null;
      let row = byPerson.get(key);
      if (!row) byPerson.set(key, (row = { assignee: key, inProgress: 0, blocked: 0, overdue: 0, workingOn: [] }));
      const overdue = p85 !== null && item.ageDays > p85;
      row.inProgress++;
      if (item.blocked) row.blocked++;
      if (overdue) row.overdue++;
      row.workingOn.push({ key: item.key, summary: item.summary, status: item.status, ageDays: item.ageDays, blocked: item.blocked, overdue });
    }
    return [...byPerson.values()].sort(
      (a, b) =>
        Number(a.assignee === null) - Number(b.assignee === null) ||
        b.blocked - a.blocked ||
        b.overdue - a.overdue ||
        b.inProgress - a.inProgress ||
        (a.assignee ?? "").localeCompare(b.assignee ?? "", "es")
    );
  }, [wip, p85]);

  return { rows, p85, loading: loadingWip || loadingMetrics, failed: isError };
}
