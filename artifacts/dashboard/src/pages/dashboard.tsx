import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { 
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListUserProjects, getListUserProjectsQueryKey 
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricTooltip } from "@/components/metric-tooltip";
import { Activity, Target, Clock, AlertTriangle, LayoutDashboard, RefreshCw, MoreHorizontal, Gauge } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { getAuthToken } from "@/lib/auth";

function formatDurationDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const totalMinutes = Math.round(value * 24 * 60);
  if (totalMinutes < 60) return `${Math.max(1, totalMinutes)}m`;
  if (totalMinutes < 24 * 60) return `${Math.round(totalMinutes / 60)}h`;
  return `${Math.round((totalMinutes / (24 * 60)) * 10) / 10}d`;
}

type DimStatus = "ok" | "warn" | "fail";

type HealthDimension = {
  key: "flow" | "cycle" | "lead" | "delivery";
  label: string;
  value: string;
  ref: string;
  status: DimStatus;
};

function worstStatus(dims: HealthDimension[]): "Rojo" | "Amarillo" | "Verde" {
  if (dims.some((d) => d.status === "fail")) return "Rojo";
  if (dims.some((d) => d.status === "warn")) return "Amarillo";
  return "Verde";
}

function actionFromDims(dims: HealthDimension[]): string {
  const priority = [
    ...dims.filter((d) => d.status === "fail"),
    ...dims.filter((d) => d.status === "warn"),
  ].map((d) => d.key);
  if (priority.includes("delivery")) return "Asegurar entrega";
  if (priority.includes("flow")) return "Reducir carga activa";
  if (priority.includes("cycle")) return "Reducir cycle time";
  if (priority.includes("lead")) return "Acortar lead time";
  return "Monitorear";
}

function dimStatusIcon(s: DimStatus): string {
  return s === "ok" ? "✓" : s === "warn" ? "⚠" : "✗";
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [portfolioData, setPortfolioData] = useState<any[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<{
    lastSyncedAt: string | null;
    isSyncing: boolean;
    startedAt?: string | null;
    finishedAt?: string | null;
    trigger?: "startup" | "daily" | "manual" | null;
    lastError?: string | null;
    processedProjects?: number;
    totalProjects?: number;
  } | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [methodologyFilter, setMethodologyFilter] = useState<string>("all");
  const [thresholds, setThresholds] = useState<Record<string, { goodValue: number; warningValue: number }>>({});

  const token = getAuthToken();
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary({
    query: { 
      queryKey: getGetDashboardSummaryQueryKey(),
      enabled: !!token,
    }
  });
  
  const { data: userProjects, isLoading: loadingProjects } = useListUserProjects({
    query: { 
      queryKey: getListUserProjectsQueryKey(),
      enabled: !!token,
    }
  });
  const visibleProjects = userProjects?.filter((p) => p.visible) ?? [];
  const visibleIds = useMemo(() => new Set(visibleProjects.map((p) => p.id)), [visibleProjects]);
  const visiblePortfolio = useMemo(
    () => portfolioData.filter((p) => visibleIds.has(p.id)),
    [portfolioData, visibleIds]
  );

  useEffect(() => {
    const token = localStorage.getItem("auth_token");

    const fetchSyncStatus = () => {
      fetch("/api/sync/status", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (r) => { if (!r.ok) return null; const text = await r.text(); return text ? JSON.parse(text) : null; })
        .then(setSyncStatus)
        .catch(() => {});
    };

    fetch("/api/portfolio", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => { if (!r.ok) return []; const text = await r.text(); return text ? JSON.parse(text) : []; })
      .then(setPortfolioData)
      .catch(() => setPortfolioData([]))
      .finally(() => setPortfolioLoading(false));
    fetchSyncStatus();
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

    const interval = window.setInterval(fetchSyncStatus, 10000);
    return () => window.clearInterval(interval);
  }, []);

  const triggerManualSync = async () => {
    const token = localStorage.getItem("auth_token");
    if (!token || syncingNow || syncStatus?.isSyncing) return;

    setSyncingNow(true);
    try {
      const response = await fetch("/api/sync/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok || response.status === 202) {
        const nextStatus = await fetch("/api/sync/status", {
          headers: { Authorization: `Bearer ${token}` },
        }).then(async (r) => {
          if (!r.ok) return null;
          const text = await r.text();
          return text ? JSON.parse(text) : null;
        });
        setSyncStatus(nextStatus);
      }
    } finally {
      setSyncingNow(false);
    }
  };

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

  const filteredPortfolio = visiblePortfolio
    .filter((p) => {
      if (methodologyFilter === "all") return true;
      return boardTypeMap.get(p.id) === methodologyFilter;
    })
    .sort((a, b) => b.doneCount - a.doneCount);

  const totalThroughput = filteredPortfolio.reduce((s, p) => s + p.doneCount, 0);
  const totalWip = filteredPortfolio.reduce((s, p) => s + p.inProgressCount, 0);
  const portfolioFlowLoad = totalThroughput > 0 ? totalWip / totalThroughput : null;
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

  const enrichedPortfolio = useMemo(() => {
    const maxThroughput = Math.max(1, ...filteredPortfolio.map((p) => p.doneCount ?? 0));
    const cycleRef = Math.max(1, avgCycleP50 ?? 5);
    const leadRef = Math.max(1, avgLeadTime ?? 7);
    const cycleThreshold = thresholds["cycleTime"];

    return filteredPortfolio.map((p) => {
      const throughput = p.doneCount ?? 0;
      const wip = p.inProgressCount ?? 0;
      const flowLoad = throughput > 0 ? wip / throughput : wip > 0 ? 5 : 0;
      const cycle = p.cycleTimeP50 ?? cycleRef;
      const lead = p.leadTimeAvg ?? leadRef;

      const cycleGood = cycleThreshold?.goodValue ?? cycleRef;
      const cycleWarn = cycleThreshold?.warningValue ?? cycleRef * 1.4;

      const flowStatus: DimStatus = flowLoad >= 2.0 ? "fail" : flowLoad >= 1.2 ? "warn" : "ok";
      const cycleStatus: DimStatus = p.cycleTimeP50 === null ? "ok" : cycle > cycleWarn ? "fail" : cycle > cycleGood ? "warn" : "ok";
      const leadStatus: DimStatus = p.leadTimeAvg === null ? "ok" : lead > leadRef * 1.5 ? "fail" : lead > leadRef * 1.2 ? "warn" : "ok";
      const deliveryStatus: DimStatus =
        throughput === 0 && wip >= 3
          ? "fail"
          : throughput <= Math.ceil(maxThroughput * 0.15) && wip > 0
            ? "warn"
            : "ok";

      const dims: HealthDimension[] = [
        {
          key: "flow",
          label: "Flujo",
          value: throughput > 0 ? `${flowLoad.toFixed(1)}x` : wip > 0 ? "Sin salida" : "—",
          ref: "ref: ≤ 1.0x",
          status: flowStatus,
        },
        {
          key: "cycle",
          label: "Cycle Time",
          value: p.cycleTimeP50 !== null ? formatDurationDays(cycle) : "—",
          ref: `ref: ${formatDurationDays(cycleGood)}`,
          status: cycleStatus,
        },
        {
          key: "lead",
          label: "Lead Time",
          value: p.leadTimeAvg !== null ? formatDurationDays(lead) : "—",
          ref: `ref: ${formatDurationDays(leadRef)}`,
          status: leadStatus,
        },
        {
          key: "delivery",
          label: "Entrega",
          value: `${throughput} completadas`,
          ref: `${wip} en progreso`,
          status: deliveryStatus,
        },
      ];

      const semaphor = worstStatus(dims);
      const suggestedAction = actionFromDims(dims);
      const attentionPriority =
        dims.filter((d) => d.status === "fail").length * 100 +
        dims.filter((d) => d.status === "warn").length * 30 +
        flowLoad * 10 +
        wip;

      return {
        ...p,
        flowLoad,
        dims,
        semaphor,
        suggestedAction,
        attentionPriority,
      };
    });
  }, [filteredPortfolio, avgCycleP50, avgLeadTime, thresholds]);

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
        <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={triggerManualSync}
            disabled={syncingNow || syncStatus?.isSyncing}
            className="h-8"
          >
            <RefreshCw size={14} className={(syncingNow || syncStatus?.isSyncing) ? "animate-spin mr-2" : "mr-2"} />
            Sincronizar ahora
          </Button>
          <RefreshCw size={14} className={syncStatus?.isSyncing ? "animate-spin" : ""} />
          <span>
            {syncStatus ? `${t('page.dashboard.synced')} ${formatLastSynced(syncStatus.lastSyncedAt)}` : t('page.dashboard.loading')}
          </span>
          {syncStatus?.isSyncing && (syncStatus.totalProjects ?? 0) > 0 && (
            <span className="text-muted-foreground">
              ({syncStatus.processedProjects ?? 0}/{syncStatus.totalProjects ?? 0})
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Flow Load (WIP/Throughput)</CardTitle>
            <Gauge className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">
                {portfolioFlowLoad === null ? "-" : `${portfolioFlowLoad.toFixed(2)}x`}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Carga relativa del sistema (menor es mejor)</p>
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
                    <TableHead className="text-right">
                      Carga activa <MetricTooltip description="WIP en progreso / Issues completadas (90d). Un valor mayor a 1x indica que se acumula más trabajo del que sale." />
                    </TableHead>
                    <TableHead className="text-right">
                      Tiempo en proceso <MetricTooltip description="Mediana del tiempo que tarda una tarea desde que se empieza hasta que se termina (Cycle Time P50)." />
                    </TableHead>
                    <TableHead className="text-right">
                      Tiempo hasta cierre <MetricTooltip description="Promedio del tiempo desde que se crea una tarea hasta que se entrega (Lead Time Avg)." />
                    </TableHead>
                    <TableHead className="text-right">Entregas · En curso</TableHead>
                    <TableHead>Accion sugerida</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrichedPortfolio.map((p) => {
                    const flowDim = p.dims.find((d: HealthDimension) => d.key === "flow");
                    const cycleDim = p.dims.find((d: HealthDimension) => d.key === "cycle");
                    const leadDim = p.dims.find((d: HealthDimension) => d.key === "lead");
                    const deliveryDim = p.dims.find((d: HealthDimension) => d.key === "delivery");
                    return (
                    <TableRow key={p.id} className="border-border hover:bg-accent/50">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium shrink-0 ${
                              p.semaphor === "Rojo"
                                ? "bg-red-500/15 text-red-400"
                                : p.semaphor === "Amarillo"
                                  ? "bg-amber-100 text-amber-800 dark:bg-yellow-500/15 dark:text-yellow-300"
                                  : "bg-green-500/15 text-green-400"
                            }`}
                          >
                            {p.semaphor === "Rojo" ? "✗" : p.semaphor === "Amarillo" ? "⚠" : "✓"}
                          </span>
                          <Link href={`/projects/${p.id}`} className="text-primary hover:underline font-medium">
                            {p.name}
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${
                        flowDim?.status === "fail" ? "text-red-400" : flowDim?.status === "warn" ? "text-amber-600 dark:text-yellow-300" : "text-muted-foreground"
                      }`}>
                        {flowDim?.value ?? "—"}
                        <div className="text-muted-foreground/60 font-sans">{p.inProgressCount} / {p.doneCount}</div>
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${
                        cycleDim?.status === "fail" ? "text-red-400" : cycleDim?.status === "warn" ? "text-amber-600 dark:text-yellow-300" : "text-muted-foreground"
                      }`}>
                        {formatDurationDays(p.cycleTimeP50)}
                        {cycleDim && cycleDim.status !== "ok" && (
                          <div className="text-muted-foreground/60 font-sans">{cycleDim.ref}</div>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${
                        leadDim?.status === "fail" ? "text-red-400" : leadDim?.status === "warn" ? "text-amber-600 dark:text-yellow-300" : "text-muted-foreground"
                      }`}>
                        {formatDurationDays(p.leadTimeAvg)}
                        {leadDim && leadDim.status !== "ok" && (
                          <div className="text-muted-foreground/60 font-sans">{leadDim.ref}</div>
                        )}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs ${
                        deliveryDim?.status === "fail" ? "text-red-400" : deliveryDim?.status === "warn" ? "text-amber-600 dark:text-yellow-300" : "text-green-400"
                      }`}>
                        {p.doneCount} completadas
                        <div className="text-muted-foreground/60 font-sans">{p.inProgressCount} en curso</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.suggestedAction}</TableCell>
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
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}