import { useState, useEffect } from "react";
import { getAuthToken } from "@/lib/auth";

export function useMemberReportData(
  projectId: string | undefined,
  accountId: string | undefined,
  period: "1m" | "3m"
) {
  const [members, setMembers] = useState<any[]>([]);
  const [memberIssues, setMemberIssues] = useState<any[]>([]);
  const [timeInStatus, setTimeInStatus] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [trends, setTrends] = useState<{ resolvedCount: number; cycleTime: number; leadTime: number } | null>(null);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [qaRejectionRate, setQaRejectionRate] = useState<number | null>(null);
  const [blockedIssues, setBlockedIssues] = useState<any[]>([]);
  const [wipAging, setWipAging] = useState<any[]>([]);
  const [healthDimensions, setHealthDimensions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = getAuthToken();

  useEffect(() => {
    if (!projectId || !accountId || !token) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers = { Authorization: `Bearer ${token}` };
    const opts = { signal: controller.signal, headers };
    const assignee = encodeURIComponent(accountId);

    setLoading(true);
    setError(null);

    const jsonOrThrow = (label: string) => (r: Response) => {
      if (!r.ok) throw new Error(`${label} request failed: ${r.status}`);
      return r.json();
    };

    Promise.all([
      // Project-wide roster — used only to look up this member's displayName/avatar, not filtered.
      fetch(`/api/projects/${projectId}/members/${period}`, opts).then(jsonOrThrow("Members")),
      fetch(`/api/projects/${projectId}/metrics/${period}?compareTo=true&assignee=${assignee}`, opts).then(jsonOrThrow("Metrics")),
      fetch(`/api/projects/${projectId}/analytics/${period}?assignee=${assignee}`, opts).then(jsonOrThrow("Analytics")),
      fetch(`/api/projects/${projectId}/health/${period}?assignee=${assignee}`, opts).then(jsonOrThrow("Health")),
      fetch(`/api/projects/${projectId}/qa-rejected/${period}?assignee=${assignee}`, opts).then(jsonOrThrow("QA rejected")),
      fetch(`/api/projects/${projectId}/issues/${period}?assignee=${assignee}`, opts).then(jsonOrThrow("Issues")),
    ])
      .then(([memberRows, metricsData, analytics, health, qaRejected, issues]) => {
        setMembers(Array.isArray(memberRows) ? memberRows : []);
        setMemberIssues(Array.isArray(issues) ? issues : []);
        setMetrics(metricsData ?? null);
        setTrends(metricsData?.trends ?? null);
        setTimeInStatus(analytics?.timeInStatus ?? []);
        setBlockedIssues((analytics?.blockedIssues ?? []).filter((b: any) => b.isCurrentlyBlocked));
        setWipAging(Array.isArray(analytics?.wipAging) ? analytics.wipAging : []);
        const flowHealthDimension = health?.dimensions?.find((d: any) => d.name === "Flow Health Score");
        setHealthScore(typeof flowHealthDimension?.value === "number" ? flowHealthDimension.value : null);
        setQaRejectionRate(
          typeof qaRejected?.overallRejectionRate === "number" ? qaRejected.overallRejectionRate : null
        );
        setHealthDimensions(Array.isArray(health?.dimensions) ? health.dimensions : []);
      })
      .catch((err) => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [projectId, accountId, period, token]);

  return {
    loading, error, members, memberIssues, timeInStatus, metrics, trends, healthScore, qaRejectionRate,
    blockedIssues, wipAging, healthDimensions,
  };
}
