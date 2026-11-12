import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetProjectWip, getGetProjectWipQueryKey,
  useGetProjectMetrics, getGetProjectMetricsQueryKey,
  type WipItem,
} from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricTooltip } from "@/components/metric-tooltip";
import type { TimeWindow } from "@/components/time-window-filter";

type AgeBand = "ok" | "p50" | "p85";

function band(age: number, p50: number | null, p85: number | null): AgeBand {
  if (p85 !== null && age > p85) return "p85";
  if (p50 !== null && age > p50) return "p50";
  return "ok";
}

const BAND_CLASS: Record<AgeBand, string> = {
  ok: "",
  p50: "text-amber-600 dark:text-yellow-300",
  p85: "text-red-500 font-semibold",
};

const days = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("es-CL")} d`);

/** Scrumban WIP: what is in flight now and how old it is against the team's own cycle time
 *  (P50/P85 of the same period as Métricas, so the thresholds match that tab), started vs
 *  delivered per week, and the WIP the team sustains at its current pace (Little's law). */
export function WipSection({ projectId, period, enabled }: { projectId: string; period: TimeWindow; enabled: boolean }) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const { data: wip, isLoading } = useGetProjectWip(projectId, {
    query: { enabled, queryKey: getGetProjectWipQueryKey(projectId) },
  });
  const { data: metrics } = useGetProjectMetrics(projectId, period, {
    query: { enabled, queryKey: getGetProjectMetricsQueryKey(projectId, period) },
  });

  if (isLoading || !wip) {
    return <Skeleton className="h-64 w-full" />;
  }

  const hasCycle = !!metrics && metrics.resolvedCount > 0;
  const p50 = hasCycle ? metrics.cycleTimePercentiles.p50 : null;
  const p85 = hasCycle ? metrics.cycleTimePercentiles.p85 : null;
  const overP85 = wip.items.filter((i) => band(i.ageDays, p50, p85) === "p85").length;
  const overP50 = wip.items.filter((i) => band(i.ageDays, p50, p85) === "p50").length;
  const aged = wip.items.filter((i) => band(i.ageDays, p50, p85) !== "ok");
  const listed: WipItem[] = showAll ? wip.items : aged;
  const overSustainable = wip.sustainableWip !== null && wip.total > wip.sustainableWip * 1.2;
  const fullWeeks = wip.weeks.slice(0, -1);
  const netIn = fullWeeks.slice(-4).reduce((sum, w) => sum + w.started - w.delivered, 0);

  return (
    <Card className="bg-card/40">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-1">
          {t("page.wip.title")}
          <MetricTooltip description={t("page.wip.tooltip")} />
        </CardTitle>
        <CardDescription>{t("page.wip.subtitle", { p50: days(p50), p85: days(p85) })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <div>
            <div className={`text-3xl font-bold ${overSustainable ? "text-amber-600 dark:text-yellow-300" : ""}`}>{wip.total}</div>
            <div className="text-xs text-muted-foreground">{t("page.wip.inProgressNow")}</div>
          </div>
          <div>
            <div className="text-3xl font-bold">{wip.sustainableWip === null ? "—" : `~${Math.round(wip.sustainableWip)}`}</div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {t("page.wip.sustainable")}
              <MetricTooltip description={t("page.wip.sustainableTooltip", { cycle: days(wip.meanCycleTimeDays) })} />
            </div>
          </div>
          <div>
            <div className={`text-3xl font-bold ${overP85 > 0 ? "text-red-500" : ""}`}>{p85 === null ? "—" : overP85}</div>
            <div className="text-xs text-muted-foreground">{t("page.wip.overP85", { p85: days(p85) })}</div>
          </div>
          <div>
            <div className={`text-3xl font-bold ${overP50 > 0 ? "text-amber-600 dark:text-yellow-300" : ""}`}>{p50 === null ? "—" : overP50}</div>
            <div className="text-xs text-muted-foreground">{t("page.wip.overP50", { p50: days(p50) })}</div>
          </div>
        </div>

        {overSustainable && (
          <p className="text-sm text-amber-600 dark:text-yellow-300">
            {t("page.wip.overSustainableNote", { total: wip.total, sustainable: Math.round(wip.sustainableWip!) })}
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium mb-2">{t("page.wip.byStatus")}</h3>
            {wip.byStatus.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("page.wip.empty")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="py-1 text-left font-medium">{t("page.wip.status")}</th>
                    <th className="py-1 text-right font-medium">{t("page.wip.count")}</th>
                    <th className="py-1 text-right font-medium">{t("page.wip.oldest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {wip.byStatus.map((s) => (
                    <tr key={s.status} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5">
                        {s.status}
                        {!s.active && (
                          <span className="ml-2 text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground">{t("page.wip.waiting")}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono">{s.count}</td>
                      <td className={`py-1.5 text-right font-mono ${BAND_CLASS[band(s.oldestDays, p50, p85)]}`}>{days(s.oldestDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className="text-sm font-medium mb-1 flex items-center gap-1">
              {t("page.wip.flowTitle")}
              <MetricTooltip description={t("page.wip.flowTooltip")} />
            </h3>
            <p className="text-xs text-muted-foreground mb-2">
              {netIn > 0 ? t("page.wip.netInGrowing", { n: netIn }) : netIn < 0 ? t("page.wip.netInShrinking", { n: -netIn }) : t("page.wip.netInFlat")}
            </p>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={wip.weeks.map((w) => ({ ...w, label: w.weekStart.slice(5).split("-").reverse().join("/") }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="started" name={t("page.wip.started")} fill="#f59e0b" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="delivered" name={t("page.wip.delivered")} fill="#8b5cf6" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">
              {showAll ? t("page.wip.allItems", { count: wip.items.length }) : t("page.wip.agedItems", { count: aged.length })}
            </h3>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAll((v) => !v)}>
              {showAll ? t("page.wip.showAged") : t("page.wip.showAll", { count: wip.items.length })}
            </button>
          </div>
          {listed.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("page.wip.noAged")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="py-1 pr-3 text-left font-medium">{t("page.wip.key")}</th>
                    <th className="py-1 px-3 text-left font-medium">{t("page.wip.summary")}</th>
                    <th className="py-1 px-3 text-left font-medium">{t("page.wip.status")}</th>
                    <th className="py-1 px-3 text-left font-medium">{t("page.wip.assignee")}</th>
                    <th className="py-1 pl-3 text-right font-medium">{t("page.wip.age")}</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((i) => (
                    <tr key={i.key} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{i.key}</td>
                      <td className="py-1.5 px-3 max-w-[360px] truncate" title={i.summary}>{i.summary}</td>
                      <td className="py-1.5 px-3 whitespace-nowrap">{i.status}</td>
                      <td className="py-1.5 px-3 whitespace-nowrap">{i.assignee ?? t("page.wip.unassigned")}</td>
                      <td className={`py-1.5 pl-3 text-right font-mono whitespace-nowrap ${BAND_CLASS[band(i.ageDays, p50, p85)]}`}>{days(i.ageDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
