import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListUserProjects, getListUserProjectsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricTooltip } from "@/components/metric-tooltip";
import { Activity, Clock, AlertTriangle, LayoutDashboard, RefreshCw, MoreHorizontal, HeartPulse, Ban, TrendingUp, TrendingDown } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { getAuthToken } from "@/lib/auth";
import { useThresholds } from "@/hooks/use-thresholds";

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
  status: DimStatus;
  /** Human-readable cause shown in the "Motivo" column when this dimension is not ok. */
  reason: string;
  action: string;
};

type Semaphor = "Rojo" | "Amarillo" | "Verde";

const SEMAPHOR_RANK: Record<Semaphor, number> = { Rojo: 0, Amarillo: 1, Verde: 2 };

/** Window on a project's own pages closest to this page's fixed 90 days (6 two-week sprints ≈ 84d). */
function ninetyDayWindow(boardType: string | undefined): "6s" | "3m" {
  return boardType === "scrum" ? "6s" : "3m";
}

/** A project row that has synced data older than this is flagged as stale in the table. */
const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

function worstStatus(dims: HealthDimension[]): Semaphor {
  if (dims.some((d) => d.status === "fail")) return "Rojo";
  if (dims.some((d) => d.status === "warn")) return "Amarillo";
  return "Verde";
}

/** Small "vs. período anterior" delta shown under a KPI card. `lowerIsBetter` decides whether an
 *  increase reads as green (e.g. Health Score) or red (e.g. Cycle Time, QA Rejection Rate). */
function TrendIndicator({
  current,
  previous,
  lowerIsBetter,
}: {
  current: number | null;
  previous: number | null;
  lowerIsBetter: boolean;
}) {
  if (current === null || previous === null || previous === 0) return null;
  const deltaPct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(deltaPct) < 1) {
    return <span className="text-muted-foreground">· sin cambios vs. período anterior</span>;
  }
  const improved = lowerIsBetter ? deltaPct < 0 : deltaPct > 0;
  const Icon = deltaPct > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 ${improved ? "text-green-500" : "text-red-400"}`}>
      <Icon size={11} />
      {Math.abs(Math.round(deltaPct))}% vs. período anterior
    </span>
  );
}

/** Per-row delta vs. the previous 90 days, in absolute units ("+4", "−0.3d", "+6.2pp"). Absolute on
 *  purpose: on small projects a percentage turns 4 → 8 deliveries into a scary "+100%". */
function RowDelta({
  current,
  previous,
  lowerIsBetter,
  unit = "",
  decimals = 0,
  minChange,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  lowerIsBetter: boolean;
  unit?: string;
  decimals?: number;
  /** Changes smaller than this read as "no change" (avoids coloring rounding noise). */
  minChange: number;
}) {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < minChange) {
    return <span className="text-muted-foreground/60">=</span>;
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const sign = delta > 0 ? "+" : "−";
  return (
    <span className={improved ? "text-green-500" : "text-red-400"}>
      {sign}
      {Math.abs(delta).toFixed(decimals)}
      {unit}
    </span>
  );
}

function formatAge(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function Dashboard() {
  const { t } = useTranslation();
  const [portfolioData, setPortfolioData] = useState<any[]>([]);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  // A failed /portfolio used to become [] and read as "no projects"; keep it distinguishable.
  const [portfolioFailed, setPortfolioFailed] = useState(false);
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
  // Global effective thresholds (Admin -> Health). Previously read from the admin-only endpoint, so
  // for members it 403'd and the table fell back to judging projects against the portfolio average.
  const globalThresholds = useThresholds();
  const thresholds = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(globalThresholds).map(([metric, t]) => [metric, { goodValue: t.good, warningValue: t.warning }])
      ) as Record<string, { goodValue: number; warningValue: number }>,
    [globalThresholds]
  );

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
      .then(async (r) => {
        if (!r.ok) throw new Error(`Portfolio request failed: ${r.status}`);
        const text = await r.text();
        return text ? JSON.parse(text) : [];
      })
      .then(setPortfolioData)
      .catch((err) => {
        console.error(err);
        setPortfolioData([]);
        setPortfolioFailed(true);
      })
      .finally(() => setPortfolioLoading(false));
    fetchSyncStatus();

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

  const isLoading = loadingSummary || loadingProjects || portfolioLoading;

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

  const filteredPortfolio = visiblePortfolio.filter((p) => {
    if (methodologyFilter === "all") return true;
    return boardTypeMap.get(p.id) === methodologyFilter;
  });
  // Nothing delivered and nothing in progress in 90 days: there is no flow to judge, so these go to a
  // footer line instead of showing a misleading green check.
  const activePortfolio = filteredPortfolio.filter((p) => (p.doneCount ?? 0) > 0 || (p.inProgressCount ?? 0) > 0);
  const inactivePortfolio = filteredPortfolio.filter((p) => (p.doneCount ?? 0) === 0 && (p.inProgressCount ?? 0) === 0);

  const avgOf = (values: Array<number | null | undefined>, decimals: number): number | null => {
    const valid = values.filter((v): v is number => v !== null && v !== undefined);
    if (valid.length === 0) return null;
    const factor = 10 ** decimals;
    return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * factor) / factor;
  };

  const totalThroughput = activePortfolio.reduce((s, p) => s + p.doneCount, 0);
  const totalThroughputPrevious = activePortfolio.reduce((s, p) => s + (p.throughputPrevious ?? 0), 0);
  const avgCycleP50 = avgOf(activePortfolio.map((p) => p.cycleTimeP50), 1);
  const avgCycleP50Previous = avgOf(activePortfolio.map((p) => p.cycleTimeP50Previous), 1);
  const avgHealthScore = avgOf(activePortfolio.map((p) => p.healthScore), 0);
  const avgHealthScorePrevious = avgOf(activePortfolio.map((p) => p.healthScorePrevious), 0);
  const avgQaRejectionRate = avgOf(activePortfolio.map((p) => p.qaRejectionRate), 1);
  const avgQaRejectionRatePrevious = avgOf(activePortfolio.map((p) => p.qaRejectionRatePrevious), 1);

  const enrichedPortfolio = useMemo(() => {
    const cycleThreshold = thresholds["cycleTime"];
    const leadThreshold = thresholds["leadTime"];
    const flowThreshold = thresholds["flowLoad"];

    // Fallbacks only apply while the effective thresholds are still loading — once they resolve,
    // every project is judged against the same admin-configured cutoffs (Admin -> Health).
    const cycleGood = cycleThreshold?.goodValue ?? 15;
    const cycleWarn = cycleThreshold?.warningValue ?? 25;
    const leadGood = leadThreshold?.goodValue ?? 25;
    const leadWarn = leadThreshold?.warningValue ?? 35;
    const flowGood = flowThreshold?.goodValue ?? 1.2;
    const flowWarn = flowThreshold?.warningValue ?? 2.0;
    const now = Date.now();

    return activePortfolio
      .map((p) => {
        const throughput = p.doneCount ?? 0;
        const wip = p.inProgressCount ?? 0;
        const flowLoad = throughput > 0 ? wip / throughput : 0;
        // Cycle and lead time are judged by their median: the average jumps for 90 days every time a
        // team closes out old backlog (one 500-day ticket outweighs dozens of normal ones).
        const cycle: number | null = p.cycleTimeP50 ?? null;
        const lead: number | null = p.leadTimeP50 ?? null;
        const band = (v: number | null, good: number, warn: number): DimStatus =>
          v === null ? "ok" : v > warn ? "fail" : v > good ? "warn" : "ok";

        // Delivery is a structural stall check (nothing shipping while work sits in progress). It used
        // to compare against the busiest project (≤15% of its throughput), which flagged small teams
        // just for being small.
        const deliveryStatus: DimStatus = throughput === 0 ? (wip >= 3 ? "fail" : "warn") : "ok";
        const flowStatus: DimStatus =
          throughput === 0 ? "ok" : flowLoad >= flowWarn ? "fail" : flowLoad >= flowGood ? "warn" : "ok";

        const dims: HealthDimension[] = [
          {
            key: "delivery",
            status: deliveryStatus,
            reason: `0 entregas con ${wip} en curso`,
            action: "Asegurar entrega: revisar qué bloquea el cierre del trabajo en curso.",
          },
          {
            key: "flow",
            status: flowStatus,
            reason: `${wip} en curso vs ${throughput} entregas (${flowLoad.toFixed(1)}x, ref ≤ ${flowGood.toFixed(1)}x)`,
            action: "Reducir carga activa: terminar antes de empezar trabajo nuevo.",
          },
          {
            key: "cycle",
            status: band(cycle, cycleGood, cycleWarn),
            reason: `Cycle time ${formatDurationDays(cycle)} (ref ≤ ${formatDurationDays(cycleGood)})`,
            action: "Reducir cycle time: dividir historias grandes y revisar el estado con más espera.",
          },
          {
            key: "lead",
            status: band(lead, leadGood, leadWarn),
            reason: `Lead time ${formatDurationDays(lead)} (ref ≤ ${formatDurationDays(leadGood)})`,
            action: "Acortar lead time: refinar y priorizar el backlog para que los issues no esperen tanto antes de empezar.",
          },
        ];

        const semaphor = worstStatus(dims);
        // fail before warn, then in the dims order above (delivery > flow > cycle > lead).
        const issues = [...dims.filter((d) => d.status === "fail"), ...dims.filter((d) => d.status === "warn")];
        const attentionPriority =
          dims.filter((d) => d.status === "fail").length * 100 +
          dims.filter((d) => d.status === "warn").length * 30 +
          flowLoad * 10 +
          wip;
        const stale = p.cachedAt ? now - new Date(p.cachedAt).getTime() > STALE_AFTER_MS : false;

        return { ...p, dims, issues, semaphor, attentionPriority, stale };
      })
      // Most urgent first: red, then amber, then green; within a band, by attention priority.
      .sort(
        (a, b) =>
          SEMAPHOR_RANK[a.semaphor as Semaphor] - SEMAPHOR_RANK[b.semaphor as Semaphor] ||
          b.attentionPriority - a.attentionPriority ||
          b.doneCount - a.doneCount
      );
  }, [activePortfolio, thresholds]);

  const statusCounts = useMemo(() => {
    const counts = { Rojo: 0, Amarillo: 0, Verde: 0 };
    for (const p of enrichedPortfolio) counts[p.semaphor as Semaphor]++;
    return counts;
  }, [enrichedPortfolio]);

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

      <div className="flex items-start justify-between gap-4 flex-wrap">
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

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Health Score Prom. (90d)
              <MetricTooltip description="Promedio del Flow Health Score (0 a 100) de los proyectos con actividad. Cada uno combina issues cerrados por semana, cycle time (mediana) y % de bugs, medidos contra los umbrales de Admin → Health." />
            </CardTitle>
            <HeartPulse className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{avgHealthScore === null ? "—" : `${avgHealthScore}/100`}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <TrendIndicator current={avgHealthScore} previous={avgHealthScorePrevious} lowerIsBetter={false} />
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Entregas (90d)
              <MetricTooltip description={t('tooltip.throughput90d')} />
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{totalThroughput}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <TrendIndicator current={totalThroughput} previous={totalThroughputPrevious} lowerIsBetter={false} />
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cycle Time P50 Prom. (90d)
              <MetricTooltip description="Promedio, entre los proyectos con actividad, de la mediana del tiempo que tarda una tarea desde que se empieza hasta que se termina." />
            </CardTitle>
            <Clock className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{formatDurationDays(avgCycleP50)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <TrendIndicator current={avgCycleP50} previous={avgCycleP50Previous} lowerIsBetter={true} />
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tasa Rechazo QA Prom. (90d)
              <MetricTooltip description="Promedio de la tasa de rechazo de QA (issues devueltos a desarrollo desde QA / issues que entraron a QA) entre los proyectos con actividad." />
            </CardTitle>
            <Ban className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 mb-1" />
            ) : (
              <div className="text-2xl font-bold">{avgQaRejectionRate === null ? "—" : `${avgQaRejectionRate}%`}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <TrendIndicator current={avgQaRejectionRate} previous={avgQaRejectionRatePrevious} lowerIsBetter={true} />
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LayoutDashboard size={18} />
            {t('page.dashboard.projectOverview')}
            <MetricTooltip description="Todos los proyectos se miden sobre los mismos 90 días para poder compararlos. Las cifras de color comparan contra los 90 días anteriores (verde = mejora, rojo = empeora). El estado es el peor entre entrega, carga activa, cycle time y lead time (medianas), contra los umbrales de Admin → Health. Las pantallas de cada proyecto abren por defecto en una ventana más corta (2 sprints o 1 mes); desde aquí se abren en la más cercana a 90 días." />
          </CardTitle>
          <CardDescription>
            {isLoading ? (
              "Cargando…"
            ) : (
              <>
                Últimos 90 días vs. 90 días anteriores ·{" "}
                <span className={statusCounts.Rojo > 0 ? "text-red-400 font-medium" : ""}>
                  {statusCounts.Rojo} {statusCounts.Rojo === 1 ? "necesita" : "necesitan"} atención
                </span>
                {" · "}
                <span className={statusCounts.Amarillo > 0 ? "text-amber-600 dark:text-yellow-300 font-medium" : ""}>
                  {statusCounts.Amarillo} en observación
                </span>
                {" · "}
                <span className="text-green-500">{statusCounts.Verde} bien</span>
                {inactivePortfolio.length > 0 && ` · ${inactivePortfolio.length} sin actividad`}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {portfolioLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-12 ml-auto" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : portfolioFailed ? (
            <p className="text-sm text-destructive py-6 text-center">{t('common.loadFailed')}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>{t('page.dashboard.project')}</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">
                        Health <MetricTooltip description="Flow Health Score (0 a 100) y su cambio en puntos vs. los 90 días anteriores." />
                      </TableHead>
                      <TableHead className="text-right">
                        Entregas <MetricTooltip description="Issues completados en 90 días y la diferencia vs. los 90 días anteriores. Debajo, cuántos hay en curso." />
                      </TableHead>
                      <TableHead className="text-right">
                        Cycle P50 <MetricTooltip description="Mediana del tiempo desde que se empieza una tarea hasta que se termina, y su cambio en días vs. el período anterior." />
                      </TableHead>
                      <TableHead className="text-right">
                        Rechazo QA <MetricTooltip description="% de issues devueltos desde QA a desarrollo, y su cambio en puntos porcentuales vs. el período anterior." />
                      </TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrichedPortfolio.map((p) => {
                      const main = p.issues[0] as HealthDimension | undefined;
                      const extra = p.issues.length - 1;
                      return (
                        <TableRow key={p.id} className="border-border hover:bg-accent/50">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span
                                aria-label={p.semaphor}
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
                              <Link href={`/projects/${p.id}?period=${ninetyDayWindow(boardTypeMap.get(p.id))}`} className="text-primary hover:underline font-medium">
                                {p.name}
                              </Link>
                              {p.stale && (
                                <span
                                  className="text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground shrink-0"
                                  title={`Datos sincronizados por última vez ${new Date(p.cachedAt).toLocaleString("es-MX")}`}
                                >
                                  datos de hace {formatAge(p.cachedAt)}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">
                            {main ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className={`cursor-help ${
                                      main.status === "fail" ? "text-red-400" : "text-amber-600 dark:text-yellow-300"
                                    }`}
                                  >
                                    {main.reason}
                                    {extra > 0 && <span className="text-muted-foreground"> +{extra} más</span>}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[320px]" side="top">
                                  <ul className="text-xs space-y-1">
                                    {(p.issues as HealthDimension[]).map((d) => (
                                      <li key={d.key}>
                                        <span className="font-medium">{d.reason}</span>
                                        <br />
                                        <span className="text-muted-foreground">{d.action}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {p.healthScore ?? "—"}
                            <div className="font-sans">
                              <RowDelta current={p.healthScore} previous={p.healthScorePrevious} lowerIsBetter={false} minChange={1} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {p.doneCount}{" "}
                            <RowDelta current={p.doneCount} previous={p.throughputPrevious} lowerIsBetter={false} minChange={1} />
                            <div className="text-muted-foreground/60 font-sans">{p.inProgressCount} en curso</div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatDurationDays(p.cycleTimeP50)}
                            <div className="font-sans">
                              <RowDelta current={p.cycleTimeP50} previous={p.cycleTimeP50Previous} lowerIsBetter={true} unit="d" decimals={1} minChange={0.5} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {p.qaRejectionRate != null ? `${p.qaRejectionRate}%` : "—"}
                            <div className="font-sans">
                              <RowDelta current={p.qaRejectionRate} previous={p.qaRejectionRatePrevious} lowerIsBetter={true} unit="pp" decimals={1} minChange={1} />
                            </div>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger aria-label={`Más acciones para ${p.name}`} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent transition-colors">
                                <MoreHorizontal size={16} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/projects/${p.id}/health?period=${ninetyDayWindow(boardTypeMap.get(p.id))}`} className="cursor-pointer">Health</Link>
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
              {inactivePortfolio.length > 0 && (
                <p className="text-xs text-muted-foreground mt-4">
                  Sin actividad en 90 días:{" "}
                  {inactivePortfolio.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ", "}
                      <Link href={`/projects/${p.id}`} className="hover:underline">{p.name}</Link>
                    </span>
                  ))}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
