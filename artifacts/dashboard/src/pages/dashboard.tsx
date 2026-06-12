import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { 
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListUserProjects, getListUserProjectsQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricTooltip } from "@/components/metric-tooltip";
import { Activity, Target, Clock, CheckCircle2, AlertTriangle, LayoutDashboard, RefreshCw, MoreHorizontal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

function formatDurationDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const totalMinutes = Math.round(value * 24 * 60);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`;
  if (totalMinutes < 24 * 60) return `${Math.round(totalMinutes / 60)}h`;
  return `${Math.round((totalMinutes / (24 * 60)) * 10) / 10}d`;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [portfolioData, setPortfolioData] = useState<any[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<{ lastSyncedAt: string | null; isSyncing: boolean } | null>(null);
  const [methodologyFilter, setMethodologyFilter] = useState<string>("all");
  const [thresholds, setThresholds] = useState<Record<string, { goodValue: number; warningValue: number }>>({});

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });
  
  const { data: userProjects, isLoading: loadingProjects } = useListUserProjects({
    query: { queryKey: getListUserProjectsQueryKey() }
  });
  const visibleProjects = userProjects?.filter((p) => p.visible) ?? [];
  const visibleIds = useMemo(() => new Set(visibleProjects.map((p) => p.id)), [visibleProjects]);
  const visiblePortfolio = useMemo(
    () => portfolioData.filter((p) => visibleIds.has(p.id)),
    [portfolioData, visibleIds]
  );

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/portfolio", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => { if (!r.ok) return []; const text = await r.text(); return text ? JSON.parse(text) : []; })
      .then(setPortfolioData)
      .catch(() => setPortfolioData([]))
      .finally(() => setPortfolioLoading(false));
    fetch("/api/sync/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => { if (!r.ok) return null; const text = await r.text(); return text ? JSON.parse(text) : null; })
      .then(setSyncStatus)
      .catch(() => {});
    fetch("/api/admin/metric-thresholds", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => { const text = await r.text(); return text ? JSON.parse(text) : []; })
      .then((data) => {
        if (Array.isArray(data)) {
          const map: Record<string, { goodValue: number; warningValue: number }> = {};
          for (const t of data) {
            map[t.metric] = { goodValue: Number(t.goodValue), warningValue: Number(t.warningValue) };
          }
          setThresholds(map);
        }
      })
      .catch(() => {});
  }, []);

  const isLoading = loadingSummary || loadingProjects;

  const isMockData = (summary as any)?.usingMockData ?? (userProjects as any)?.[0]?.usingMockData;

  const formatLastSynced = (iso: string | null) => {
    if (!iso) return t('page.dashboard.never');
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('page.dashboard.now');
    if (diffMin < 60) return t('page.dashboard.minAgo', { count: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('page.dashboard.hAgo', { count: diffH });
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const healthColor = (p: any) => {
    const wipRatio = p.inProgressCount / Math.max(p.throughput, 1);
    const ctThresh = thresholds["cycleTime"];
    const wipThresh = thresholds["wipRatio"];

    const wipPct = wipRatio * 100;
    let cycleStatus: "good" | "warning" | "critical" = "good";
    let wipStatus: "good" | "warning" | "critical" = "good";

    if (ctThresh && p.cycleTimeP50 !== null) {
      if (p.cycleTimeP50 <= ctThresh.goodValue) cycleStatus = "good";
      else if (p.cycleTimeP50 <= ctThresh.warningValue) cycleStatus = "warning";
      else cycleStatus = "critical";
    }
    if (wipThresh) {
      if (wipPct <= wipThresh.goodValue) wipStatus = "good";
      else if (wipPct <= wipThresh.warningValue) wipStatus = "warning";
      else wipStatus = "critical";
    }

    if (cycleStatus === "critical" || wipStatus === "critical") return "bg-red-500";
    if (cycleStatus === "warning" || wipStatus === "warning") return "bg-yellow-500";
    return "bg-green-500";
  };

  const boardTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of userProjects ?? []) {
      if (p.boardType) {
        // Jira devuelve "scrum", "kanban" o "simple"; "simple" se trata como Kanban
        map.set(p.id, p.boardType === "scrum" ? "scrum" : "kanban");
      }
    }
    return map;
  }, [userProjects]);

  const filteredPortfolio = visiblePortfolio.filter((p) => {
    if (methodologyFilter === "all") return true;
    return boardTypeMap.get(p.id) === methodologyFilter;
  });

  const totalThroughput = filteredPortfolio.reduce((s, p) => s + p.throughput, 0);
  const totalWip = filteredPortfolio.reduce((s, p) => s + p.inProgressCount, 0);
  const totalCompleted = filteredPortfolio.reduce((s, p) => s + p.doneCount, 0);
  const avgCycleP50 = (() => {
    const valid = visiblePortfolio.filter((p) => p.cycleTimeP50 !== null);
    if (valid.length === 0) return null;
    return valid.reduce((s, p) => s + p.cycleTimeP50, 0) / valid.length;
  })();
  const avgLeadTime = (() => {
    const valid = visiblePortfolio.filter((p) => p.leadTimeAvg !== null);
    if (valid.length === 0) return null;
    return valid.reduce((s, p) => s + p.leadTimeAvg, 0) / valid.length;
  })();

  return (
    <div className="space-y-8">
      {isMockData && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('page.dashboard.demoMode')}</AlertTitle>
          <AlertDescription>
            {t('page.dashboard.demoText')}{" "}
            <code className="text-xs bg-destructive/20 px-1 rounded">JIRA_URL</code>,{" "}
            <code className="text-xs bg-destructive/20 px-1 rounded">JIRA_EMAIL</code> y{" "}
            <code className="text-xs bg-destructive/20 px-1 rounded">JIRA_API_TOKEN</code>{" "}
            {t('page.dashboard.demoLink')}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.dashboard.overview')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('page.dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
          <RefreshCw size={14} className={syncStatus?.isSyncing ? "animate-spin" : ""} />
          <span>
            {syncStatus ? `${t('page.dashboard.synced')} ${formatLastSynced(syncStatus.lastSyncedAt)}` : t('page.dashboard.loading')}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.dashboard.activeProjects')}<MetricTooltip description={t('tooltip.activeProjects')} /></CardTitle>
            <Target className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{visiblePortfolio.length}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t('page.dashboard.visibleProjects')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.dashboard.avgVelocity')}<MetricTooltip description={t('tooltip.avgVelocity')} /></CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{summary?.avgVelocity.toFixed(1)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t('page.dashboard.pointsPerSprint')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.dashboard.avgCycleTime')}<MetricTooltip description={t('tooltip.avgCycleTime')} /></CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{summary?.avgCycleTimeDisplay ?? formatDurationDays(summary?.avgCycleTime)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t('page.dashboard.startToFinish')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.dashboard.issuesResolved')}<MetricTooltip description={t('tooltip.issuesResolved')} /></CardTitle>
            <CheckCircle2 className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{totalCompleted}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t('page.dashboard.allTime')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.dashboard.throughput90')}<MetricTooltip description={t('tooltip.throughput90d')} /></CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{totalThroughput}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">{t('page.dashboard.acrossProjects')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.dashboard.totalWip')}<MetricTooltip description={t('tooltip.totalWip')} /></CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{totalWip}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {avgCycleP50 !== null ? `${t('page.dashboard.cycleTimeP50')} ${formatDurationDays(avgCycleP50)}` : "—"}
              {avgLeadTime !== null ? ` · ${t('page.dashboard.leadTime')} ${formatDurationDays(avgLeadTime)}` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-1 bg-background border border-border rounded-md p-1 w-fit">
        {["all", "scrum", "kanban"].map((m) => (
          <button
            key={m}
            onClick={() => setMethodologyFilter(m)}
            className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
              methodologyFilter === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "all" ? "Todos" : m === "scrum" ? "Scrum" : "Kanban"}
          </button>
        ))}
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutDashboard size={18} />
            {t('page.dashboard.projectOverview')}
            <MetricTooltip description={t('page.dashboard.periodInfo')} />
          </CardTitle>
          <CardDescription>{t('page.dashboard.sortedByThroughput')}</CardDescription>
        </CardHeader>
        <CardContent>
          {portfolioLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-12 ml-auto" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.dashboard.project')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.issuesResolved')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.completed')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.wip')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.throughput')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.cycleTime')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.leadTime')}</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPortfolio.map((p) => (
                    <TableRow key={p.id} className="border-border hover:bg-accent/50">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${healthColor(p)}`} />
                          <Link href={`/projects/${p.id}`} className="text-primary hover:underline font-medium">
                            {p.name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.issueCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-green-400">{p.doneCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-amber-400">{p.inProgressCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.throughput}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatDurationDays(p.cycleTimeP50)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatDurationDays(p.leadTimeAvg)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent transition-colors">
                            <MoreHorizontal size={16} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link href={`/projects/${p.id}/health`} className="cursor-pointer">Health</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/projects/${p.id}/forecast`} className="cursor-pointer">Forecast</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/projects/${p.id}/${boardTypeMap.get(p.id) === 'scrum' ? 'sprints' : 'kanban'}`} className="cursor-pointer">{boardTypeMap.get(p.id) === 'scrum' ? 'Sprints' : 'Kanban'}</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <Link href={`/projects/${p.id}/report`} className="cursor-pointer">Report</Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}