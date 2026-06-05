import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetProject, getGetProjectQueryKey,
  useGetProjectMetrics, getGetProjectMetricsQueryKey,
  useGetProjectIssues, getGetProjectIssuesQueryKey,
  useGetCurrentUser, getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpRight, ArrowDownRight, Users, HeartPulse, Activity, BarChart3, GitPullRequest, FileText, Target, ShieldAlert } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getSectionLinks, useRolePermissions, canEditSection } from "@/lib/project-section-permissions";

type Period = "1m" | "3m" | "6m";
type SignalLevel = "green" | "yellow" | "red";

function getSignalTone(level: SignalLevel): string {
  if (level === "green") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (level === "yellow") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-rose-500/20 text-rose-400 border-rose-500/30";
}

function getLevelLabel(level: SignalLevel, t: (key: string) => string): string {
  if (level === "green") return t('page.detail.stable');
  if (level === "yellow") return t('page.detail.watch');
  return t('page.detail.risk');
}

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [targets, setTargets] = useState<any[]>([]);
  const [editingTarget, setEditingTarget] = useState<{ metric: string; value: string } | null>(null);
  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId!) }
  });
  const { data: currentUser } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey() },
  });
  const { data: permissions } = useRolePermissions();

  const { data: metrics, isLoading: loadingMetrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId, queryKey: getGetProjectMetricsQueryKey(projectId!, period) }
  });

  const { data: issues, isLoading: loadingIssues } = useGetProjectIssues(projectId!, period, {
    query: { enabled: !!projectId, queryKey: getGetProjectIssuesQueryKey(projectId!, period) }
  });

  const [showAllIssues, setShowAllIssues] = useState(false);
  const visibleIssues = showAllIssues ? (issues ?? []) : (issues ?? []).slice(0, 5);

  const token = localStorage.getItem("auth_token");

  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/targets`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setTargets)
      .catch(console.error);
  }, [projectId, period]);

  const saveTarget = (metric: string) => {
    if (!editingTarget || !projectId) return;
    fetch(`/api/projects/${projectId}/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ metric, targetValue: Number(editingTarget.value), period }),
    })
      .then((r) => r.json())
      .then((t) => {
        setTargets((prev) => {
          const idx = prev.findIndex((x) => x.metric === metric && x.period === period);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = t;
            return next;
          }
          return [...prev, t];
        });
        setEditingTarget(null);
      })
      .catch(console.error);
  };

  const getTarget = (metric: string) => targets.find((t) => t.metric === metric && t.period === period);

  if (loadingProject || loadingMetrics || loadingIssues) return <div>{t('page.detail.loading')}</div>;
  if (!project) return <div>{t('page.detail.notFound')}</div>;

  const renderTrend = (value: number | undefined) => {
    if (value === undefined) return null;
    const isPositive = value >= 0;
    return (
      <span className={`flex items-center text-xs mt-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {isPositive ? <ArrowUpRight size={14} className="mr-1" /> : <ArrowDownRight size={14} className="mr-1" />}
        {Math.abs(value).toFixed(1)}% {t('page.detail.vsPrev')}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-1 rounded">
              {project.key}
            </span>
            {project.methodology && (
              <span className={`text-xs font-semibold px-2 py-1 rounded ${
                project.boardType === 'scrum'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-amber-500/20 text-amber-400'
              }`}>
                {project.methodology}
              </span>
            )}
            <span className="text-sm text-muted-foreground">{project.projectType}</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          {project.description && <p className="text-muted-foreground mt-1 max-w-2xl">{project.description}</p>}
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          {getSectionLinks(currentUser?.role, project.id, permissions ?? [], project.boardType).map((link) => {
            const iconMap: Record<string, React.ReactNode> = {
              team: <Users size={14} />,
              health: <HeartPulse size={14} />,
              analytics: <BarChart3 size={14} />,
              flow: <GitPullRequest size={14} />,
              forecast: <Activity size={14} />,
              report: <FileText size={14} />,
              sprints: <BarChart3 size={14} />,
              kanban: <BarChart3 size={14} />,
              "qa-rejected": <ShieldAlert size={14} />,
            };
            return (
              <Link key={link.section} href={link.href} className="flex items-center gap-1.5 text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md transition-colors">
                {iconMap[link.section] ?? null}
                {link.label}
              </Link>
            );
          })}
          <div className="flex bg-background border border-border rounded-md p-1">
            {(['1m', '3m', '6m'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                  period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`grid gap-4 md:grid-cols-2 ${metrics?.isScrum ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {metrics?.isScrum && (
          <Card className="bg-card/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.detail.velocity')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{(metrics?.velocity ?? 0).toFixed(1)}</div>
              {renderTrend(metrics?.velocityTrend)}
            </CardContent>
          </Card>
        )}

        <Card className="bg-card/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.detail.leadTime')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{(metrics?.leadTime ?? 0).toFixed(1)}d</div>
            <p className="text-xs text-muted-foreground mt-1">{t('page.detail.leadTimeDesc')}</p>
            {metrics?.leadTimePercentiles && (
              <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                <span>P50 <strong className="text-foreground">{metrics.leadTimePercentiles.p50.toFixed(1)}d</strong></span>
                <span>P75 <strong className="text-foreground">{metrics.leadTimePercentiles.p75.toFixed(1)}d</strong></span>
                <span>P85 <strong className="text-foreground">{metrics.leadTimePercentiles.p85.toFixed(1)}d</strong></span>
                <span>P95 <strong className="text-foreground">{metrics.leadTimePercentiles.p95.toFixed(1)}d</strong></span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.detail.cycleTime')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{(metrics?.cycleTime ?? 0).toFixed(1)}d</div>
            <p className="text-xs text-muted-foreground mt-1">{t('page.detail.cycleTimeDesc')}</p>
            {metrics?.cycleTimePercentiles && (
              <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                <span>P50 <strong className="text-foreground">{metrics.cycleTimePercentiles.p50.toFixed(1)}d</strong></span>
                <span>P75 <strong className="text-foreground">{metrics.cycleTimePercentiles.p75.toFixed(1)}d</strong></span>
                <span>P85 <strong className="text-foreground">{metrics.cycleTimePercentiles.p85.toFixed(1)}d</strong></span>
                <span>P95 <strong className="text-foreground">{metrics.cycleTimePercentiles.p95.toFixed(1)}d</strong></span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.detail.throughput')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{(metrics?.throughput ?? 0).toFixed(1)}</div>
            {renderTrend(metrics?.throughputTrend)}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/40 md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">{metrics?.isScrum ? t('page.detail.velocityTrend') : t('page.detail.throughputTrend')}</CardTitle>
            <CardDescription>{metrics?.isScrum ? t('page.detail.velocityTrendDesc') : t('page.detail.throughputTrendDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics?.velocityByWeek || []}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                  itemStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorValue)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-lg">{t('page.detail.recentIssues')}</CardTitle>
              {(issues?.length ?? 0) > 4 && (
                <button
                  className="text-xs px-2 py-1 rounded border border-border hover:bg-accent transition-colors"
                  onClick={() => setShowAllIssues((value) => !value)}
                >
                  {showAllIssues ? t('page.detail.showLess') : t('page.detail.showAll', { count: issues?.length ?? 0 })}
                </button>
              )}
            </div>
            <CardDescription>{t('page.detail.latestTracked')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.detail.key')}</TableHead>
                    <TableHead>{t('page.detail.summary')}</TableHead>
                    <TableHead>{t('page.detail.status')}</TableHead>
                    <TableHead className="text-right">{t('page.detail.points')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleIssues.map((issue) => (
                    <TableRow key={issue.id} className="border-border hover:bg-accent/50">
                      <TableCell className="font-mono text-xs text-primary">{issue.key}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={issue.summary}>{issue.summary}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-1 rounded-full ${issue.status === 'Done' ? 'bg-green-500/20 text-green-400' : 'bg-secondary text-secondary-foreground'}`}>
                          {issue.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">{issue.storyPoints || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target size={20} />
            {t('page.detail.targetTitle')}
          </CardTitle>
          <CardDescription>{t('page.detail.targetDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(metrics?.isScrum
              ? ["leadTime", "cycleTime", "throughput", "velocity"]
              : ["leadTime", "cycleTime", "throughput"]
            ).map((metric) => {
              const targetEntry = getTarget(metric);
              const actual = metric === "leadTime" ? metrics?.leadTime
                : metric === "cycleTime" ? metrics?.cycleTime
                : metric === "throughput" ? metrics?.throughput
                : metrics?.velocity;
              const targetVal = targetEntry ? Number(targetEntry.targetValue) : null;
              const isEditing = editingTarget?.metric === metric;
              const isLowerBetter = metric === "leadTime" || metric === "cycleTime";
              const onTrack = targetVal !== null && actual !== undefined && actual !== null
                ? isLowerBetter ? actual <= targetVal : actual >= targetVal
                : null;
              return (
                <div key={metric} className="rounded-lg border border-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-muted-foreground capitalize">{metric.replace(/([A-Z])/g, " $1").trim()}</div>
                    {canEditSection(currentUser?.role, "targets", permissions ?? []) && (
                      !isEditing ? (
                        <button
                          onClick={() => setEditingTarget({ metric, value: String(targetVal ?? "") })}
                          className="text-xs text-primary hover:underline"
                        >
                          {targetVal !== null ? t('page.detail.edit') : t('page.detail.setTarget')}
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditingTarget(null)}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {t('page.detail.cancel')}
                        </button>
                      )
                    )}
                  </div>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.1"
                        value={editingTarget!.value}
                        onChange={(e) => setEditingTarget({ metric, value: e.target.value })}
                        className="w-full bg-background border border-border rounded px-2 py-1 text-sm"
                        placeholder={t('page.detail.targetValue')}
                        autoFocus
                      />
                      <button
                        onClick={() => saveTarget(metric)}
                        className="bg-primary text-primary-foreground px-2 py-1 rounded text-xs"
                      >
                        {t('page.detail.save')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-2xl font-bold">
                        {actual !== undefined && actual !== null ? `${Number(actual).toFixed(1)}` : "—"}
                        <span className="text-sm font-normal text-muted-foreground ml-1">{metric === "leadTime" || metric === "cycleTime" ? "d" : ""}</span>
                      </div>
                      {targetVal !== null && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            onTrack ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                          }`}>
                            {onTrack ? t('page.detail.onTrack') : t('page.detail.behind')}
                          </span>
                          <span className="text-xs text-muted-foreground">{t('page.detail.target')} {targetVal}{metric === "leadTime" || metric === "cycleTime" ? "d" : ""}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-lg">{t('page.detail.doraTitle')}</CardTitle>
          <CardDescription>{t('page.detail.doraDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('page.detail.deploymentFreq')}</div>
              <div className="text-2xl font-bold">{metrics?.dora.deploymentFrequency.toFixed(1)}<span className="text-sm font-normal text-muted-foreground"> /week</span></div>
              <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded ${
                metrics?.dora.classification.deploymentFrequency === 'elite' ? 'bg-green-500/20 text-green-400' :
                metrics?.dora.classification.deploymentFrequency === 'high' ? 'bg-blue-500/20 text-blue-400' :
                metrics?.dora.classification.deploymentFrequency === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {metrics?.dora.classification.deploymentFrequency}
              </span>
              <p className="text-xs text-muted-foreground mt-1">{t('page.detail.deploymentFreqDesc')}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('page.detail.leadTimeChanges')}</div>
              <div className="text-2xl font-bold">{(metrics?.dora.leadTimeForChanges ?? 0).toFixed(1)}<span className="text-sm font-normal text-muted-foreground">d</span></div>
              <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded ${
                metrics?.dora.classification.leadTimeForChanges === 'elite' ? 'bg-green-500/20 text-green-400' :
                metrics?.dora.classification.leadTimeForChanges === 'high' ? 'bg-blue-500/20 text-blue-400' :
                metrics?.dora.classification.leadTimeForChanges === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {metrics?.dora.classification.leadTimeForChanges}
              </span>
              <p className="text-xs text-muted-foreground mt-1">{t('page.detail.leadTimeChangesDesc')}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('page.detail.changeFailureRate')}</div>
              <div className="text-2xl font-bold">{(metrics?.dora.changeFailureRate ?? 0).toFixed(1)}<span className="text-sm font-normal text-muted-foreground">%</span></div>
              <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded ${
                metrics?.dora.classification.changeFailureRate === 'elite' ? 'bg-green-500/20 text-green-400' :
                metrics?.dora.classification.changeFailureRate === 'high' ? 'bg-blue-500/20 text-blue-400' :
                metrics?.dora.classification.changeFailureRate === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {metrics?.dora.classification.changeFailureRate}
              </span>
              <p className="text-xs text-muted-foreground mt-1">{t('page.detail.changeFailureRateDesc')}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium text-muted-foreground mb-1">{t('page.detail.mttr')}</div>
              <div className="text-2xl font-bold">{(metrics?.dora.mttr ?? 0).toFixed(1)}<span className="text-sm font-normal text-muted-foreground">d</span></div>
              <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded ${
                metrics?.dora.classification.mttr === 'elite' ? 'bg-green-500/20 text-green-400' :
                metrics?.dora.classification.mttr === 'high' ? 'bg-blue-500/20 text-blue-400' :
                metrics?.dora.classification.mttr === 'medium' ? 'bg-amber-500/20 text-amber-400' :
                'bg-red-500/20 text-red-400'
              }`}>
                {metrics?.dora.classification.mttr}
              </span>
              <p className="text-xs text-muted-foreground mt-1">{t('page.detail.mttrDesc')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
