import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, getGetProjectQueryKey, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertTriangle, Clock, RefreshCw, Pencil, Check, X } from "lucide-react";
import { useState, useEffect } from "react";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";
import FlowHealthCard from "@/components/flow-health-card";
import { TimeWindowFilter, type TimeWindow } from "@/components/time-window-filter";

const CATEGORY_LABEL: Record<string, string> = {
  new: "Por hacer",
  indeterminate: "En progreso",
  done: "Completado",
  other: "Otro",
};

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  new: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  indeterminate: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  done: "bg-green-500/15 text-green-600 dark:text-green-400",
  other: "bg-muted text-muted-foreground",
};

export default function ProjectFlow() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<TimeWindow>("1m");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingFlagKey, setEditingFlagKey] = useState<string | null>(null);
  const [flagReasonDraft, setFlagReasonDraft] = useState("");
  const [savingFlagKey, setSavingFlagKey] = useState<string | null>(null);

  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: currentUser } = useGetCurrentUser({ query: { enabled: !!token, queryKey: getGetCurrentUserQueryKey() } });
  const canEditFlagReason = currentUser?.role === "admin";

  // Scrum projects speak in sprints, not calendar time - switch the filter's meaning (and default
  // value) the moment we learn the board type, same as project-detail.tsx's Resumen tab.
  useEffect(() => {
    if (project?.boardType === "scrum" && (period === "1m" || period === "3m")) {
      setPeriod("2s");
    } else if (project?.boardType && project.boardType !== "scrum" && (period === "2s" || period === "6s")) {
      setPeriod("1m");
    }
  }, [project?.boardType]);

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
        // An aborted request means a newer one superseded it (period changed, e.g. the
        // boardType-driven 1m -> 2s switch right after load) - not a real failure, so don't
        // flash the "no data" error over whatever the in-flight replacement is about to render.
        if (controller.signal.aborted) return;
        console.error(err);
        setError(t("page.flow.noTransitionData"));
      })
      .finally(() => {
        clearTimeout(timeout);
        if (controller.signal.aborted) return;
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
  const wipAgingTotal = data?.wipAgingTotal ?? wipItems.length;
  // Computed server-side over the FULL wip-aging list, not just the (up to) 10 oldest shown below —
  // filtering wipItems here would silently undercount critical/warning items ranked 11+.
  const wipAgingCounts = data?.wipAgingCounts ?? { critical: 0, warning: 0, watch: 0 };
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

  const saveFlagReason = async (issueKey: string, reason: string) => {
    if (!projectId || !token) return;
    setSavingFlagKey(issueKey);
    try {
      const r = await fetch(`/api/projects/${projectId}/blocked-reasons/${encodeURIComponent(issueKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      if (!r.ok) throw new Error(`Failed to save flag reason: ${r.status}`);
      const trimmed = reason.trim();
      setData((prev: any) => ({
        ...prev,
        blockedIssues: (prev?.blockedIssues ?? []).map((b: any) =>
          b.key === issueKey ? { ...b, flagReason: trimmed || null } : b
        ),
      }));
      setEditingFlagKey(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingFlagKey(null);
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
          <TimeWindowFilter
            boardType={project?.boardType ?? "kanban"}
            value={period}
            onChange={setPeriod}
          />
        </div>
      </div>

      <ProjectTabs projectId={projectId!} active="flow" />

      <Card className="bg-card/40">
        <CardContent className="pt-6">
          <FlowHealthCard projectId={projectId!} period={period} />
        </CardContent>
      </Card>

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
                    <TableHead className="w-[220px]">{t('page.flow.timeShare')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timeInStatus.map((entry: any) => {
                    const totalAvgDays = timeInStatus.reduce((sum: number, s: any) => sum + s.avgDays, 0) || 1;
                    const pct = (entry.avgDays / totalAvgDays) * 100;
                    const maxPct = Math.max(...timeInStatus.map((s: any) => (s.avgDays / totalAvgDays) * 100));
                    const isBottleneck = pct === maxPct && entry.avgDays > 0;
                    return (
                      <TableRow
                        key={entry.status}
                        className={`border-border hover:bg-accent/50 ${isBottleneck ? "bg-red-500/5" : ""}`}
                      >
                        <TableCell className="font-medium">
                          {entry.status}
                          {isBottleneck && (
                            <span className="ml-2 text-[11px] font-semibold text-red-500">{t('page.flow.bottleneck')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_BADGE_CLASS[entry.category] ?? CATEGORY_BADGE_CLASS.other}`}>
                            {CATEGORY_LABEL[entry.category] ?? entry.category}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono">{entry.avgDays}d</TableCell>
                        <TableCell className="text-right font-mono">{entry.medianDays}d</TableCell>
                        <TableCell className="text-right font-mono">{entry.issueCount}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 rounded-sm bg-muted flex-1 overflow-hidden">
                              <div
                                className={`h-full rounded-sm transition-all ${isBottleneck ? "bg-red-500" : "bg-primary"}`}
                                style={{ width: `${Math.max(pct, 2)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-9 text-right">{pct.toFixed(0)}%</span>
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
          <CardDescription>
            {wipAgingTotal} {t('page.flow.agingDesc')} — {wipAgingCounts.critical} {t('page.flow.critical')}, {wipAgingCounts.warning} {t('page.flow.warning')}, {wipAgingCounts.watch} {t('page.flow.watch')}
            {wipAgingTotal > wipItems.length && (
              <span className="block text-xs mt-0.5">{t('page.flow.showingOldest', { count: wipItems.length })}</span>
            )}
          </CardDescription>
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
                    <TableHead>{t('page.flow.since')}</TableHead>
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
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {item.enteredDate ? new Date(item.enteredDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </TableCell>
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
                    <TableHead>{t('page.flow.key')}</TableHead>
                    <TableHead>{t('page.flow.summary')}</TableHead>
                    <TableHead>{t('page.flow.type')}</TableHead>
                    <TableHead>{t('page.flow.priority')}</TableHead>
                    <TableHead>{t('page.flow.status')}</TableHead>
                    <TableHead>{t('page.flow.reason')}</TableHead>
                    <TableHead>{t('page.flow.flagReason')}</TableHead>
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
                      <TableCell className="text-xs text-muted-foreground">
                        {item.blockReason === "both" ? t('page.flow.reasonBoth')
                          : item.blockReason === "flag" ? t('page.flow.reasonFlag')
                          : item.blockReason === "status" ? t('page.flow.reasonStatus')
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-[240px] text-xs text-muted-foreground">
                        {editingFlagKey === item.key ? (
                          <div className="flex items-center gap-1">
                            <Input
                              autoFocus
                              value={flagReasonDraft}
                              onChange={(e) => setFlagReasonDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveFlagReason(item.key, flagReasonDraft);
                                if (e.key === "Escape") setEditingFlagKey(null);
                              }}
                              maxLength={500}
                              disabled={savingFlagKey === item.key}
                              className="h-7 text-xs"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                              disabled={savingFlagKey === item.key}
                              onClick={() => saveFlagReason(item.key, flagReasonDraft)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 shrink-0"
                              disabled={savingFlagKey === item.key}
                              onClick={() => setEditingFlagKey(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <span className="truncate" title={item.flagReason ?? undefined}>
                              {item.flagReason || "—"}
                            </span>
                            {canEditFlagReason && item.flagReasonEditable && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100"
                                onClick={() => {
                                  setEditingFlagKey(item.key);
                                  setFlagReasonDraft(item.flagReason ?? "");
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
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
