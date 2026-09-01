import { useState, useEffect } from "react";
import { getAuthToken } from "@/lib/auth";

export interface SprintGoal {
  sprintName: string;
  goal: string;
}

export interface ReleaseEpic {
  issueKey: string;
  summary: string;
  description: string | null;
  status: string;
  statusCategory: string;
  assignee: string | null;
  jiraUpdatedAt: string;
  linkedIssueKeys: string[];
}

export type ReleaseReadiness = { configured: false } | { configured: true; epics: ReleaseEpic[] };

export function useReportData(projectId: string | undefined, period: "1m" | "3m") {
  const [cfdData, setCfdData] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [timeInStatus, setTimeInStatus] = useState<any[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [qaRejectionRate, setQaRejectionRate] = useState<number | null>(null);
  const [blockedIssues, setBlockedIssues] = useState<any[]>([]);
  const [sprints, setSprints] = useState<any[]>([]);
  const [sprintGoal, setSprintGoal] = useState<SprintGoal | null>(null);
  const [releaseReadiness, setReleaseReadiness] = useState<ReleaseReadiness | null>(null);
  const [insights, setInsights] = useState<any[]>([]);
  const [structuralBottleneck, setStructuralBottleneck] = useState<any | null>(null);
  const [nextSteps, setNextSteps] = useState<any[]>([]);
  const [featuredIssues, setFeaturedIssues] = useState<any[]>([]);
  const [healthDimensions, setHealthDimensions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = getAuthToken();

  useEffect(() => {
    if (!projectId || !token) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const headers = { Authorization: `Bearer ${token}` };
    const opts = { signal: controller.signal, headers };

    setLoading(true);
    setError(null);

    const jsonOrThrow = (label: string) => (r: Response) => {
      if (!r.ok) throw new Error(`${label} request failed: ${r.status}`);
      return r.json();
    };

    Promise.all([
      fetch(`/api/projects/${projectId}/cfd/${period}`, opts).then(jsonOrThrow("CFD")),
      fetch(`/api/projects/${projectId}/members/${period}`, opts).then(jsonOrThrow("Members")),
      fetch(`/api/projects/${projectId}/analytics/${period}`, opts).then(jsonOrThrow("Analytics")),
      fetch(`/api/projects/${projectId}/health/${period}`, opts).then(jsonOrThrow("Health")),
      fetch(`/api/projects/${projectId}/qa-rejected/${period}`, opts).then(jsonOrThrow("QA rejected")),
      fetch(`/api/projects/${projectId}/sprints/${period}`, opts)
        .then(jsonOrThrow("Sprints"))
        .catch(() => ({ sprints: [] })),
      fetch(`/api/projects/${projectId}/sprint-goal`, opts).then(jsonOrThrow("Sprint goal")),
      fetch(`/api/projects/${projectId}/release-readiness`, opts).then(jsonOrThrow("Release readiness")),
      fetch(`/api/projects/${projectId}/report-insights`, opts).then(jsonOrThrow("Report insights")),
    ])
      .then(([cfd, memberRows, analytics, health, qaRejected, sprintData, goal, readiness, insightRows]) => {
        setCfdData(cfd?.dataPoints ?? []);
        setMembers(Array.isArray(memberRows) ? memberRows : []);
        setTimeInStatus(analytics?.timeInStatus ?? []);
        setBlockedIssues((analytics?.blockedIssues ?? []).filter((b: any) => b.isCurrentlyBlocked));
        const flowHealthDimension = health?.dimensions?.find((d: any) => d.name === "Flow Health Score");
        setHealthScore(typeof flowHealthDimension?.value === "number" ? flowHealthDimension.value : null);
        setQaRejectionRate(
          typeof qaRejected?.overallRejectionRate === "number" ? qaRejected.overallRejectionRate : null
        );
        setSprints(sprintData?.sprints ?? []);
        setSprintGoal(goal ?? null);
        setReleaseReadiness(readiness ?? { configured: false });
        setInsights(Array.isArray(insightRows?.insights) ? insightRows.insights : []);
        setNextSteps(Array.isArray(insightRows?.nextSteps) ? insightRows.nextSteps : []);
        setFeaturedIssues(Array.isArray(insightRows?.featuredIssues) ? insightRows.featuredIssues : []);
        setStructuralBottleneck(analytics?.structuralBottleneck ?? null);
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
  }, [projectId, period, token]);

  return {
    loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate,
    blockedIssues, sprints, sprintGoal, releaseReadiness, insights,
    structuralBottleneck, nextSteps, featuredIssues, healthDimensions,
  };
}
