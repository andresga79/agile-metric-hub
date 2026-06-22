import { useState, useEffect, useRef } from "react";
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
import { ChevronRight, ChevronDown, BarChart3, HeartPulse, GitPullRequest, Activity, Users, FileText, ShieldAlert, Download, Ban } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { getSectionLinks, useRolePermissions } from "@/lib/project-section-permissions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

type Period = "1m" | "3m";

type MetricThreshold = { good: number; warning: number };
type ThresholdStatus = "good" | "warning" | "critical" | null;

const DEFAULT_THRESHOLDS: Record<string, MetricThreshold> = {
  cycleTime: { good: 15, warning: 25 },
  leadTime: { good: 20, warning: 35 },
};

function formatDurationDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const totalMinutes = Math.round(value * 24 * 60);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`;
  if (totalMinutes < 24 * 60) return `${Math.round(totalMinutes / 60)}h`;
  return `${Math.round((totalMinutes / (24 * 60)) * 10) / 10}d`;
}

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [targets, setTargets] = useState<any[]>([]);
  const [thresholds, setThresholds] = useState<Record<string, MetricThreshold>>(DEFAULT_THRESHOLDS);
  const chartRef = useRef<HTMLDivElement>(null);
  const [exportingChart, setExportingChart] = useState(false);
  const token = localStorage.getItem("auth_token");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) }
  });
  const { data: currentUser } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), enabled: !!token },
  });
  const { data: permissions } = useRolePermissions();

  const { data: metrics, isLoading: loadingMetrics } = useGetProjectMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectMetricsQueryKey(projectId!, period) }
  });

  useEffect(() => {
    if (!projectId || !token) return;
    fetch(`/api/projects/${projectId}/targets`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setTargets)
      .catch(console.error);
  }, [projectId, period, token]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/admin/metric-thresholds", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((rows) => {
        if (!Array.isArray(rows)) return;
        const merged: Record<string, MetricThreshold> = { ...DEFAULT_THRESHOLDS };
        for (const row of rows) {
          if (!row?.metric || row.goodValue === undefined || row.warningValue === undefined) continue;
          merged[row.metric] = {
            good: Number(row.goodValue),
            warning: Number(row.warningValue),
          };
        }
        setThresholds(merged);
      })
      .catch(console.error);
  }, [token]);

  const getTarget = (metric: string) => targets.find((t) => t.metric === metric && t.period === period);

  const downloadChart = async () => {
    if (!chartRef.current) return;
    setExportingChart(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(chartRef.current, { backgroundColor: "#ffffff", scale: 2 });
      const link = document.createElement("a");
      link.download = `${project?.key}-throughput-trend.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("Chart export failed", e);
    }
    setExportingChart(false);
  };

  if (loadingProject || loadingMetrics) return <DetailSkeleton />;
  if (!project) return <div>{t('page.detail.notFound')}</div>;

  const sectionLinks = getSectionLinks(currentUser?.role, project.id, permissions ?? [], project.boardType);

  // Decision-oriented order:
  // 1) Summary (fixed tab), 2) Health, 3) Flow, 4) Forecast,
  // 5) Execution (Sprints or Kanban), 6) Team, 7) QA Rejected, 8) Analytics, 9) Report
  const orderedSections = [
    'health',
    'flow',
    'forecast',
    'sprints',
    'kanban',
    'team',
    'qa-rejected',
    'analytics',
    'report',
  ] as const;

  const orderIndex = new Map<string, number>(
    orderedSections.map((section, index) => [section, index])
  );

  const orderedLinks = [...sectionLinks].sort((left, right) => {
    const leftIdx = orderIndex.get(left.section) ?? Number.MAX_SAFE_INTEGER;
    const rightIdx = orderIndex.get(right.section) ?? Number.MAX_SAFE_INTEGER;
    return leftIdx - rightIdx;
  });

  const primaryTabSections = ['health', 'flow', 'forecast', 'sprints', 'kanban'];
  const secondaryTabSections = ['team', 'qa-rejected', 'analytics', 'report'];

  const primaryLinks = orderedLinks.filter(l => primaryTabSections.includes(l.section));
  const secondaryLinks = orderedLinks.filter(l => secondaryTabSections.includes(l.section));

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
    const threshold = thresholds[metric];
    const onTrack = targetVal !== null && actual !== undefined && actual !== null
      ? isLowerBetter ? actual <= targetVal : actual >= targetVal
      : null;
    const thresholdStatus: ThresholdStatus = (metric === "leadTime" || metric === "cycleTime") && threshold && actual !== undefined && actual !== null
      ? actual <= threshold.good
        ? "good"
        : actual <= threshold.warning
        ? "warning"
        : "critical"
      : null;
    const label = metric === "leadTime" ? t('page.detail.leadTime')
      : metric === "cycleTime" ? t('page.detail.cycleTime')
      : metric === "throughput" ? t('page.detail.throughput')
      : t('page.detail.velocity');
    const unit = metric === "leadTime" || metric === "cycleTime" ? "d" : "";
    return { actual, targetVal, onTrack, thresholdStatus, label, unit };
  };

  const getThresholdValue = (metric: "leadTime" | "cycleTime") => {
    const threshold = thresholds[metric];
    return threshold?.good ?? null;
  };

  const renderTrend = (value: number | undefined, metricKey?: string, currentValue?: number | null, lowerBetter?: boolean) => {
    if (value === undefined) return null;
    const isPositive = value >= 0;
    const improving = metricKey && currentValue != null ? isImproving(metricKey, value, lowerBetter ?? false) : null;
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
          isPositive ? 'bg-green-500/15 text-green-500' : 'bg-red-500/15 text-red-500'
        }`}>
          {isPositive ? '\u2191' : '\u2193'} {Math.abs(value).toFixed(1)}%
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

      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">{t('nav.dashboard')}</Link>
        <ChevronRight size={14} className="text-muted-foreground/50" />
        <span className="text-foreground font-medium">{project.name}</span>
      </nav>

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
          {(['1m', '3m'] as Period[]).map((p) => (
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          metricKey="leadTime"
          info={metricInfo("leadTime")}
          trend={null}
          thresholdValue={getThresholdValue("leadTime")}
          percentiles={metrics?.leadTimePercentiles ?? null}
        />

        <MetricCard
          metricKey="cycleTime"
          info={metricInfo("cycleTime")}
          trend={null}
          thresholdValue={getThresholdValue("cycleTime")}
          percentiles={metrics?.cycleTimePercentiles ?? null}
        />

        <MetricCard
          metricKey="throughput"
          info={metricInfo("throughput")}
          trend={renderTrend(metrics?.throughputTrend, 'metric.throughput', metrics?.throughput, false)}
          percentiles={null}
          sparklineData={metrics?.velocityByWeek}
        />

        <BlockedKpiCard projectId={projectId!} period={period} />
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{t('page.detail.throughputTrend')}</CardTitle>
              <CardDescription>{t('page.detail.throughputTrendDesc')}</CardDescription>
            </div>
            <button
              onClick={downloadChart}
              disabled={exportingChart}
              className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-accent transition-colors"
              title="Export as PNG"
            >
              <Download size={16} />
            </button>
          </div>
        </CardHeader>
        <CardContent className="h-[300px]">
          <div ref={chartRef} className="w-full h-full">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BlockedKpiCard({ projectId, period }: { projectId: string; period: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ activeBlocked: number; avgDays: number; wipPercent: number | null } | null>(null);
  const token = localStorage.getItem("auth_token");

  useEffect(() => {
    if (!projectId || !token) return;
    fetch(`/api/projects/${projectId}/analytics/${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        const blocked: { isCurrentlyBlocked: boolean; totalDays: number }[] = Array.isArray(json.blockedIssues) ? json.blockedIssues : [];
        const active = blocked.filter((b) => b.isCurrentlyBlocked);
        const activeBlocked = active.length;
        const avgDays = active.length > 0 ? active.reduce((s, b) => s + b.totalDays, 0) / active.length : 0;
        const wipCount: number | null = Array.isArray(json.wipAging) && json.wipAging.length > 0 ? json.wipAging.length : null;
        const wipPercent = wipCount !== null && wipCount > 0 ? Math.round((activeBlocked / wipCount) * 100) : null;
        setData({ activeBlocked, avgDays, wipPercent });
      })
      .catch(console.error);
  }, [projectId, period, token]);

  const status: "good" | "warning" | "critical" =
    data === null
      ? "good"
      : data.activeBlocked >= 5 || (data.wipPercent !== null && data.wipPercent > 20)
      ? "critical"
      : data.activeBlocked >= 2 || (data.wipPercent !== null && data.wipPercent >= 10)
      ? "warning"
      : "good";

  const statusConfig = {
    good:     { border: "border-green-500/20",  badge: "bg-green-500/20 text-green-400",  label: t("page.detail.blocked.statusGood") },
    warning:  { border: "border-amber-500/20",  badge: "bg-amber-500/20 text-amber-400",  label: t("page.detail.blocked.statusWarning") },
    critical: { border: "border-red-500/20",    badge: "bg-red-500/20 text-red-400",      label: t("page.detail.blocked.statusCritical") },
  };
  const cfg = statusConfig[status];

  return (
    <Link href={`/projects/${projectId}/health`}>
      <Card className={`bg-card/40 border ${cfg.border} transition-opacity hover:opacity-80 cursor-pointer h-full flex flex-col`}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("page.detail.blocked.title")}
            </CardTitle>
            <Ban size={14} className="text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          {data === null ? (
            <div className="h-8 w-12 bg-muted animate-pulse rounded mb-2" />
          ) : (
            <>
              <div className="text-2xl font-bold">{data.activeBlocked}</div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
                {data.wipPercent !== null && (
                  <span className="text-xs text-muted-foreground">{data.wipPercent}% {t("page.detail.blocked.ofWip")}</span>
                )}
                {data.activeBlocked > 0 && (
                  <span className="text-xs text-muted-foreground">· {data.avgDays.toFixed(1)}d {t("page.detail.blocked.avgAge")}</span>
                )}
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground mt-auto">{t("page.detail.blocked.subtitle")}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function MetricCard({
  metricKey,
  info,
  trend,
  percentiles,
  sparklineData,
  thresholdValue,
}: {
  metricKey: string;
  info: { actual: number | undefined | null; targetVal: number | null; onTrack: boolean | null; thresholdStatus: ThresholdStatus; label: string; unit: string };
  trend: React.ReactNode;
  percentiles: { p50: number; p75: number; p85: number; p95: number } | null;
  sparklineData?: { week: string; value: number }[];
  thresholdValue?: number | null;
}) {
  const { t } = useTranslation();

  return (
    <Card className="bg-card/40 h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{info.label}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {((metricKey === "leadTime" || metricKey === "cycleTime") && info.thresholdStatus !== null) ? (
          <div className="mb-2">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                info.thresholdStatus === "good"
                  ? "bg-green-500/15 text-green-400"
                  : info.thresholdStatus === "warning"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-red-500/15 text-red-400"
              }`}
            >
              {info.thresholdStatus === "good"
                ? t('page.detail.thresholdHealthy')
                : info.thresholdStatus === "warning"
                ? t('page.detail.thresholdWarning')
                : t('page.detail.thresholdCritical')}
            </span>
          </div>
        ) : null}
        <div className="text-3xl font-bold">
          {info.actual !== undefined && info.actual !== null ? `${Number(info.actual).toFixed(1)}` : "—"}
          <span className="text-sm font-normal text-muted-foreground ml-1">{info.unit}</span>
        </div>
        {trend && <div className="mt-1">{trend}</div>}
        {(metricKey === "leadTime" || metricKey === "cycleTime") && percentiles && thresholdValue && (
          <div className="mt-2 text-xs text-muted-foreground">
            P50 <strong className="text-foreground">{formatDurationDays(percentiles.p50)}</strong> · P95 <strong className="text-foreground">{formatDurationDays(percentiles.p95)}</strong> · Meta <strong className="text-foreground">{thresholdValue}d</strong>
          </div>
        )}
        {percentiles && (metricKey !== "leadTime" && metricKey !== "cycleTime") && (
          <div className="flex gap-2 mt-2 text-xs text-muted-foreground flex-wrap">
            <span>P50 <strong className="text-foreground">{formatDurationDays(percentiles.p50)}</strong></span>
            <span>P95 <strong className="text-foreground">{formatDurationDays(percentiles.p95)}</strong></span>
          </div>
        )}
        {metricKey !== "leadTime" && metricKey !== "cycleTime" && info.targetVal !== null && info.actual !== null && info.actual !== undefined && (
          <div className="mt-2 text-xs text-muted-foreground">
            {t('page.detail.target')} {info.targetVal}{info.unit}
          </div>
        )}
        {metricKey !== "leadTime" && metricKey !== "cycleTime" && info.targetVal !== null && info.onTrack !== null && info.actual !== null && info.actual !== undefined && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className={info.onTrack ? "text-green-400" : "text-red-400"}>
                {info.onTrack ? t('page.detail.onTrack') : t('page.detail.behind')}
              </span>
              <span className="text-muted-foreground">{t('page.detail.target')} {info.targetVal}{info.unit}</span>
            </div>
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  info.onTrack ? "bg-green-500" : "bg-red-500"
                }`}
                style={{ width: `${Math.min((Number(info.actual) / info.targetVal) * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
        {sparklineData && sparklineData.length > 1 && (
          <div className="h-10 mt-auto -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparklineData}>
                <defs>
                  <linearGradient id={`sparkline-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={1.5} fillOpacity={1} fill={`url(#sparkline-${metricKey})`} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
