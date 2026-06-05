import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectHealth, getGetProjectHealthQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend } from "recharts";
import { ArrowLeft } from "lucide-react";

type Period = "1m" | "3m" | "6m";

const PERIOD_OPTIONS: Period[] = ["1m", "3m", "6m"];



export default function ProjectHealth() {
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [comparePeriod, setComparePeriod] = useState<Period | "">("");
  const { t } = useTranslation();

  const PERIOD_LABELS: Record<Period, string> = {
    "1m": t('common.month1'),
    "3m": t('common.month3'),
    "6m": t('common.month6'),
  };

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { data: health, isLoading } = useGetProjectHealth(projectId!, period, {
    query: { enabled: !!projectId, queryKey: getGetProjectHealthQueryKey(projectId!, period) },
  });

  const { data: compareHealth } = useGetProjectHealth(projectId!, comparePeriod as Period, {
    query: { enabled: !!projectId && !!comparePeriod, queryKey: getGetProjectHealthQueryKey(projectId!, comparePeriod as Period) },
  });

  if (isLoading) return <div>{t('page.health.loading')}</div>;
  if (!project) return <div>{t('page.health.notFound')}</div>;

  const chartData = (health?.dimensions ?? []).map((d, i) => ({
    dimension: d.name,
    value: d.value,
    fullMark: 100,
    description: d.description,
    compareValue: compareHealth?.dimensions[i]?.value ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {project.name}
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.health.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.health.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-background border border-border rounded-md p-1">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">{t('page.health.compare')}</label>
            <select
              value={comparePeriod}
              onChange={(e) => setComparePeriod(e.target.value as Period | "")}
              className="px-2 py-1 text-xs bg-background border border-border rounded"
            >
              <option value="">{t('page.health.none')}</option>
              {PERIOD_OPTIONS.filter((p) => p !== period).map((p) => (
                <option key={p} value={p}>{p.toUpperCase()}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>{t('page.health.radar')}</CardTitle>
            <CardDescription>{t('page.health.radarDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={chartData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="dimension" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickCount={6} />
                <Radar name={PERIOD_LABELS[period]} dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} />
                {comparePeriod && (
                  <Radar name={PERIOD_LABELS[comparePeriod as Period]} dataKey="compareValue" stroke="hsl(35, 85%, 55%)" fill="hsl(35, 85%, 55%)" fillOpacity={0.1} />
                )}
                <Legend wrapperStyle={{ fontSize: "12px", color: "hsl(var(--muted-foreground))" }} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle>{t('page.health.dimensionDetails')}</CardTitle>
            <CardDescription>{t('page.health.dimensionDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {chartData.map((d) => (
                <div key={d.dimension} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div>
                    <div className="text-sm font-medium">{d.dimension}</div>
                    <div className="text-xs text-muted-foreground">{d.description}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-primary" />
                      <span className={`text-sm font-bold min-w-[2rem] text-right ${d.value >= 70 ? "text-green-400" : d.value >= 40 ? "text-amber-400" : "text-red-400"}`}>
                        {d.value}
                      </span>
                    </div>
                    {comparePeriod && d.compareValue !== null && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "hsl(35, 85%, 55%)" }} />
                        <span className={`text-sm font-bold min-w-[2rem] text-right ${d.compareValue >= 70 ? "text-green-400" : d.compareValue >= 40 ? "text-amber-400" : "text-red-400"}`}>
                          {d.compareValue}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle>{t('page.health.howItWorks')}</CardTitle>
          <CardDescription>{t('page.health.howItWorksDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p><strong>Throughput</strong> — {t('page.health.throughputDesc')}</p>
          <p><strong>Cycle Time</strong> — {t('page.health.cycleTimeDesc')}</p>
          <p><strong>DORA Score</strong> — {t('page.health.doraDesc')}</p>
          <p><strong>WIP Balance</strong> — {t('page.health.wipDesc')}</p>
          <p><strong>Predictability</strong> — {t('page.health.predictabilityDesc')}</p>
          <p><strong>Quality</strong> — {t('page.health.qualityDesc')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
