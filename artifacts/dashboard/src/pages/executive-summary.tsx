import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useListUserProjects, getListUserProjectsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricTooltip } from "@/components/metric-tooltip";
import { TrendingUp, ShieldAlert, Zap } from "lucide-react";
import { useState, useEffect } from "react";

export default function ExecutiveSummary() {
  const { t } = useTranslation();
  const [portfolioData, setPortfolioData] = useState<any[]>([]);

  const { data: summary, isLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey() }
  });

  const { data: userProjects } = useListUserProjects({
    query: { queryKey: getListUserProjectsQueryKey() }
  });
  const visibleProjects = userProjects?.filter((p) => p.visible) ?? [];
  const visibleIds = new Set(visibleProjects.map((p) => p.id));

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    fetch("/api/portfolio", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setPortfolioData)
      .catch(console.error);
  }, []);

  const visiblePortfolio = portfolioData.filter((p: any) => visibleIds.has(p.id));
  const totalThroughput = visiblePortfolio.reduce((s: number, p: any) => s + p.throughput, 0);
  const totalWip = visiblePortfolio.reduce((s: number, p: any) => s + p.inProgressCount, 0);
  const avgCycleP50 = (() => {
    const valid = visiblePortfolio.filter((p: any) => p.cycleTimeP50 !== null);
    if (valid.length === 0) return null;
    return valid.reduce((s: number, p: any) => s + p.cycleTimeP50, 0) / valid.length;
  })();

  const totalIssues = visiblePortfolio.reduce((s: number, p: any) => s + p.issueCount, 0);
  const totalDone = visiblePortfolio.reduce((s: number, p: any) => s + p.doneCount, 0);

  const avgLeadTime = (() => {
    const valid = visiblePortfolio.filter((p: any) => p.leadTimeAvg !== null);
    if (valid.length === 0) return null;
    return valid.reduce((s: number, p: any) => s + p.leadTimeAvg, 0) / valid.length;
  })();

  const bestThroughput = visiblePortfolio.length > 0
    ? visiblePortfolio.reduce((best: any, p: any) => p.throughput > (best?.throughput ?? -1) ? p : best, visiblePortfolio[0])
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Zap size={28} className="text-primary" />
          {t('page.executive.title')}
        </h1>
        <p className="text-muted-foreground mt-1">{t('page.executive.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.executive.totalProjects')}<MetricTooltip description={t('tooltip.activeProjects')} /></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{visiblePortfolio.length}</div>
            <p className="text-xs text-muted-foreground mt-1">{t('page.executive.activeProjects')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-l-4 border-l-emerald-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.executive.totalThroughput')}<MetricTooltip description={t('tooltip.throughput90d')} /></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalThroughput}</div>
            <p className="text-xs text-muted-foreground mt-1">{t('page.executive.last90d')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-l-4 border-l-amber-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.executive.totalWip')}<MetricTooltip description={t('tooltip.totalWip')} /></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalWip}</div>
            <p className="text-xs text-muted-foreground mt-1">{avgCycleP50 !== null ? `${t('page.executive.avgCycleP50')} ${avgCycleP50.toFixed(1)}d` : "—"}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.executive.completionRate')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalIssues > 0 ? `${((totalDone / totalIssues) * 100).toFixed(0)}%` : "—"}</div>
            <p className="text-xs text-muted-foreground mt-1">{totalDone}/{totalIssues} {t('page.executive.issuesCompleted')}</p>
          </CardContent>
        </Card>
      </div>

      {bestThroughput && (
        <Card className="bg-card/40 border border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp size={20} className="text-primary" />
              {t('page.executive.topPerformer')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <Link href={`/projects/${bestThroughput.id}`} className="text-xl font-bold text-primary hover:underline">
                  {bestThroughput.name}
                </Link>
                <p className="text-sm text-muted-foreground mt-1">{t('page.executive.topPerformerDesc')}</p>
              </div>
              <div className="grid grid-cols-3 gap-6 text-center">
                <div>
                  <div className="text-2xl font-bold">{bestThroughput.throughput}</div>
                  <div className="text-xs text-muted-foreground">{t('page.executive.throughput')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{bestThroughput.cycleTimeP50?.toFixed(1) ?? "—"}d</div>
                  <div className="text-xs text-muted-foreground">{t('page.executive.cycleTimeShort')}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{bestThroughput.doneCount}</div>
                  <div className="text-xs text-muted-foreground">{t('page.executive.completed')}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="text-lg">{t('page.executive.avgMetrics')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground">{t('page.dashboard.avgVelocity')}</span>
                <span className="text-lg font-bold">{summary?.avgVelocity.toFixed(1) ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground">{t('page.dashboard.avgCycleTime')}</span>
                <span className="text-lg font-bold">{summary?.avgCycleTime.toFixed(1) ?? "—"}d</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground">{t('page.executive.totalIssues')}</span>
                <span className="text-lg font-bold">{summary?.totalIssuesResolved ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground">{t('page.executive.avgLeadTime')}</span>
                <span className="text-lg font-bold">{avgLeadTime?.toFixed(1) ?? "—"}d</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert size={18} />
              {t('page.executive.healthSummary')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  {t('page.executive.goodHealth')}
                </span>
                <span className="text-lg font-bold text-green-400">
                  {visiblePortfolio.filter((p: any) => p.cycleTimeP50 !== null && p.cycleTimeP50 <= 10).length}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  {t('page.executive.fairHealth')}
                </span>
                <span className="text-lg font-bold text-amber-400">
                  {visiblePortfolio.filter((p: any) => p.cycleTimeP50 !== null && p.cycleTimeP50 > 10 && p.cycleTimeP50 <= 20).length}
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {t('page.executive.poorHealth')}
                </span>
                <span className="text-lg font-bold text-red-400">
                  {visiblePortfolio.filter((p: any) => p.cycleTimeP50 !== null && p.cycleTimeP50 > 20).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-500" />
                  {t('page.executive.noData')}
                </span>
                <span className="text-lg font-bold text-muted-foreground">
                  {visiblePortfolio.filter((p: any) => p.cycleTimeP50 === null).length}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
