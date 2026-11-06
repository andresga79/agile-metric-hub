import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetProjectSprintMetrics,
  getGetProjectSprintMetricsQueryKey,
  useGetProjectSprintSummary,
  getGetProjectSprintSummaryQueryKey,
  type SprintSummaryKpis,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useThresholds } from "@/hooks/use-thresholds";

// Rovo-style per-sprint report for the Resumen tab. "Completed" = done when the sprint closed
// ("% real cerrado"), compared against the sprint that closed before it.

const DEFAULT_COMPLETION_THRESHOLD = { good: 80, warning: 50 };

const pct = (v: number) => `${v.toFixed(1)}%`;
const sp = (v: number) => v.toFixed(0);

function dateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function dateOnly(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function spanDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
}

/** "+11 SP" / "-2.3 pp" with the sign colored: green when the change is good. */
function Delta({ value, unit, higherIsBetter = true }: { value: number; unit: string; higherIsBetter?: boolean }) {
  if (Math.abs(value) < 0.05) return <span className="text-muted-foreground">(=)</span>;
  const good = higherIsBetter ? value > 0 : value < 0;
  const text = `${value > 0 ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)} ${unit}`;
  return <span className={good ? "text-green-500" : "text-red-400"}>({text})</span>;
}

export function SprintSummarySection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const token = localStorage.getItem("auth_token");
  const completionThreshold = useThresholds(projectId).sprintCompletion ?? DEFAULT_COMPLETION_THRESHOLD;

  // Sprint list for the selector (same source as the Sprints tab).
  const { data: sprintList } = useGetProjectSprintMetrics(projectId, "3m", {
    query: { enabled: !!token, queryKey: getGetProjectSprintMetricsQueryKey(projectId, "3m"), retry: false },
  });
  const options = useMemo(
    () => [...(sprintList?.sprints ?? [])].filter((s) => s.state === "closed" || s.state === "active").reverse(),
    [sprintList]
  );
  const [sprintId, setSprintId] = useState<number | null>(null);
  useEffect(() => {
    // Default: the last closed sprint.
    if (sprintId === null && options.length > 0) {
      setSprintId((options.find((s) => s.state === "closed") ?? options[0]).sprintId);
    }
  }, [options, sprintId]);

  const { data, isLoading } = useGetProjectSprintSummary(projectId, sprintId ?? 0, {
    query: {
      enabled: !!token && sprintId !== null,
      queryKey: getGetProjectSprintSummaryQueryKey(projectId, sprintId ?? 0),
      retry: false,
    },
  });

  if (!sprintList || options.length === 0) return null;

  const k = data?.kpis;
  const prev = data?.previous ?? null;
  const rateClass = (r: number | null) =>
    r === null ? "text-muted-foreground"
      : r >= completionThreshold.good ? "text-green-500"
      : r >= completionThreshold.warning ? "text-orange-400"
      : "text-red-400";

  const kpiRows: Array<{
    label: string;
    value: (s: SprintSummaryKpis) => string;
    delta?: (c: SprintSummaryKpis, p: SprintSummaryKpis) => ReactNode;
    highlight?: boolean;
  }> = [
    {
      label: t("page.sprintSummary.period"),
      value: (s) => {
        const days = spanDays(s.startDate, s.closeDate ?? s.endDate);
        return `${dateOnly(s.startDate)} – ${dateOnly(s.closeDate ?? s.endDate)}${days !== null ? ` (${t("page.sprintSummary.days", { count: days })})` : ""}`;
      },
    },
    { label: t("page.sprintSummary.closeDate"), value: (s) => (s.closeDate ? dateTime(s.closeDate) : t("page.sprintSummary.notClosed")) },
    {
      label: t("page.sprintSummary.committed"),
      value: (s) => `${sp(s.committedStoryPoints)} SP`,
      delta: (c, p) => <Delta value={c.committedStoryPoints - p.committedStoryPoints} unit="SP" />,
    },
    {
      label: t("page.sprintSummary.delivered"),
      value: (s) => `${sp(s.deliveredStoryPoints)} SP`,
      delta: (c, p) => <Delta value={c.deliveredStoryPoints - p.deliveredStoryPoints} unit="SP" />,
    },
    {
      label: t("page.sprintSummary.completionRate"),
      value: (s) => pct(s.completionRate),
      highlight: true,
      delta: (c, p) => <Delta value={c.completionRate - p.completionRate} unit="pp" />,
    },
    {
      label: t("page.sprintSummary.totalIssues"),
      value: (s) => `${s.totalIssues}${s.unestimatedIssues > 0 ? ` (${t("page.sprintSummary.unestimatedShort", { count: s.unestimatedIssues })})` : ""}`,
      delta: (c, p) => <Delta value={c.totalIssues - p.totalIssues} unit="" />,
    },
    {
      label: t("page.sprintSummary.completedIssues"),
      value: (s) => `${s.completedIssues} (${pct(s.issueCompletionRate)})`,
      delta: (c, p) => <Delta value={c.completedIssues - p.completedIssues} unit="" />,
    },
    {
      label: t("page.sprintSummary.incomplete"),
      value: (s) => t("page.sprintSummary.ticketsSp", { count: s.incompleteIssues, sp: sp(s.incompleteStoryPoints) }),
      delta: (c, p) => <Delta value={c.incompleteStoryPoints - p.incompleteStoryPoints} unit="SP" higherIsBetter={false} />,
    },
    {
      label: t("page.sprintSummary.bugs"),
      value: (s) => (s.bugsTotal > 0 ? `${pct((s.bugsCompleted / s.bugsTotal) * 100)} (${t("page.sprintSummary.ofN", { done: s.bugsCompleted, total: s.bugsTotal })})` : "—"),
    },
  ];

  const chartData = (data?.members ?? []).map((m) => ({
    name: m.name ?? t("page.sprintSummary.unassigned"),
    completed: m.completedStoryPoints,
    pending: m.incompleteStoryPoints,
  }));

  return (
    <Card className="bg-card/40">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{t("page.sprintSummary.title")}</CardTitle>
            <CardDescription>{t("page.sprintSummary.subtitle")}</CardDescription>
          </div>
          <select
            className="bg-background border border-border rounded-md px-3 py-1.5 text-sm"
            value={sprintId ?? ""}
            onChange={(e) => setSprintId(Number(e.target.value))}
            aria-label={t("page.sprintSummary.selectSprint")}
          >
            {options.map((s) => (
              <option key={s.sprintId} value={s.sprintId}>
                {s.sprintName}{s.state === "active" ? ` (${t("page.sprintSummary.inProgress")})` : ""}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-8">
        {isLoading || !k ? (
          <p className="text-sm text-muted-foreground">{t("page.sprintSummary.loading")}</p>
        ) : (
          <>
            {k.state !== "closed" && (
              <p className="text-xs text-blue-400">{t("page.sprintSummary.activeNote")}</p>
            )}

            {/* 1. KPIs vs previous sprint */}
            <section>
              <h3 className="text-sm font-semibold mb-2">1 · {t("page.sprintSummary.kpisTitle")}</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>{t("page.sprintSummary.metric")}</TableHead>
                      <TableHead className="text-right">{k.sprintName}</TableHead>
                      <TableHead className="text-right">
                        {prev ? t("page.sprintSummary.vsPrevious", { name: prev.sprintName }) : t("page.sprintSummary.noPrevious")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpiRows.map((row) => (
                      <TableRow key={row.label} className="border-border hover:bg-accent/50">
                        <TableCell className="font-medium">{row.label}</TableCell>
                        <TableCell className={`text-right font-mono text-sm ${row.highlight ? `font-semibold ${rateClass(k.completionRate)}` : ""}`}>
                          {row.value(k)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {prev ? (
                            <>
                              {row.value(prev)} {row.delta ? row.delta(k, prev) : null}
                            </>
                          ) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            {/* 2. SP per member chart */}
            {chartData.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold mb-2">2 · {t("page.sprintSummary.chartTitle")}</h3>
                <div style={{ height: Math.max(180, chartData.length * 34 + 60) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={170} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                        itemStyle={{ color: "hsl(var(--foreground))" }}
                        cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="completed" stackId="sp" fill="hsl(142, 76%, 36%)" name={t("page.sprintSummary.completedSp")} />
                      <Bar dataKey="pending" stackId="sp" fill="hsl(var(--muted-foreground))" fillOpacity={0.45} name={t("page.sprintSummary.pendingSp")} radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {/* 3. Per member table */}
            <section>
              <h3 className="text-sm font-semibold mb-2">3 · {t("page.sprintSummary.membersTitle")}</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>{t("page.sprintSummary.member")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.ticketsTotal")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.ticketsDone")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.spTotal")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.spDone")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.rateSp")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.members ?? []).map((m) => (
                      <TableRow key={m.accountId ?? "unassigned"} className="border-border hover:bg-accent/50">
                        <TableCell className="font-medium">{m.name ?? t("page.sprintSummary.unassigned")}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {m.totalIssues}
                          {m.unestimatedIssues > 0 && (
                            <span className="text-xs text-muted-foreground"> ({t("page.sprintSummary.unestimatedShort", { count: m.unestimatedIssues })})</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{m.completedIssues}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{sp(m.totalStoryPoints)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{sp(m.completedStoryPoints)}</TableCell>
                        <TableCell
                          className={`text-right font-mono text-sm font-semibold ${rateClass(m.completionRate)}`}
                          title={m.incompleteKeys.length > 0 ? t("page.sprintSummary.pendingKeys", { keys: m.incompleteKeys.join(", ") }) : undefined}
                        >
                          {m.completionRate === null ? "—" : pct(m.completionRate)}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-border bg-muted/30 hover:bg-muted/30 font-semibold">
                      <TableCell>{t("page.sprintSummary.total")}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{k.totalIssues}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{k.completedIssues}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{sp(k.committedStoryPoints)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{sp(k.deliveredStoryPoints)}</TableCell>
                      <TableCell className={`text-right font-mono text-sm ${rateClass(k.completionRate)}`}>{pct(k.completionRate)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{t("page.sprintSummary.assigneeNote")}</p>
            </section>

            {/* 4. By issue type */}
            <section>
              <h3 className="text-sm font-semibold mb-2">4 · {t("page.sprintSummary.typesTitle")}</h3>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>{t("page.sprintSummary.type")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.total")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.completed")}</TableHead>
                      <TableHead className="text-right">{t("page.sprintSummary.incomplete")}</TableHead>
                      <TableHead>{t("page.sprintSummary.incompleteIssues")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.types ?? []).map((ty) => (
                      <TableRow key={ty.type} className="border-border hover:bg-accent/50">
                        <TableCell className="font-medium">{ty.type}</TableCell>
                        <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                          {t("page.sprintSummary.ticketsSp", { count: ty.totalIssues, sp: sp(ty.totalStoryPoints) })}
                          {ty.unestimatedIssues > 0 && (
                            <span className="text-xs text-muted-foreground"> + {t("page.sprintSummary.unestimatedShort", { count: ty.unestimatedIssues })}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm whitespace-nowrap text-green-500">
                          {t("page.sprintSummary.ticketsSp", { count: ty.completedIssues, sp: sp(ty.completedStoryPoints) })}
                        </TableCell>
                        <TableCell className={`text-right font-mono text-sm whitespace-nowrap ${ty.totalIssues - ty.completedIssues > 0 ? "text-orange-400" : "text-muted-foreground"}`}>
                          {t("page.sprintSummary.ticketsSp", { count: ty.totalIssues - ty.completedIssues, sp: sp(ty.incompleteStoryPoints) })}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {ty.incompleteKeys.length > 0 ? ty.incompleteKeys.join(", ") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
