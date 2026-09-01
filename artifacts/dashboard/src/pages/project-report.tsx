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

// Same 0-100 banding convention project-health.tsx uses for its dimension scores:
// >=70 good, >=40 warning, below that critical.
function dimensionBand(value: number | undefined): "critical" | "warning" | "good" | null {
  if (typeof value !== "number") return null;
  if (value >= 70) return "good";
  if (value >= 40) return "warning";
  return "critical";
}

const BAND_CLASSES: Record<"critical" | "warning" | "good", string> = {
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  good: "bg-green-500/10 text-green-600 dark:text-green-400",
};

function Kpi({ label, value, dimensionValue }: { label: string; value: string; dimensionValue?: number }) {
  const band = dimensionBand(dimensionValue);
  return (
    <div className="border border-border rounded p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {band && (
        <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${BAND_CLASSES[band]}`}>
          {band}
        </span>
      )}
    </div>
  );
}

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
    structuralBottleneck, nextSteps, featuredIssues, healthDimensions,
  } = useReportData(projectId, period);

  if (loading) return <div>{t("common.loading")}</div>;
  if (!project) return <div>{t("page.team.notFound")}</div>;
  if (error) return <div>{error}</div>;

  const sortedTimeInStatus = [...timeInStatus].sort((a: any, b: any) => b.avgDays - a.avgDays);
  const topMembers = [...(members ?? [])].sort((a: any, b: any) => b.issuesResolved - a.issuesResolved).slice(0, 5);
  const closedSprints = [...sprints].filter((s: any) => s.state === "closed");
  const activeSprint = sprints.find((s: any) => s.state === "active");
  const sortedBlockedIssues = [...blockedIssues].sort((a: any, b: any) => b.totalDays - a.totalDays);

  const dimensionValue = (name: string) => healthDimensions.find((d: any) => d.name === name)?.value;

  // The oldest-blocker step is a plain sort-and-pick, not a threshold rule, so it's composed
  // here from data the hook already has, rather than duplicating blockedIssues detection
  // (~250 lines in analytics.ts, DB-backed manual overrides) inside /report-insights just to
  // reuse it. See the plan's Task 7 note for the full reasoning.
  const oldestBlockerStep = sortedBlockedIssues[0]
    ? [{
        type: "oldestBlocker",
        text: t("page.report.oldestBlockerStep", {
          key: sortedBlockedIssues[0].key,
          summary: sortedBlockedIssues[0].summary,
          days: sortedBlockedIssues[0].totalDays?.toFixed(1),
        }),
      }]
    : [];
  const allNextSteps = [...oldestBlockerStep, ...nextSteps];

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
          <p className="text-xs font-mono uppercase tracking-wide text-primary mb-1">
            {project.key} · {project.boardType === "scrum" ? "Scrum" : "Kanban"} · Software
          </p>
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
          <Kpi label={t("page.report.throughput")} value={`${metrics?.throughput?.toFixed(1) ?? "—"} /wk`} dimensionValue={dimensionValue("Throughput")} />
          <Kpi label={t("page.report.cycleTime")} value={`${metrics?.cycleTime?.toFixed(1) ?? "—"}d`} dimensionValue={dimensionValue("Cycle Time")} />
          <Kpi label={t("page.report.leadTime")} value={`${metrics?.leadTime?.toFixed(1) ?? "—"}d`} dimensionValue={dimensionValue("Lead Time")} />
          <Kpi label={t("page.report.resolved")} value={`${metrics?.resolvedCount ?? "—"}`} />
          <Kpi label={t("page.report.healthScore")} value={`${healthScore ?? "—"}${healthScore !== null ? "/100" : ""}`} dimensionValue={dimensionValue("Flow Health Score")} />
          <Kpi label={t("page.report.qaRejectionRate")} value={`${qaRejectionRate ?? "—"}${qaRejectionRate !== null ? "%" : ""}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>01 · {t("page.report.advancesTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {[...closedSprints, ...(activeSprint ? [activeSprint] : [])].map((s: any) => (
            <div key={s.sprintId}>
              <h3 className="text-sm font-bold mb-1">
                {s.sprintName} {s.state === "active" ? "— en curso" : "— cerrado"}
              </h3>
              {s.state === "closed" ? (
                <p className="text-sm text-muted-foreground">
                  {s.completedStoryPoints} de {s.totalStoryPoints} SP completados ({s.completionRate.toFixed(1)}%), cycle time {s.avgCycleTimeDays?.toFixed(1) ?? "—"}d
                  {s.reopenedCount > 0 ? `, ${s.reopenedCount} reabierto(s)` : ""}
                  {s.carryoverCount > 0 ? `, carryover de ${s.carryoverCount} issues (${s.carryoverStoryPoints} SP) al sprint siguiente` : ""}.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {s.completedIssues} de {s.totalIssues} issues resueltos ({s.completionRate.toFixed(1)}%) hasta la fecha.
                </p>
              )}
            </div>
          ))}

          {sprintGoal && (
            <div className="border-l-2 border-primary pl-3">
              <p className="text-sm"><strong>{t("page.report.sprintGoal")}</strong> ({sprintGoal.sprintName}): {sprintGoal.goal}</p>
            </div>
          )}

          {featuredIssues.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-1">{t("page.report.featuredTitle")}</h3>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {featuredIssues.map((f: any) => (
                  <li key={f.key}>
                    <strong className="text-foreground">{f.key}</strong> — {f.summary}
                    {f.assignee ? ` (${f.assignee})` : ""} · {f.storyPoints} SP
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>02 · {t("page.report.decisionsTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="border border-border rounded p-3 bg-muted/30">
            <p className="text-xs font-semibold mb-1">{t("page.report.scopeNoteTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("page.report.scopeNoteBody")}</p>
          </div>
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

      <Card>
        <CardHeader><CardTitle>03 · {t("page.report.blockersTitle")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {sortedBlockedIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("page.report.blockersEmpty")}</p>
          ) : (
            <div className="space-y-2">
              {sortedBlockedIssues.map((b: any, i: number) => (
                <div key={b.key} className="border-l-2 border-destructive pl-3 text-sm">
                  <div className="font-medium">
                    {b.key} — {b.summary}
                    {i === 0 && (
                      <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                        {t("page.report.oldestBlockerBadge")}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground">{b.flagReason ?? ""}</div>
                  <div className="text-xs text-muted-foreground">{b.totalDays?.toFixed(1)}d bloqueado</div>
                </div>
              ))}
            </div>
          )}
          {structuralBottleneck && (
            <p className="text-sm text-muted-foreground pt-2">
              El estado <strong className="text-foreground">"{structuralBottleneck.status}"</strong> concentra el {structuralBottleneck.sharePercent.toFixed(0)}% del tiempo total de flujo del período ({structuralBottleneck.avgDays.toFixed(1)}d promedio, {structuralBottleneck.issueCount} issues).
            </p>
          )}
        </CardContent>
      </Card>

      {allNextSteps.length > 0 && (
        <Card>
          <CardHeader><CardTitle>04 · {t("page.report.nextStepsTitle")}</CardTitle></CardHeader>
          <CardContent>
            <ol className="text-sm space-y-2 list-decimal pl-5">
              {allNextSteps.map((step: any, i: number) => (
                <li key={i}>{step.text}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {releaseReadiness?.configured && releaseReadiness.epics.length > 0 && (
        <Card>
          <CardHeader><CardTitle>05 · {t("page.report.productionTitle")}</CardTitle></CardHeader>
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
          <CardHeader><CardTitle>06 · {t("page.report.sprintsTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">Sprint</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">SP</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">%</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">Cycle Time</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.reopenedLabel")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.carryoverLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {closedSprints.map((s: any) => (
                  <tr key={s.sprintId} className="border-b border-border/50">
                    <td className="py-1 font-medium">{s.sprintName}</td>
                    <td className="py-1 text-right">{s.completedStoryPoints}/{s.totalStoryPoints}</td>
                    <td className="py-1 text-right">{s.completionRate.toFixed(1)}%</td>
                    <td className="py-1 text-right">{s.avgCycleTimeDays?.toFixed(1) ?? "—"}d</td>
                    <td className="py-1 text-right">{s.reopenedCount}</td>
                    <td className="py-1 text-right">{s.carryoverCount}</td>
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
