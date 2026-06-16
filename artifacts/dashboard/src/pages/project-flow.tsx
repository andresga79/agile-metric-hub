import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { getAuthToken } from "@/lib/auth";

type Period = "1m" | "3m";

export default function ProjectFlow() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }
    if (!token) {
      setLoading(false);
      setData(null);
      setError(t("page.flow.notFound"));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    setLoading(true);
    setError(null);
    fetch(`/api/projects/${projectId}/analytics/${period}`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) {
          throw new Error(`Analytics request failed: ${r.status}`);
        }
        return r.json();
      })
      .then(setData)
      .catch((err) => {
        console.error(err);
        setError(t("page.flow.noTransitionData"));
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
}, [projectId, period, token]);

  if (loading) return <div>{t('page.flow.loading')}</div>;
  if (!project) return <div>{t('page.flow.notFound')}</div>;
  if (error) return <div>{error}</div>;

  const wipItems = data?.wipAging ?? [];
  const blockedItems = data?.blockedIssues ?? [];
  const timeInStatus = data?.timeInStatus ?? [];
  const fetchedAt = data?.fetchedAt ?? null;

  const refreshData = async () => {
    if (!projectId || !token) return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(`/api/projects/${projectId}/analytics/${period}?refresh=true`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        throw new Error(`Analytics refresh failed: ${r.status}`);
      }
      setData(await r.json());
    } catch (err) {
      console.error(err);
      setError(t("page.flow.noTransitionData"));
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {project && (
              <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                <ArrowLeft size={14} />
                {project.name}
              </Link>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.flow.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {fetchedAt
              ? <>{t('page.flow.lastUpdated')} {new Date(fetchedAt).toLocaleString()} &middot; <button onClick={refreshData} className="underline hover:text-foreground cursor-pointer">{t('page.flow.refresh')}</button></>
              : t('page.flow.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshData}
            disabled={loading}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
            title={t('page.flow.forceRefresh')}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {t('page.flow.refresh')}
          </button>
          <div className="flex bg-background border border-border rounded-md p-1">
            {(["1m", "3m"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock size={18} />
            {t('page.flow.timeInStatus')}
          </CardTitle>
          <CardDescription>{timeInStatus.length} {t('page.flow.timeInStatusDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {timeInStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.flow.noTransitionData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.flow.status')}</TableHead>
                    <TableHead>{t('page.flow.category')}</TableHead>
                    <TableHead className="text-right">{t('page.flow.avgDays')}</TableHead>
                    <TableHead className="text-right">{t('page.flow.medianDays')}</TableHead>
                    <TableHead className="text-right">{t('page.flow.issues')}</TableHead>
                    <TableHead className="w-[200px]">{t('page.flow.distribution')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeInStatus.map((entry: any) => {
                    const maxAvg = Math.max(...timeInStatus.map((s: any) => s.avgDays), 1);
                    const pct = (entry.avgDays / maxAvg) * 100;
                    const barColor =
                      entry.avgDays >= 14 ? "bg-red-500"
                        : entry.avgDays >= 7 ? "bg-orange-500"
                        : entry.avgDays >= 3 ? "bg-amber-500"
                        : "bg-green-500";
                    return (
                      <TableRow key={entry.status} className="border-border hover:bg-accent/50">
                        <TableCell className="font-medium">{entry.status}</TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">{entry.category}</TableCell>
                        <TableCell className="text-right font-mono">{entry.avgDays}d</TableCell>
                        <TableCell className="text-right font-mono">{entry.medianDays}d</TableCell>
                        <TableCell className="text-right font-mono">{entry.issueCount}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-3 rounded-sm bg-muted flex-1 overflow-hidden">
                              <div
                                className={`h-full rounded-sm ${barColor} transition-all`}
                                style={{ width: `${Math.max(pct, 2)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right">{entry.avgDays}d</span>
                          </div>
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

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock size={18} />
            {t('page.flow.agingTitle')}
          </CardTitle>
          <CardDescription>{wipItems.length} {t('page.flow.agingDesc')} — {wipItems.filter((i: any) => i.alertLevel === "critical").length} {t('page.flow.critical')}, {wipItems.filter((i: any) => i.alertLevel === "warning").length} {t('page.flow.warning')}, {wipItems.filter((i: any) => i.alertLevel === "watch").length} {t('page.flow.watch')}</CardDescription>
        </CardHeader>
        <CardContent>
          {wipItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.flow.noIssues')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.flow.key')}</TableHead>
                    <TableHead>{t('page.flow.summary')}</TableHead>
                    <TableHead>{t('page.flow.type')}</TableHead>
                    <TableHead>{t('page.flow.priority')}</TableHead>
                    <TableHead>{t('page.flow.assignee')}</TableHead>
                    <TableHead>{t('page.flow.alert')}</TableHead>
                    <TableHead className="text-right">{t('page.flow.daysInProgress')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {wipItems.map((item: any) => {
                    const days = item.daysInProgress ?? 0;
                    const alertLevel = item.alertLevel;
                    const alertBadge = alertLevel === "critical" ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400">{t('page.flow.criticalLabel')}</span>
                      : alertLevel === "warning" ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-500/15 text-orange-400">{t('page.flow.warningLabel')}</span>
                      : alertLevel === "watch" ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400">{t('page.flow.watchLabel')}</span>
                      : <span className="text-xs text-muted-foreground">—</span>;
                    return (
                      <TableRow key={item.id} className={`border-border hover:bg-accent/50 ${alertLevel === "critical" ? "bg-red-500/5" : alertLevel === "warning" ? "bg-orange-500/5" : ""}`}>
                        <TableCell className="font-mono text-xs text-primary">{item.key}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={item.summary}>{item.summary}</TableCell>
                        <TableCell>{item.issueType}</TableCell>
                        <TableCell>{item.priority}</TableCell>
                        <TableCell>{item.assignee ?? "—"}</TableCell>
                        <TableCell>{alertBadge}</TableCell>
                        <TableCell className="text-right font-mono">{item.daysInProgress !== null ? `${item.daysInProgress}d` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle size={18} />
            {t('page.flow.blockedTitle')}
          </CardTitle>
          <CardDescription>
            <span className="text-red-400 font-semibold">🔴 {blockedItems.filter((b: any) => b.isCurrentlyBlocked).length} {t('page.flow.blockedNow')}</span>
            <span className="text-muted-foreground"> · {blockedItems.length} {t('page.flow.blockedDesc')} · ↑{blockedItems.length > 0 ? Math.max(...blockedItems.map((b: any) => b.totalDays)).toFixed(1) : 0}d {t('page.flow.maxBlocked')}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blockedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.flow.noBlocked')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>Key</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>{t('page.flow.status')}</TableHead>
                    <TableHead className="text-right">{t('page.flow.totalBlockedDays')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blockedItems.map((item: any) => (
                    <TableRow key={item.key} className={`border-border hover:bg-accent/50 ${item.isCurrentlyBlocked ? 'bg-red-500/5' : ''}`}>
                      <TableCell className="font-mono text-xs text-primary">{item.key}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={item.summary}>{item.summary}</TableCell>
                      <TableCell>{item.issueType}</TableCell>
                      <TableCell>{item.priority}</TableCell>
                      <TableCell>
                        {item.isCurrentlyBlocked
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded">🔴 {item.currentStatus}</span>
                          : <span className="text-xs text-muted-foreground">{item.currentStatus}</span>
                        }
                      </TableCell>
                      <TableCell className="text-right font-mono text-red-400">{item.totalDays}d</TableCell>
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
