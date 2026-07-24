import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectMetrics, getGetProjectMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users } from "lucide-react";
import CfdChart from "@/components/cfd-chart";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";

type Period = "1m" | "3m";

export default function ProjectReport() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [cfdData, setCfdData] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [timeInStatus, setTimeInStatus] = useState<any[]>([]);
  const [healthScore, setHealthScore] = useState<number | null>(null);
  const [qaRejectionRate, setQaRejectionRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: metrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectMetricsQueryKey(projectId!, period) },
  });

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setError(null);
      setCfdData([]);
      setMembers([]);
      setTimeInStatus([]);
      setHealthScore(null);
      setQaRejectionRate(null);
      return;
    }
    if (!token) {
      setLoading(false);
      setError(t("common.loading"));
      setCfdData([]);
      setMembers([]);
      setTimeInStatus([]);
      setHealthScore(null);
      setQaRejectionRate(null);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/projects/${projectId}/cfd/${period}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`CFD request failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/projects/${projectId}/members/${period}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`Members request failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/projects/${projectId}/analytics/${period}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`Analytics request failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/projects/${projectId}/health/${period}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`Health request failed: ${r.status}`);
        return r.json();
      }),
      fetch(`/api/projects/${projectId}/qa-rejected/${period}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => {
        if (!r.ok) throw new Error(`QA rejected request failed: ${r.status}`);
        return r.json();
      }),
    ])
      .then(([cfd, memberRows, analytics, health, qaRejected]) => {
        setCfdData(cfd?.dataPoints ?? []);
        setMembers(Array.isArray(memberRows) ? memberRows : []);
        setTimeInStatus(analytics?.timeInStatus ?? []);
        const doraDimension = health?.dimensions?.find((d: any) => d.name === "DORA Score");
        setHealthScore(typeof doraDimension?.value === "number" ? doraDimension.value : null);
        setQaRejectionRate(
          typeof qaRejected?.overallRejectionRate === "number" ? qaRejected.overallRejectionRate : null
        );
      })
      .catch((err) => {
        console.error(err);
        setError(t("common.loading"));
        setCfdData([]);
        setMembers([]);
        setTimeInStatus([]);
        setHealthScore(null);
        setQaRejectionRate(null);
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

  if (loading) return <div>{t('common.loading')}</div>;
  if (!project) return <div>{t('page.team.notFound')}</div>;
  if (error) return <div>{error}</div>;

  const sortedTimeInStatus = [...timeInStatus].sort((a: any, b: any) => b.avgDays - a.avgDays);
  const topMembers = [...(members ?? [])].sort((a: any, b: any) => b.issuesResolved - a.issuesResolved).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {project.name}
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.report.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.report.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-background border border-border rounded-md p-1">
            {(["1m", "3m"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ProjectTabs projectId={projectId!} active="report" />

      <div className="space-y-4 bg-white text-black p-8 rounded-lg">
        <div className="text-center border-b border-gray-300 pb-4 mb-4">
          <h2 className="text-2xl font-bold">{project.name}</h2>
          <p className="text-sm text-gray-500">{t('page.report.reportTitle')} — {period.toUpperCase()}</p>
          <p className="text-xs text-gray-400">{new Date().toLocaleDateString()}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.throughput')}</div>
            <div className="text-xl font-bold">{metrics?.throughput?.toFixed(1) ?? "—"} /wk</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.cycleTime')}</div>
            <div className="text-xl font-bold">{metrics?.cycleTime?.toFixed(1) ?? "—"}d</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.leadTime')}</div>
            <div className="text-xl font-bold">{metrics?.leadTime?.toFixed(1) ?? "—"}d</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.resolved')}</div>
            <div className="text-xl font-bold">{metrics?.resolvedCount ?? "—"}</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.healthScore')}</div>
            <div className="text-xl font-bold">{healthScore ?? "—"}{healthScore !== null ? "/100" : ""}</div>
          </div>
          <div className="border border-gray-200 rounded p-3">
            <div className="text-xs text-gray-500">{t('page.report.qaRejectionRate')}</div>
            <div className="text-xl font-bold">{qaRejectionRate ?? "—"}{qaRejectionRate !== null ? "%" : ""}</div>
          </div>
        </div>


        <div className="border border-gray-200 rounded p-3">
          <h3 className="text-sm font-semibold mb-2">{t('page.report.percentiles')}</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Cycle Time P50: <strong>{metrics?.cycleTimePercentiles?.p50?.toFixed(1) ?? "—"}d</strong> P95: <strong>{metrics?.cycleTimePercentiles?.p95?.toFixed(1) ?? "—"}d</strong></div>
            <div>Lead Time P50: <strong>{metrics?.leadTimePercentiles?.p50?.toFixed(1) ?? "—"}d</strong> P95: <strong>{metrics?.leadTimePercentiles?.p95?.toFixed(1) ?? "—"}d</strong></div>
          </div>
        </div>

        {cfdData.length > 0 && (
          <div className="border border-gray-200 rounded p-3">
            <h3 className="text-sm font-semibold mb-2">{t('page.report.cfdTitle')}</h3>
            <div className="h-[200px]">
              <CfdChart data={cfdData} />
            </div>
          </div>
        )}

        {topMembers.length > 0 && (
          <div className="border border-gray-200 rounded p-3">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
              <Users size={14} />
              {t('page.report.membersTitle')}
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 text-gray-500 font-medium">{t('page.report.memberName')}</th>
                  <th className="text-right py-1 text-gray-500 font-medium">{t('page.report.memberResolved')}</th>
                  <th className="text-right py-1 text-gray-500 font-medium">{t('page.report.memberCycle')}</th>
                  <th className="text-right py-1 text-gray-500 font-medium">{t('page.report.memberPoints')}</th>
                </tr>
              </thead>
              <tbody>
                {topMembers.map((m: any) => (
                  <tr key={m.accountId} className="border-b border-gray-100">
                    <td className="py-1 font-medium">{m.displayName}</td>
                    <td className="py-1 text-right">{m.issuesResolved}</td>
                    <td className="py-1 text-right">{m.avgCycleTime?.toFixed(1) ?? "—"}d</td>
                    <td className="py-1 text-right">{m.storyPoints ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sortedTimeInStatus.length > 0 && (
          <div className="border border-gray-200 rounded p-3">
            <h3 className="text-sm font-semibold mb-2">{t('page.report.flowTitle')}</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 text-gray-500 font-medium">{t('page.report.flowStatus')}</th>
                  <th className="text-right py-1 text-gray-500 font-medium">{t('page.report.flowAvgDays')}</th>
                  <th className="text-right py-1 text-gray-500 font-medium">{t('page.report.flowIssues')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimeInStatus.slice(0, 6).map((entry: any) => (
                  <tr key={entry.status} className="border-b border-gray-100">
                    <td className="py-1 font-medium">{entry.status}</td>
                    <td className="py-1 text-right">{entry.avgDays.toFixed(1)}d</td>
                    <td className="py-1 text-right">{entry.issueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
