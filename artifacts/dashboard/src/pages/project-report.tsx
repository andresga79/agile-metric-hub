import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectMetrics, getGetProjectMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Users } from "lucide-react";
import CfdChart from "@/components/cfd-chart";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";
import { useReportData } from "@/hooks/use-report-data";

type Period = "1m" | "3m";

export default function ProjectReport() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: metrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectMetricsQueryKey(projectId!, period) },
  });

  const {
    loading, error, cfdData, members, timeInStatus, healthScore, qaRejectionRate,
    blockedIssues, sprints, sprintGoal, releaseReadiness, insights,
  } = useReportData(projectId, period);

  if (loading) return <div>{t("common.loading")}</div>;
  if (!project) return <div>{t("page.team.notFound")}</div>;
  if (error) return <div>{error}</div>;

  const sortedTimeInStatus = [...timeInStatus].sort((a: any, b: any) => b.avgDays - a.avgDays);
  const topMembers = [...(members ?? [])].sort((a: any, b: any) => b.issuesResolved - a.issuesResolved).slice(0, 5);
  const closedSprints = [...sprints].filter((s: any) => s.state === "closed");

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
          <h1 className="text-2xl font-bold tracking-tight">{t("page.report.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.report.subtitle")}</p>
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

      <Card>
        <CardHeader>
          <CardTitle>{project.name} — {t("page.report.reportTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground">{period.toUpperCase()} · {new Date().toLocaleDateString()}</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.throughput")}</div>
            <div className="text-xl font-bold">{metrics?.throughput?.toFixed(1) ?? "—"} /wk</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.cycleTime")}</div>
            <div className="text-xl font-bold">{metrics?.cycleTime?.toFixed(1) ?? "—"}d</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.leadTime")}</div>
            <div className="text-xl font-bold">{metrics?.leadTime?.toFixed(1) ?? "—"}d</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.resolved")}</div>
            <div className="text-xl font-bold">{metrics?.resolvedCount ?? "—"}</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.healthScore")}</div>
            <div className="text-xl font-bold">{healthScore ?? "—"}{healthScore !== null ? "/100" : ""}</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.report.qaRejectionRate")}</div>
            <div className="text-xl font-bold">{qaRejectionRate ?? "—"}{qaRejectionRate !== null ? "%" : ""}</div>
          </div>
        </CardContent>
      </Card>

      {sprintGoal && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.sprintGoal")} — {sprintGoal.sprintName}</CardTitle></CardHeader>
          <CardContent><p className="whitespace-pre-line text-sm">{sprintGoal.goal}</p></CardContent>
        </Card>
      )}

      {insights.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.decisionsTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {insights.map((insight: any, i: number) =>
              insight.type === "completionDrop" ? (
                <p key={i} className="text-sm border-l-2 border-destructive pl-3">
                  {insight.previousSprintName} ({insight.previousCompletionRate.toFixed(1)}%) → {insight.currentSprintName} ({insight.currentCompletionRate.toFixed(1)}%): caída de {insight.dropPoints.toFixed(1)} puntos en finalización.
                </p>
              ) : (
                <p key={i} className="text-sm border-l-2 border-destructive pl-3">
                  {insight.metric === "cycleTime" ? t("page.report.cycleTime") : t("page.report.leadTime")} pasó de {insight.previousValue.toFixed(1)}d a {insight.currentValue.toFixed(1)}d — cruzó a estado crítico.
                </p>
              )
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("page.report.blockersTitle")}</CardTitle></CardHeader>
        <CardContent>
          {blockedIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("page.report.blockersEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {blockedIssues.map((b: any) => (
                <div key={b.issueKey} className="border-l-2 border-destructive pl-3 text-sm">
                  <div className="font-medium">{b.issueKey} — {b.summary}</div>
                  <div className="text-muted-foreground">{b.flagReason ?? ""}</div>
                  <div className="text-xs text-muted-foreground">{b.totalDays?.toFixed(1)}d bloqueado</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {releaseReadiness?.configured && releaseReadiness.epics.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.productionTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {releaseReadiness.epics.map((e) => (
              <div key={e.issueKey} className="border-l-2 border-primary pl-3 text-sm">
                <div className="font-medium">{e.issueKey} — {e.summary}</div>
                <div className="text-xs text-muted-foreground">{e.status}{e.assignee ? ` · ${e.assignee}` : ""}</div>
                {e.linkedIssueKeys.length > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("page.report.productionLinkedIssues")}: {e.linkedIssueKeys.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {cfdData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.cfdTitle")}</CardTitle></CardHeader>
          <CardContent className="h-[200px]"><CfdChart data={cfdData} /></CardContent>
        </Card>
      )}

      {topMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1"><Users size={14} />{t("page.report.membersTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.report.memberName")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberResolved")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberCycle")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberPoints")}</th>
                </tr>
              </thead>
              <tbody>
                {topMembers.map((m: any) => (
                  <tr key={m.accountId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{m.displayName}</td>
                    <td className="py-1 text-right">{m.issuesResolved}</td>
                    <td className="py-1 text-right">{m.avgCycleTime?.toFixed(1) ?? "—"}d</td>
                    <td className="py-1 text-right">{m.storyPoints ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {closedSprints.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.sprintsTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">Sprint</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">SP</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">%</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">Cycle Time</th>
                </tr>
              </thead>
              <tbody>
                {closedSprints.map((s: any) => (
                  <tr key={s.sprintId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{s.sprintName}</td>
                    <td className="py-1 text-right">{s.completedStoryPoints}/{s.totalStoryPoints}</td>
                    <td className="py-1 text-right">{s.completionRate.toFixed(1)}%</td>
                    <td className="py-1 text-right">{s.avgCycleTimeDays?.toFixed(1) ?? "—"}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {sortedTimeInStatus.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.report.flowTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.report.flowStatus")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.flowAvgDays")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.flowIssues")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTimeInStatus.slice(0, 6).map((entry: any) => (
                  <tr key={entry.status} className="border-b border-border/50">
                    <td className="py-1 font-medium">{entry.status}</td>
                    <td className="py-1 text-right">{entry.avgDays.toFixed(1)}d</td>
                    <td className="py-1 text-right">{entry.issueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
