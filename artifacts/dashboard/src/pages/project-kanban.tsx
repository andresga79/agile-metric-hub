import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectKanbanMetrics, getGetProjectKanbanMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp, Clock, BarChart3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

type Period = "1m" | "3m" | "6m";

function days(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}d`;
}

export default function ProjectKanban() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("3m");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { data, isLoading } = useGetProjectKanbanMetrics(projectId!, period, {
    query: { enabled: !!projectId, queryKey: getGetProjectKanbanMetricsQueryKey(projectId!, period) },
  });

  if (isLoading || loadingProject) return <div>{t('page.kanban.loading')}</div>;
  if (!project) return <div>{t('page.kanban.notFound')}</div>;

  const weeks = data?.weeks ?? [];
  const summary = data?.summary;

  const chartData = weeks.map((w) => ({
    label: w.weekLabel.split(" - ")[0] ?? w.weekLabel,
    throughput: w.totalIssues,
    cycleTime: w.avgCycleTimeDays ? Number(w.avgCycleTimeDays.toFixed(1)) : null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${project.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={18} />
            </Link>
            {project && (
              <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-1 rounded">
                {project.key}
              </span>
            )}
            <span className="text-xs font-semibold bg-amber-500/20 text-amber-400 px-2 py-1 rounded">{t('page.kanban.kanban')}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t('page.kanban.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('page.kanban.subtitle')}</p>
        </div>
        <div className="flex bg-background border border-border rounded-md p-1">
          {(["1m", "3m", "6m"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {weeks.length === 0 ? (
        <Card className="bg-card/40">
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('page.kanban.noData')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <BarChart3 size={14} /> {t('page.kanban.totalWeeks')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary?.totalWeeks ?? 0}</div>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <TrendingUp size={14} /> {t('page.kanban.avgThroughput')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{(summary?.avgThroughput ?? 0).toFixed(1)}</div>
                <p className="text-xs text-muted-foreground mt-1">{summary?.totalCompletedIssues ?? 0} {t('page.kanban.totalDone')}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock size={14} /> {t('page.kanban.avgCycleTime')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{days(summary?.avgCycleTimeDays ?? null)}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('page.kanban.daysStartToDone')}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">{t('page.kanban.throughputPerWeek')}</CardTitle>
                <CardDescription>{t('page.kanban.throughputPerWeekDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Bar dataKey="throughput" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Throughput" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">{t('page.kanban.cycleTimeTrend')}</CardTitle>
                <CardDescription>{t('page.kanban.cycleTimeTrendDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Line type="monotone" dataKey="cycleTime" stroke="hsl(142, 76%, 36%)" strokeWidth={2} dot={{ fill: 'hsl(142, 76%, 36%)' }} name="Cycle Time (d)" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">{t('page.kanban.weeklyBreakdown')}</CardTitle>
              <CardDescription>{t('page.kanban.weeklyBreakdownDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.kanban.week')}</TableHead>
                    <TableHead className="text-right">{t('page.kanban.issuesDone')}</TableHead>
                    <TableHead className="text-right">{t('page.kanban.throughput')}</TableHead>
                    <TableHead className="text-right">{t('page.kanban.cycleTime')}</TableHead>
                    <TableHead className="text-right">{t('page.kanban.reopened')}</TableHead>
                    <TableHead className="text-right">{t('page.kanban.breakdown')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...weeks].reverse().map((w) => (
                      <TableRow key={w.weekStart} className="border-border hover:bg-accent/50">
                        <TableCell className="font-medium">{w.weekLabel}</TableCell>
                        <TableCell className="text-right font-mono">{w.totalIssues}</TableCell>
                        <TableCell className="text-right font-mono font-bold">{w.totalIssues}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{days(w.avgCycleTimeDays)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {w.reopenedCount > 0 ? (
                            <span className="text-red-400">{w.reopenedCount}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          <span className="text-blue-400">{w.breakdown.Story}</span>S /
                          <span className="text-red-400">{w.breakdown.Bug}</span>B /
                          <span className="text-green-400">{w.breakdown.Task}</span>T /
                          <span className="text-purple-400">{w.breakdown.Epic}</span>E
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
