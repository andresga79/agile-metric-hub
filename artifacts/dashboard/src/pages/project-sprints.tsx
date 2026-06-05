import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectSprintMetrics, getGetProjectSprintMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Gauge, CheckCircle2, RotateCcw, Clock, BarChart3, Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type Period = "1m" | "3m" | "6m";

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function days(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}d`;
}

export default function ProjectSprints() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("3m");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { data, isLoading } = useGetProjectSprintMetrics(projectId!, period, {
    query: { enabled: !!projectId, queryKey: getGetProjectSprintMetricsQueryKey(projectId!, period) },
  });

  if (isLoading || loadingProject) return <div>{t('page.sprints.loading')}</div>;
  if (!project) return <div>{t('page.sprints.notFound')}</div>;

  const sprints = data?.sprints ?? [];
  const summary = data?.summary;

  const chartData = [...sprints].reverse().map((s) => ({
    name: s.sprintName.replace(/^.*\s/, "S"),
    velocity: s.velocity,
    completionRate: s.completionRate,
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
            <span className="text-xs font-semibold bg-blue-500/20 text-blue-400 px-2 py-1 rounded">{t('page.sprints.scrum')}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{t('page.sprints.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('page.sprints.subtitle')}</p>
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

      {sprints.length === 0 ? (
        <Card className="bg-card/40">
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('page.sprints.noSprints')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Layers size={14} /> {t('page.sprints.totalSprints')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary?.totalSprints ?? 0}</div>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Gauge size={14} /> {t('page.sprints.avgVelocity')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{(summary?.avgVelocity ?? 0).toFixed(1)}</div>
                <p className="text-xs text-muted-foreground mt-1">{summary?.totalCompletedStoryPoints.toFixed(0)} {t('page.sprints.totalSpDelivered')}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> {t('page.sprints.avgCompletion')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{pct(summary?.avgCompletionRate ?? 0)}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('page.sprints.pctCompleted')}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock size={14} /> {t('page.sprints.avgCycleTime')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{days(summary?.avgCycleTimeDays ?? null)}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('page.sprints.daysStartToDone')}</p>
              </CardContent>
            </Card>
          </div>

          {chartData.length > 0 && (
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">{t('page.sprints.velocityTrend')}</CardTitle>
                <CardDescription>{t('page.sprints.velocityTrendDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Area yAxisId="left" type="monotone" dataKey="velocity" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorVelocity)" name="Velocity (SP)" />
                    <Area yAxisId="right" type="monotone" dataKey="completionRate" stroke="hsl(142, 76%, 36%)" fillOpacity={0.1} fill="hsl(142, 76%, 36%)" name="Completion %" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">{t('page.sprints.breakdown')}</CardTitle>
              <CardDescription>{t('page.sprints.breakdownDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.sprints.sprint')}</TableHead>
                    <TableHead>{t('page.sprints.state')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.issues')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.spPlanned')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.spDone')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.completion')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.reopened')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.cycleTime')}</TableHead>
                    <TableHead className="text-right">{t('page.sprints.breakdownCol')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sprints.map((s) => (
                      <TableRow key={s.sprintId} className="border-border hover:bg-accent/50">
                        <TableCell className="font-medium">{s.sprintName}</TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            s.state === "active"
                              ? "bg-blue-500/20 text-blue-400"
                              : s.state === "closed"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-secondary text-secondary-foreground"
                          }`}>
                            {s.state}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {s.completedIssues}/{s.totalIssues}
                        </TableCell>
                        <TableCell className="text-right font-mono">{s.totalStoryPoints.toFixed(0)}</TableCell>
                        <TableCell className="text-right font-mono">{s.completedStoryPoints.toFixed(0)}</TableCell>
                        <TableCell className="text-right">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            s.completionRate >= 80 ? "bg-green-500/20 text-green-400" :
                            s.completionRate >= 50 ? "bg-orange-500/20 text-orange-400" :
                            "bg-red-500/20 text-red-400"
                          }`}>
                            {pct(s.completionRate)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {s.reopenedCount > 0 ? (
                            <span className="text-red-400">{s.reopenedCount}</span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{days(s.avgCycleTimeDays)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          <span className="text-blue-400">{s.breakdown.Story}</span>S /
                          <span className="text-red-400">{s.breakdown.Bug}</span>B /
                          <span className="text-green-400">{s.breakdown.Task}</span>T /
                          <span className="text-purple-400">{s.breakdown.Epic}</span>E
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
