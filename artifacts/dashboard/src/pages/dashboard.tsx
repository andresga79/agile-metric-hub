import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { 
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListUserProjects, getListUserProjectsQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricTooltip } from "@/components/metric-tooltip";
import { Activity, Target, Clock, CheckCircle2, AlertTriangle, LayoutDashboard, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useMemo } from "react";

export default function Dashboard() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [portfolioData, setPortfolioData] = useState<any[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<{ lastSyncedAt: string | null; isSyncing: boolean } | null>(null);
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
      .then((r) => r.ok ? r.json() : [])
      .then(setPortfolioData)
      .catch(() => setPortfolioData([]))
      .finally(() => setPortfolioLoading(false));
    fetch("/api/sync/status", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then(setSyncStatus)
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

  const totalThroughput = visiblePortfolio.reduce((s, p) => s + p.throughput, 0);
  const totalWip = visiblePortfolio.reduce((s, p) => s + p.inProgressCount, 0);
  const avgCycleP50 = (() => {
    const valid = visiblePortfolio.filter((p) => p.cycleTimeP50 !== null);
    if (valid.length === 0) return null;
    return valid.reduce((s, p) => s + p.cycleTimeP50, 0) / valid.length;
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
              <div className="text-2xl font-bold">{summary?.avgCycleTime.toFixed(1)}d</div>
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
              <div className="text-2xl font-bold">{summary?.totalIssuesResolved}</div>
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
            <p className="text-xs text-muted-foreground mt-1">{avgCycleP50 !== null ? `${t('page.dashboard.cycleTimeP50')} ${avgCycleP50.toFixed(1)}d` : "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutDashboard size={18} />
            {t('page.dashboard.projectOverview')}
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
                    <TableHead className="text-right">{t('page.dashboard.issues')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.completed')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.wip')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.throughput')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.cycleTime')}</TableHead>
                    <TableHead className="text-right">{t('page.dashboard.leadTime')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePortfolio.map((p) => (
                    <TableRow key={p.id} className="border-border hover:bg-accent/50">
                      <TableCell>
                        <Link href={`/projects/${p.id}`} className="text-primary hover:underline font-medium">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.issueCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-green-400">{p.doneCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-amber-400">{p.inProgressCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.throughput}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.cycleTimeP50 !== null ? `${p.cycleTimeP50.toFixed(1)}d` : "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{p.leadTimeAvg !== null ? `${p.leadTimeAvg}d` : "—"}</TableCell>
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