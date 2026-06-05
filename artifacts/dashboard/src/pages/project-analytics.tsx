import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { ArrowLeft, Timer } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { DrillDownModal } from "@/components/drill-down-modal";

type Period = "1m" | "3m" | "6m";

const COLORS = ["hsl(var(--primary))", "hsl(142, 76%, 45%)", "hsl(35, 85%, 55%)", "hsl(0, 70%, 50%)", "hsl(270, 60%, 60%)"];

export default function ProjectAnalytics() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState<any>(null);
  const [slaData, setSlaData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [drillWeek, setDrillWeek] = useState<string | null>(null);

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId!) },
  });

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    const token = localStorage.getItem("auth_token");
    Promise.all([
      fetch(`/api/projects/${projectId}/analytics/${period}${compare ? "?compareTo=true" : ""}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
      fetch(`/api/projects/${projectId}/sla/${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()),
    ])
      .then(([analytics, sla]) => {
        setData(analytics);
        setSlaData(sla);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, period, compare]);

  if (loading) return <div>{t('page.analytics.loading')}</div>;
  if (!project) return <div>{t('page.analytics.notFound')}</div>;

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
          <h1 className="text-2xl font-bold tracking-tight">{t('page.analytics.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.analytics.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCompare(!compare)}
            className={`px-3 py-1 text-xs font-medium rounded-sm border transition-colors ${compare ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:text-foreground"}`}
          >
            {compare ? t('page.analytics.comparing') : t('page.analytics.compare')}
          </button>
          <div className="flex bg-background border border-border rounded-md p-1">
            {(["1m", "3m", "6m"] as Period[]).map((p) => (
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

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>{t('page.analytics.issueTypeDist')}</CardTitle>
            <CardDescription>{data?.issueTypeDistribution?.length ?? 0} {t('page.analytics.typesFound')}</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data?.issueTypeDistribution ?? []} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percentage }) => `${name} ${percentage}%`}>
                  {(data?.issueTypeDistribution ?? []).map((_: any, i: number) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle>{t('page.analytics.throughputByPriority')}</CardTitle>
          <CardDescription>{t('page.analytics.priorityDesc')}{compare && data?.previousPeriod ? ` (${t('page.analytics.currentVsPrev')})` : ""}</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(() => {
              if (!compare || !data?.previousPeriod?.throughputByPriority) return data?.throughputByPriority ?? [];
              const map = new Map<string, { priority: string; current: number; previous: number }>();
              for (const d of data.throughputByPriority ?? []) map.set(d.priority, { priority: d.priority, current: d.count, previous: 0 });
              for (const d of data.previousPeriod.throughputByPriority ?? []) {
                const ex = map.get(d.priority);
                if (ex) ex.previous = d.count;
                else map.set(d.priority, { priority: d.priority, current: 0, previous: d.count });
              }
              return Array.from(map.values());
            })()}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="priority" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: "13px" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
              <Bar dataKey={compare ? "current" : "count"} name={t('page.analytics.current')} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              {compare && <Bar dataKey="previous" name={t('page.analytics.previous')} fill="hsl(35, 85%, 55%)" radius={[3, 3, 0, 0]} />}
              {compare && <Legend />}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      </div>

      <Card className="bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle>{t('page.analytics.flowEfficiency')}</CardTitle>
          <CardDescription>{t('page.analytics.flowEfficiencyDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.flowEfficiency !== null && data?.flowEfficiency !== undefined ? (
            <div className="flex flex-col items-center">
              <div className="relative w-28 h-28">
                <svg viewBox="0 0 100 100" className="transform -rotate-90">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
                  <circle
                    cx="50" cy="50" r="42"
                    fill="none"
                    stroke={data.flowEfficiency >= 50 ? "hsl(142, 76%, 45%)" : data.flowEfficiency >= 30 ? "hsl(35, 85%, 55%)" : "hsl(0, 70%, 50%)"}
                    strokeWidth="8"
                    strokeDasharray={`${(data.flowEfficiency / 100) * 264} 264`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold">{data.flowEfficiency}%</span>
              </div>
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>{t('page.analytics.avgCycle')} <strong className="text-foreground">{data.avgCycleTime !== null ? `${data.avgCycleTime.toFixed(1)}d` : "—"}</strong></span>
                <span>{t('page.analytics.avgLead')} <strong className="text-foreground">{data.avgLeadTime !== null ? `${data.avgLeadTime.toFixed(1)}d` : "—"}</strong></span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">{t('page.analytics.noResolved')}</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle>{t('page.analytics.runChart')}</CardTitle>
          <CardDescription>{t('page.analytics.runChartDesc')}{compare && data?.previousPeriod ? ` (${t('page.analytics.currentVsPrev')})` : ""} — {t('page.analytics.clickDot')}</CardDescription>
        </CardHeader>
        <CardContent className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={(() => {
              if (!compare || !data?.previousPeriod?.throughputOverTime) return data?.throughputOverTime ?? [];
              const merged = new Map<string, { week: string; current: number; previous: number }>();
              for (const d of data.throughputOverTime ?? []) merged.set(d.week, { week: d.week, current: d.count, previous: 0 });
              for (const d of data.previousPeriod.throughputOverTime ?? []) {
                const existing = merged.get(d.week);
                if (existing) existing.previous = d.count;
                else merged.set(d.week, { week: d.week, current: 0, previous: d.count });
              }
              return Array.from(merged.values()).sort((a, b) => a.week.localeCompare(b.week));
            })()}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="week" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: "13px" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
              <Line type="monotone" dataKey={compare ? "current" : "count"} name={t('page.analytics.current')} stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: "hsl(var(--primary))" }} onClick={(point: any) => setDrillWeek(point?.payload?.week)} style={{ cursor: "pointer" }} />
              {compare && <Line type="monotone" dataKey="previous" name={t('page.analytics.previous')} stroke="hsl(35, 85%, 55%)" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 2, fill: "hsl(35, 85%, 55%)" }} />}
              {compare && <Legend />}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <DrillDownModal open={!!drillWeek} onClose={() => setDrillWeek(null)} projectId={projectId!} week={drillWeek ?? ""} period={period} />

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer size={18} />
            {t('page.analytics.slaTitle')}
          </CardTitle>
          <CardDescription>{t('page.analytics.slaDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {slaData?.sla?.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.analytics.priority')}</TableHead>
                    <TableHead className="text-right">{t('page.analytics.total')}</TableHead>
                    <TableHead className="text-right">{t('page.analytics.withinSla')}</TableHead>
                    <TableHead className="text-right">{t('page.analytics.compliance')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slaData.sla.map((s: any) => (
                    <TableRow key={s.priority} className="border-border hover:bg-accent/50">
                      <TableCell className="font-medium">{s.priority}</TableCell>
                      <TableCell className="text-right">{s.total}</TableCell>
                      <TableCell className="text-right">{s.withinSla}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-mono ${s.percentage >= 90 ? "text-green-400" : s.percentage >= 70 ? "text-amber-400" : "text-red-400"}`}>
                          {s.percentage}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">{t('page.analytics.noSlaData')}</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle>{t('page.analytics.leadTimeDist')}</CardTitle>
          <CardDescription>{t('page.analytics.leadTimeDistDesc')}{compare && data?.previousPeriod ? ` (${t('page.analytics.currentVsPrev')})` : ""}</CardDescription>
        </CardHeader>
        <CardContent className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(() => {
              if (!compare || !data?.previousPeriod?.leadTimeDistribution) return data?.leadTimeDistribution ?? [];
              const map = new Map<string, { range: string; current: number; previous: number }>();
              for (const d of data.leadTimeDistribution ?? []) map.set(d.range, { range: d.range, current: d.count, previous: 0 });
              for (const d of data.previousPeriod.leadTimeDistribution ?? []) {
                const ex = map.get(d.range);
                if (ex) ex.previous = d.count;
                else map.set(d.range, { range: d.range, current: 0, previous: d.count });
              }
              return Array.from(map.values());
            })()}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="range" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: "13px" }} itemStyle={{ color: "hsl(var(--foreground))" }} />
              <Bar dataKey={compare ? "current" : "count"} name={t('page.analytics.current')} fill="hsl(142, 76%, 45%)" radius={[3, 3, 0, 0]} />
              {compare && <Bar dataKey="previous" name={t('page.analytics.previous')} fill="hsl(35, 85%, 55%)" radius={[3, 3, 0, 0]} />}
              {compare && <Legend />}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
