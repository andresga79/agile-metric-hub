import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";
import { useMemberReportData } from "@/hooks/use-member-report-data";

type Period = "1m" | "3m";

// Same 0-100 banding convention project-report.tsx / project-health.tsx use for dimension scores:
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

function TrendBadge({ pct, lowerBetter, label }: { pct: number; lowerBetter: boolean; label: string }) {
  const isUp = pct >= 0;
  const improving = isUp !== lowerBetter;
  return (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
        improving ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-red-500/15 text-red-600 dark:text-red-400"
      }`}>
        {isUp ? "↑" : "↓"} {Math.abs(pct).toFixed(1)}%
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function Kpi({
  label, value, dimensionValue, trendPct, trendLowerBetter, trendLabel,
}: {
  label: string;
  value: string;
  dimensionValue?: number;
  trendPct?: number;
  trendLowerBetter?: boolean;
  trendLabel?: string;
}) {
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
      {typeof trendPct === "number" && trendLabel && (
        <TrendBadge pct={trendPct} lowerBetter={trendLowerBetter ?? false} label={trendLabel} />
      )}
    </div>
  );
}

export default function ProjectMemberReport() {
  const { t } = useTranslation();
  const { projectId, accountId } = useParams<{ projectId: string; accountId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const {
    loading, error, members, memberIssues, timeInStatus, metrics, trends, healthScore, qaRejectionRate,
    blockedIssues, healthDimensions,
  } = useMemberReportData(projectId, accountId, period);

  if (loading) return <div>{t("common.loading")}</div>;
  if (!project) return <div>{t("page.team.notFound")}</div>;
  if (error) return <div>{error}</div>;

  const member = members.find((m: any) => m.accountId === accountId);
  const sortedTimeInStatus = [...timeInStatus].sort((a: any, b: any) => b.avgDays - a.avgDays);
  const sortedBlockedIssues = [...blockedIssues].sort((a: any, b: any) => b.totalDays - a.totalDays);

  // --- Estado actual: mismas claves que muestra Rovo, agrupadas por bucket de estado ---
  const inDevelopment = memberIssues.filter((i: any) => i.isInProgress);
  const pending = memberIssues.filter((i: any) => !i.isInProgress && !i.isDone);
  const finished = memberIssues.filter((i: any) => i.isDone);

  // --- Desglose por tipo (Historia/Tarea/Bug/Epic/...), con lead/cycle time promedio por tipo ---
  const avgOf = (values: (number | null)[]) => {
    const valid = values.filter((v): v is number => v !== null);
    return valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null;
  };
  const typeBreakdown = Object.entries(
    memberIssues.reduce((acc: Record<string, any[]>, i: any) => {
      (acc[i.mappedType] ??= []).push(i);
      return acc;
    }, {})
  )
    .map(([type, items]) => ({
      type,
      count: items.length,
      storyPoints: items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
      avgCycleTime: avgOf(items.map((i) => i.cycleTimeDays)),
      avgLeadTime: avgOf(items.map((i) => i.leadTimeDays)),
    }))
    .sort((a, b) => b.count - a.count);

  // --- Defectos: histórico completo (no solo lo resuelto en el período), a diferencia del
  // "Tasa de Rechazo QA" de arriba, que mide reversiones QA->Dev, no bugs asignados. ---
  const bugs = memberIssues.filter((i: any) => i.mappedType === "Bug");
  const bugsResolved = bugs.filter((i: any) => i.isDone).length;
  const bugsActive = bugs.length - bugsResolved;
  const dimensionValue = (name: string) => healthDimensions.find((d: any) => d.name === name)?.value;
  const displayName = member?.displayName ?? accountId;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}/team`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {t("page.memberReport.backTo")} {project.name}
            </Link>
          </div>
          <p className="text-xs font-mono uppercase tracking-wide text-primary mb-1">
            {project.key} · {displayName}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.memberReport.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.memberReport.subtitle")} {displayName}</p>
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

      <ProjectTabs projectId={projectId!} active="team" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {member?.avatarUrl && (
              <img src={member.avatarUrl} alt={displayName} className="w-6 h-6 rounded-full object-cover" />
            )}
            {t("page.memberReport.reportTitle")} {displayName}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{period.toUpperCase()} · {new Date().toLocaleDateString()}</p>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Kpi label={t("page.report.throughput")} value={`${metrics?.throughput?.toFixed(1) ?? "—"} /wk`} dimensionValue={dimensionValue("Throughput")} />
          <Kpi
            label={t("page.report.cycleTime")}
            value={`${metrics?.cycleTime?.toFixed(1) ?? "—"}d`}
            dimensionValue={dimensionValue("Cycle Time")}
            trendPct={trends?.cycleTime}
            trendLowerBetter
            trendLabel={t("page.detail.vsPrev")}
          />
          <Kpi
            label={t("page.report.leadTime")}
            value={`${metrics?.leadTime?.toFixed(1) ?? "—"}d`}
            dimensionValue={dimensionValue("Lead Time")}
            trendPct={trends?.leadTime}
            trendLowerBetter
            trendLabel={t("page.detail.vsPrev")}
          />
          <Kpi
            label={t("page.report.resolved")}
            value={`${metrics?.resolvedCount ?? "—"}`}
            trendPct={trends?.resolvedCount}
            trendLabel={t("page.detail.vsPrev")}
          />
          <Kpi label={t("page.report.healthScore")} value={`${healthScore ?? "—"}${healthScore !== null ? "/100" : ""}`} dimensionValue={dimensionValue("Flow Health Score")} />
          <Kpi label={t("page.report.qaRejectionRate")} value={`${qaRejectionRate ?? "—"}${qaRejectionRate !== null ? "%" : ""}`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("page.memberReport.statusTitle")}</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-4">
          {[
            { label: t("page.memberReport.statusInDev"), items: inDevelopment },
            { label: t("page.memberReport.statusPending"), items: pending },
            { label: t("page.memberReport.statusFinished"), items: finished },
          ].map(({ label, items }) => (
            <div key={label}>
              <div className="text-xs text-muted-foreground mb-1">{label} ({items.length})</div>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("page.report.blockersEmpty")}</p>
              ) : (
                <ul className="text-xs space-y-1">
                  {items.slice(0, 8).map((i: any) => (
                    <li key={i.id} className="truncate">
                      <span className="font-mono text-primary mr-1">{i.key}</span>
                      <span className="text-muted-foreground">{i.summary}</span>
                    </li>
                  ))}
                  {items.length > 8 && (
                    <li className="text-muted-foreground">+{items.length - 8} {t("page.team.more")}</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {typeBreakdown.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("page.memberReport.breakdownTitle")}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1 text-muted-foreground font-medium">{t("page.memberReport.breakdownType")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.memberReport.breakdownCount")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.memberPoints")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.cycleTime")}</th>
                  <th className="text-right py-1 text-muted-foreground font-medium">{t("page.report.leadTime")}</th>
                </tr>
              </thead>
              <tbody>
                {typeBreakdown.map((row) => (
                  <tr key={row.type} className="border-b border-border/50">
                    <td className="py-1 font-medium">{row.type}</td>
                    <td className="py-1 text-right">{row.count}</td>
                    <td className="py-1 text-right">{row.storyPoints || "—"}</td>
                    <td className="py-1 text-right">{row.avgCycleTime !== null ? `${row.avgCycleTime}d` : "—"}</td>
                    <td className="py-1 text-right">{row.avgLeadTime !== null ? `${row.avgLeadTime}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("page.memberReport.defectsTitle")}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-4">
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.memberReport.defectsAssigned")}</div>
            <div className="text-xl font-bold">{bugs.length}</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.memberReport.defectsResolved")}</div>
            <div className="text-xl font-bold">{bugsResolved}</div>
          </div>
          <div className="border border-border rounded p-3">
            <div className="text-xs text-muted-foreground">{t("page.memberReport.defectsActive")}</div>
            <div className={`text-xl font-bold ${bugsActive > 0 ? "text-red-400" : ""}`}>{bugsActive}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("page.report.blockersTitle")}</CardTitle></CardHeader>
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
        </CardContent>
      </Card>

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
