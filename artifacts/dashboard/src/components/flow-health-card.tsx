import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import type { TimeWindow } from "@/components/time-window-filter";

interface FlowHealthCardProps {
  projectId: string;
  period?: TimeWindow;
  compact?: boolean;
}

const DEFAULT_FLOW_HEALTH_THRESHOLDS = {
  flowEfficiency: { good: 25, warning: 15 },
  wipAging: { good: 3, warning: 14 },
};

export default function FlowHealthCard({ projectId, period = "3m", compact = false }: FlowHealthCardProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [thresholds, setThresholds] = useState(DEFAULT_FLOW_HEALTH_THRESHOLDS);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    const token = localStorage.getItem("auth_token");
    fetch(`/api/projects/${projectId}/analytics/${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, period]);

  useEffect(() => {
    if (!projectId) return;
    const token = localStorage.getItem("auth_token");
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`/api/admin/metric-thresholds`, { headers }).then((r) => r.json()).catch(() => [] as any[]),
      fetch(`/api/admin/metric-thresholds/project/${projectId}`, { headers }).then((r) => r.json()).catch(() => [] as any[]),
    ]).then(([global, overrides]) => {
      const merged = { ...DEFAULT_FLOW_HEALTH_THRESHOLDS };
      for (const source of [global, overrides]) {
        if (!Array.isArray(source)) continue;
        for (const t of source) {
          if (t.metric === "flowEfficiency" || t.metric === "wipAging") {
            merged[t.metric as "flowEfficiency" | "wipAging"] = {
              good: Number(t.goodValue),
              warning: Number(t.warningValue),
            };
          }
        }
      }
      setThresholds(merged);
    }).catch(() => {});
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">{t('page.flowHealth.noData')}</p>;
  }

  const timeInStatus = (data?.timeInStatus ?? []).sort((a: any, b: any) => b.avgDays - a.avgDays);
  const wipItems = data?.wipAging ?? [];
  const blockedItems = data?.blockedIssues ?? [];
  const flowEff = data?.flowEfficiency;
  const criticalCount = wipItems.filter((i: any) => i.alertLevel === "critical").length;
  const warningCount = wipItems.filter((i: any) => i.alertLevel === "warning").length;
  const watchCount = wipItems.filter((i: any) => i.alertLevel === "watch").length;
  const bottleneck = timeInStatus.length > 0 ? timeInStatus[0] : null;
  const maxAvg = timeInStatus.length > 0 ? Math.max(...timeInStatus.map((s: any) => s.avgDays), 1) : 1;

  const flowEffLabel = flowEff !== null && flowEff !== undefined
    ? flowEff >= thresholds.flowEfficiency.good ? t('page.flowHealth.efficient')
      : flowEff >= thresholds.flowEfficiency.warning ? t('page.flowHealth.fair')
      : t('page.flowHealth.poor')
    : null;

  const flowEffColor = flowEff !== null && flowEff !== undefined
    ? flowEff >= thresholds.flowEfficiency.good ? "text-green-500"
      : flowEff >= thresholds.flowEfficiency.warning ? "text-amber-500"
      : "text-red-500"
    : "";

  const maxBlockedDays = blockedItems.length > 0
    ? Math.max(...blockedItems.map((b: any) => b.totalDays))
    : 0;

  const topStatuses = compact ? timeInStatus.slice(0, 4) : timeInStatus;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Clock size={14} />
          {t('page.flow.timeInStatus')}
        </div>
        {topStatuses.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('page.flow.noTransitionData')}</p>
        ) : (
          <div className="space-y-1.5">
            {topStatuses.map((entry: any, idx: number) => {
              const pct = (entry.avgDays / maxAvg) * 100;
              // Reuses the wipAging threshold (Admin -> Health) since both measure "days an issue
              // has been sitting somewhere it shouldn't" — the midpoint splits it into the same
              // 3 bands the backend derives for WIP aging alertLevel (see analytics.ts).
              const agingMidpoint = (thresholds.wipAging.good + thresholds.wipAging.warning) / 2;
              const isBottleneck = idx === 0 && entry.avgDays > thresholds.wipAging.good;
              const barColor = isBottleneck ? "bg-red-500"
                : entry.avgDays >= agingMidpoint ? "bg-orange-500"
                : entry.avgDays >= thresholds.wipAging.good ? "bg-amber-500"
                : "bg-green-500";
              return (
                <div key={entry.status} className="flex items-center gap-2">
                  <span className="text-xs w-24 truncate shrink-0" title={entry.status}>
                    {entry.status}
                    {isBottleneck && <span className="text-red-500 ml-0.5">←</span>}
                  </span>
                  <div className="h-4 rounded-sm bg-muted flex-1 overflow-hidden">
                    <div className={`h-full rounded-sm ${barColor} transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-10 text-right shrink-0">{entry.avgDays.toFixed(1)}d</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {bottleneck && bottleneck.avgDays > thresholds.wipAging.good && (
        <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-red-500/10 text-red-400 border border-red-500/20">
          <AlertTriangle size={14} />
          <span><strong>{t('page.flowHealth.bottleneck')}:</strong> {bottleneck.status} ({bottleneck.avgDays.toFixed(1)}d {t('page.flow.avgDays').toLowerCase()})</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-border p-2">
          <div className={`text-lg font-bold ${flowEffColor}`}>{flowEff !== null ? `${flowEff}%` : "—"}</div>
          <div className="text-xs text-muted-foreground">{t('page.flowHealth.flowEfficiency')}</div>
        </div>
        <div className="rounded-lg border border-border p-2">
          <div className="text-lg font-bold">
            {criticalCount > 0 && <span className="text-red-400">{criticalCount}</span>}
            {criticalCount > 0 && warningCount > 0 && <span className="text-muted-foreground"> · </span>}
            {warningCount > 0 && <span className="text-orange-400">{warningCount}</span>}
            {(criticalCount > 0 || warningCount > 0) && <span className="text-muted-foreground"> · </span>}
            {watchCount > 0 && <span className="text-amber-400">{watchCount}</span>}
            {criticalCount === 0 && warningCount === 0 && watchCount === 0 && <span className="text-muted-foreground">0</span>}
          </div>
          <div className="text-xs text-muted-foreground">{t('page.flowHealth.wipAging')}</div>
        </div>
        <div className="rounded-lg border border-border p-2">
          <div className={`text-lg font-bold ${blockedItems.length > 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
            {blockedItems.length}
          </div>
          <div className="text-xs text-muted-foreground">
            {blockedItems.length > 0 ? `↑${maxBlockedDays.toFixed(0)}d` : t('page.flowHealth.blocked')}
          </div>
        </div>
      </div>
    </div>
  );
}
