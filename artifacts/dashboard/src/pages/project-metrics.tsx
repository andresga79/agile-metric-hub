import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import {
  useGetProject, getGetProjectQueryKey,
  useGetProjectMetrics, getGetProjectMetricsQueryKey,
  type Percentiles, type WeeklyDataPoint, type SlowIssue,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/page-skeleton";
import { ProjectTabs } from "@/components/project-tabs";
import { TimeWindowFilter, type TimeWindow } from "@/components/time-window-filter";
import { useTimeWindow } from "@/hooks/use-time-window";

function days(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} d`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Mean this far above the median means a few extreme tickets are dragging the average. */
const SKEW_RATIO = 1.5;

function TimeRow({ label, avg, p }: { label: string; avg: number; p: Percentiles }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-3 pr-4 font-medium">{label}</td>
      <td className="py-3 px-3 text-right font-mono">{days(avg)}</td>
      <td className="py-3 px-3 text-right font-mono font-semibold">{days(p.p50)}</td>
      <td className="py-3 px-3 text-right font-mono">{days(p.p85)}</td>
      <td className="py-3 px-3 text-right font-mono">{days(p.p95)}</td>
    </tr>
  );
}

function PercentileChart({
  title, data, keys,
}: {
  title: string;
  data: WeeklyDataPoint[];
  keys: { p50: keyof WeeklyDataPoint; p85: keyof WeeklyDataPoint; p95: keyof WeeklyDataPoint };
}) {
  return (
    <Card className="bg-card/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} unit=" d" />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(v: number) => days(v)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey={keys.p50} name="P50" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey={keys.p85} name="P85" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
            <Line type="monotone" dataKey={keys.p95} name="P95" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export default function ProjectMetrics() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const token = localStorage.getItem("auth_token");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const [selectedPeriod, setPeriod] = useTimeWindow(project?.boardType);
  const periodReady = selectedPeriod !== null;
  const period: TimeWindow = selectedPeriod ?? "1m";

  // Same endpoint and window as the Resumen cards, so P50/P95 here and there are the same number.
  const { data: metrics, isLoading: loadingMetrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token && periodReady, queryKey: getGetProjectMetricsQueryKey(projectId!, period) },
  });

  if (loadingProject || !periodReady || loadingMetrics) return <DetailSkeleton />;
  if (!project) return <div className="p-6">{t("page.metrics.notFound")}</div>;

  const lp = metrics?.leadTimePercentiles;
  const cp = metrics?.cycleTimePercentiles;
  const hasData = !!metrics && metrics.resolvedCount > 0 && !!lp && !!cp;
  const buckets = metrics?.velocityByWeek ?? [];
  const slow: SlowIssue[] = metrics?.slowestIssues ?? [];
  const leadSkewed = hasData && lp.p50 > 0 && metrics.leadTime > lp.p50 * SKEW_RATIO;
  const cycleSkewed = hasData && cp.p50 > 0 && metrics.cycleTime > cp.p50 * SKEW_RATIO;
  const bucketLabel = project.boardType === "scrum" && period.endsWith("s") ? t("page.metrics.perSprint") : t("page.metrics.perWeek");

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
          <h1 className="text-2xl font-bold tracking-tight">{t("page.metrics.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.metrics.subtitle")}</p>
        </div>
        <TimeWindowFilter boardType={project.boardType ?? "kanban"} value={period} onChange={setPeriod} />
      </div>

      <ProjectTabs projectId={projectId!} active="health" />

      {!hasData ? (
        <Card className="bg-card/40">
          <CardContent className="p-6 text-sm text-muted-foreground">{t("page.metrics.noData")}</CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">{t("page.metrics.summaryTitle")}</CardTitle>
              <CardDescription>{t("page.metrics.summaryDesc", { count: metrics.resolvedCount })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 text-left font-medium" />
                      <th className="py-2 px-3 text-right font-medium">{t("page.metrics.avg")}</th>
                      <th className="py-2 px-3 text-right font-medium">P50</th>
                      <th className="py-2 px-3 text-right font-medium">P85</th>
                      <th className="py-2 px-3 text-right font-medium">P95</th>
                    </tr>
                  </thead>
                  <tbody>
                    <TimeRow label={t("page.metrics.leadTime")} avg={metrics.leadTime} p={lp} />
                    <TimeRow label={t("page.metrics.cycleTime")} avg={metrics.cycleTime} p={cp} />
                  </tbody>
                </table>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>{t("page.metrics.readP50", { lead: days(lp.p50), cycle: days(cp.p50) })}</li>
                <li>{t("page.metrics.readP85", { lead: days(lp.p85), cycle: days(cp.p85) })}</li>
                <li>{t("page.metrics.readP95", { lead: days(lp.p95), cycle: days(cp.p95) })}</li>
              </ul>
              {(leadSkewed || cycleSkewed) && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
                  <span>
                    {t("page.metrics.skewWarning", {
                      which: [leadSkewed ? t("page.metrics.leadTime") : null, cycleSkewed ? t("page.metrics.cycleTime") : null]
                        .filter(Boolean).join(" / "),
                    })}
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground/80">{t("page.metrics.definitions")}</p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <PercentileChart
              title={`${t("page.metrics.leadTime")} ${bucketLabel}`}
              data={buckets}
              keys={{ p50: "medianLeadTime", p85: "leadTimeP85", p95: "leadTimeP95" }}
            />
            <PercentileChart
              title={`${t("page.metrics.cycleTime")} ${bucketLabel}`}
              data={buckets}
              keys={{ p50: "medianCycleTime", p85: "cycleTimeP85", p95: "cycleTimeP95" }}
            />
          </div>

          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">{t("page.metrics.slowTitle")}</CardTitle>
              <CardDescription>
                {t("page.metrics.slowDesc", { lead: days(lp.p95), cycle: days(cp.p95) })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {slow.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("page.metrics.slowEmpty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 text-left font-medium">{t("page.metrics.colKey")}</th>
                        <th className="py-2 px-3 text-left font-medium">{t("page.metrics.colSummary")}</th>
                        <th className="py-2 px-3 text-left font-medium">{t("page.metrics.colType")}</th>
                        <th className="py-2 px-3 text-left font-medium">{t("page.metrics.colAssignee")}</th>
                        <th className="py-2 px-3 text-right font-medium">{t("page.metrics.colCreated")}</th>
                        <th className="py-2 px-3 text-right font-medium">{t("page.metrics.colResolved")}</th>
                        <th className="py-2 px-3 text-right font-medium">{t("page.metrics.leadTime")}</th>
                        <th className="py-2 pl-3 text-right font-medium">{t("page.metrics.cycleTime")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slow.map((i) => (
                        <tr key={i.key} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{i.key}</td>
                          <td className="py-2 px-3 max-w-[360px] truncate" title={i.summary}>{i.summary}</td>
                          <td className="py-2 px-3 whitespace-nowrap">{i.issueType}</td>
                          <td className="py-2 px-3 whitespace-nowrap">{i.assignee ?? t("page.metrics.unassigned")}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">{shortDate(i.created)}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">{shortDate(i.resolvedAt)}</td>
                          <td className={`py-2 px-3 text-right font-mono whitespace-nowrap ${i.aboveLeadP95 ? "text-red-500 font-semibold" : ""}`}>{days(i.leadTimeDays)}</td>
                          <td className={`py-2 pl-3 text-right font-mono whitespace-nowrap ${i.aboveCycleP95 ? "text-red-500 font-semibold" : ""}`}>{days(i.cycleTimeDays)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
