import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetProject, getGetProjectQueryKey,
  useGetProjectMetrics, getGetProjectMetricsQueryKey,
  useGetCurrentUser, getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DetailSkeleton } from "@/components/page-skeleton";
import { describeTrend, isImproving } from "@/lib/trend-analysis";
import { ArrowUpRight, ArrowDownRight, ChevronDown, BarChart3, HeartPulse, GitPullRequest, Activity, Users, FileText, ShieldAlert, PencilLine } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getSectionLinks, useRolePermissions, canEditSection } from "@/lib/project-section-permissions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Period = "1m" | "3m" | "6m";

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

  if (loadingProject || loadingMetrics) return <DetailSkeleton />;
  if (!project) return <div>{t('page.detail.notFound')}</div>;

  const sectionLinks = getSectionLinks(currentUser?.role, project.id, permissions ?? [], project.boardType);

  const primaryTabSections = ['sprints', 'kanban', 'flow', 'health', 'forecast'];
  const secondaryTabSections = ['team', 'analytics', 'report', 'qa-rejected'];

  const primaryLinks = sectionLinks.filter(l => primaryTabSections.includes(l.section));
  const secondaryLinks = sectionLinks.filter(l => secondaryTabSections.includes(l.section));

  const tabIconMap: Record<string, React.ReactNode> = {
    sprints: <BarChart3 size={16} />,
    kanban: <BarChart3 size={16} />,
    flow: <GitPullRequest size={16} />,
    health: <HeartPulse size={16} />,
    forecast: <Activity size={16} />,
  };

  const dropdownIconMap: Record<string, React.ReactNode> = {
    team: <Users size={14} />,
    analytics: <BarChart3 size={14} />,
    report: <FileText size={14} />,
    "qa-rejected": <ShieldAlert size={14} />,
  };

  const metricInfo = (metric: string) => {
    const actual = metric === "leadTime" ? metrics?.leadTime
      : metric === "cycleTime" ? metrics?.cycleTime
      : metric === "throughput" ? metrics?.throughput
      : metrics?.velocity;
    const targetEntry = getTarget(metric);
    const targetVal = targetEntry ? Number(targetEntry.targetValue) : null;
    const isLowerBetter = metric === "leadTime" || metric === "cycleTime";
    const onTrack = targetVal !== null && actual !== undefined && actual !== null
      ? isLowerBetter ? actual <= targetVal : actual >= targetVal
      : null;
    const isEditing = editingTarget?.metric === metric;
    const label = metric === "leadTime" ? t('page.detail.leadTime')
      : metric === "cycleTime" ? t('page.detail.cycleTime')
      : metric === "throughput" ? t('page.detail.throughput')
      : t('page.detail.velocity');
    const unit = metric === "leadTime" || metric === "cycleTime" ? "d" : "";
    const canEdit = canEditSection(currentUser?.role, "targets", permissions ?? []);
    return { actual, targetVal, onTrack, isEditing, label, unit, canEdit };
  };

  const renderTrend = (value: number | undefined, metricKey?: string, currentValue?: number | null, lowerBetter?: boolean) => {
    if (value === undefined) return null;
    const isPositive = value >= 0;
    const improving = metricKey && currentValue != null ? isImproving(metricKey, value, lowerBetter ?? false) : null;
    return (
      <div className="flex items-center gap-1.5">
        <span className={`flex items-center text-xs ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          {isPositive ? <ArrowUpRight size={12} className="mr-0.5" /> : <ArrowDownRight size={12} className="mr-0.5" />}
          {Math.abs(value).toFixed(1)}%
        </span>
        {metricKey && currentValue != null && (
          <span className={`text-[11px] ${improving === null ? 'text-muted-foreground' : improving ? 'text-green-500/70' : 'text-red-500/70'}`}>
            {describeTrend(metricKey, value, currentValue, t)}
          </span>
        )}
      </div>
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
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-semibold bg-primary/10 text-primary px-3 py-1.5 rounded-md">
            {t('page.detail.summaryTab')}
          </span>
          {primaryLinks.map((link) => (
            <Link
              key={link.section}
              href={link.href}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent px-3 py-1.5 rounded-md transition-colors"
            >
              {tabIconMap[link.section] ?? null}
              {link.label}
            </Link>
          ))}
          {secondaryLinks.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent px-3 py-1.5 rounded-md transition-colors">
                {t('common.more')}
                <ChevronDown size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {secondaryLinks.map((link) => (
                  <DropdownMenuItem key={link.section} asChild>
                    <Link href={link.href} className="flex items-center gap-2 cursor-pointer">
                      {dropdownIconMap[link.section] ?? null}
                      {link.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
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

      <div className={`grid gap-4 md:grid-cols-2 ${metrics?.isScrum ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {metrics?.isScrum && (
          <MetricCard
            metricKey="velocity"
            info={metricInfo("velocity")}
            trend={renderTrend(metrics?.velocityTrend, 'metric.velocity', metrics?.velocity, false)}
            editingValue={editingTarget?.metric === "velocity" ? editingTarget.value : ""}
            onEdit={() => setEditingTarget({ metric: "velocity", value: String(getTarget("velocity")?.targetValue ?? "") })}
            onSave={() => saveTarget("velocity")}
            onCancel={() => setEditingTarget(null)}
            onValueChange={(v) => setEditingTarget({ metric: "velocity", value: v })}
            percentiles={null}
          />
        )}

        <MetricCard
          metricKey="leadTime"
          info={metricInfo("leadTime")}
          trend={null}
          editingValue={editingTarget?.metric === "leadTime" ? editingTarget.value : ""}
          onEdit={() => setEditingTarget({ metric: "leadTime", value: String(getTarget("leadTime")?.targetValue ?? "") })}
          onSave={() => saveTarget("leadTime")}
          onCancel={() => setEditingTarget(null)}
          onValueChange={(v) => setEditingTarget({ metric: "leadTime", value: v })}
          percentiles={metrics?.leadTimePercentiles ?? null}
        />

        <MetricCard
          metricKey="cycleTime"
          info={metricInfo("cycleTime")}
          trend={null}
          editingValue={editingTarget?.metric === "cycleTime" ? editingTarget.value : ""}
          onEdit={() => setEditingTarget({ metric: "cycleTime", value: String(getTarget("cycleTime")?.targetValue ?? "") })}
          onSave={() => saveTarget("cycleTime")}
          onCancel={() => setEditingTarget(null)}
          onValueChange={(v) => setEditingTarget({ metric: "cycleTime", value: v })}
          percentiles={metrics?.cycleTimePercentiles ?? null}
        />

        <MetricCard
          metricKey="throughput"
          info={metricInfo("throughput")}
          trend={renderTrend(metrics?.throughputTrend, 'metric.throughput', metrics?.throughput, false)}
          editingValue={editingTarget?.metric === "throughput" ? editingTarget.value : ""}
          onEdit={() => setEditingTarget({ metric: "throughput", value: String(getTarget("throughput")?.targetValue ?? "") })}
          onSave={() => saveTarget("throughput")}
          onCancel={() => setEditingTarget(null)}
          onValueChange={(v) => setEditingTarget({ metric: "throughput", value: v })}
          percentiles={null}
        />
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-lg">{metrics?.isScrum ? t('page.detail.velocityTrend') : t('page.detail.throughputTrend')}</CardTitle>
          <CardDescription>{metrics?.isScrum ? t('page.detail.velocityTrendDesc') : t('page.detail.throughputTrendDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={metrics?.velocityByWeek || []}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
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
    </div>
  );
}

function MetricCard({
  metricKey,
  info,
  trend,
  percentiles,
  editingValue,
  onEdit,
  onSave,
  onCancel,
  onValueChange,
}: {
  metricKey: string;
  info: { actual: number | undefined | null; targetVal: number | null; onTrack: boolean | null; isEditing: boolean; label: string; unit: string; canEdit: boolean };
  trend: React.ReactNode;
  percentiles: { p50: number; p75: number; p85: number; p95: number } | null;
  editingValue: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onValueChange: (v: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card className="bg-card/40">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">{info.label}</CardTitle>
          {info.canEdit && !info.isEditing && (
            <button onClick={onEdit} className="text-muted-foreground hover:text-foreground transition-colors">
              <PencilLine size={14} />
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {info.isEditing ? (
          <div className="flex gap-2 items-center">
            <input
              type="number"
              step="0.1"
              value={editingValue}
              onChange={(e) => onValueChange(e.target.value)}
              className="w-24 bg-background border border-border rounded px-2 py-1 text-sm"
              placeholder={t('page.detail.targetValue')}
              autoFocus
            />
            <button onClick={onSave} className="bg-primary text-primary-foreground px-2 py-1 rounded text-xs">{t('page.detail.save')}</button>
            <button onClick={onCancel} className="text-xs text-muted-foreground hover:underline">{t('page.detail.cancel')}</button>
          </div>
        ) : (
          <>
            <div className="text-3xl font-bold">
              {info.actual !== undefined && info.actual !== null ? `${Number(info.actual).toFixed(1)}` : "—"}
              <span className="text-sm font-normal text-muted-foreground ml-1">{info.unit}</span>
            </div>
            {metricKey === "leadTime" || metricKey === "cycleTime" ? (
              <p className="text-xs text-muted-foreground mt-1">
                {metricKey === "leadTime" ? t('page.detail.leadTimeDesc') : t('page.detail.cycleTimeDesc')}
              </p>
            ) : null}
            {trend && <div className="mt-1">{trend}</div>}
            {percentiles && (
              <div className="flex gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
                <span>P50 <strong className="text-foreground">{percentiles.p50.toFixed(1)}d</strong></span>
                <span>P75 <strong className="text-foreground">{percentiles.p75.toFixed(1)}d</strong></span>
                <span>P85 <strong className="text-foreground">{percentiles.p85.toFixed(1)}d</strong></span>
                <span>P95 <strong className="text-foreground">{percentiles.p95.toFixed(1)}d</strong></span>
              </div>
            )}
            {info.targetVal !== null && info.onTrack !== null && (
              <div className="flex items-center gap-2 mt-2">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
                  info.onTrack ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                }`}>
                  {info.onTrack ? t('page.detail.onTrack') : t('page.detail.behind')}
                </span>
                <span className="text-[11px] text-muted-foreground">{t('page.detail.target')} {info.targetVal}{info.unit}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
