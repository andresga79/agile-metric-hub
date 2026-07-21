import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, useGetProjectEvolution, getGetProjectQueryKey, getGetProjectEvolutionQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";

interface MetricChartConfig {
  key: "leadTimeAvg" | "cycleTimeAvg" | "throughput" | "qaRejectionRate";
  label: string;
  unit: string;
  target: number | null;
}

function EvolutionChart({ title, data, config }: { title: string; data: any[]; config: MetricChartConfig }) {
  const { t } = useTranslation();
  const points = data.filter((w) => w[config.key] !== null && w[config.key] !== undefined);

  return (
    <Card className="bg-card/40">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {config.target !== null
            ? `${t('page.evolution.target')}: ${config.target}${config.unit}`
            : t('page.evolution.noTarget')}
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[220px]">
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('page.evolution.noData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="weekLabel" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                itemStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: number) => [`${value}${config.unit}`, config.label]}
              />
              {config.target !== null && (
                <ReferenceLine
                  y={config.target}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  label={{ value: t('page.evolution.target'), fontSize: 10, fill: 'hsl(var(--muted-foreground))', position: 'insideTopLeft' }}
                />
              )}
              <Line
                type="monotone"
                dataKey={config.key}
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${months[start.getMonth()]} ${start.getDate()}`;
}

export default function ProjectEvolution() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const token = getAuthToken();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { data: evolution, isLoading } = useGetProjectEvolution(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectEvolutionQueryKey(projectId!) },
  });

  if (isLoading) return <div>{t('page.evolution.loading')}</div>;
  if (!project) return <div>{t('page.evolution.notFound')}</div>;

  const weeks = (evolution?.weeks ?? []).map((w) => ({ ...w, weekLabel: formatWeekLabel(w.weekStart) }));
  const targets = evolution?.targets ?? { leadTime: null, cycleTime: null, throughput: null };

  const charts: { title: string; config: MetricChartConfig }[] = [
    { title: t('page.evolution.leadTime'), config: { key: "leadTimeAvg", label: t('page.evolution.leadTime'), unit: "d", target: targets.leadTime } },
    { title: t('page.evolution.cycleTime'), config: { key: "cycleTimeAvg", label: t('page.evolution.cycleTime'), unit: "d", target: targets.cycleTime } },
    { title: t('page.evolution.throughput'), config: { key: "throughput", label: t('page.evolution.throughput'), unit: "", target: targets.throughput } },
    { title: t('page.evolution.qaRejectionRate'), config: { key: "qaRejectionRate", label: t('page.evolution.qaRejectionRate'), unit: "%", target: null } },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
          <ArrowLeft size={14} />
          {project.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <TrendingUp size={22} />
          {t('page.evolution.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {weeks.length > 0
            ? `${weeks.length} ${t('page.evolution.weeksAvailable')}`
            : t('page.evolution.subtitle')}
        </p>
      </div>

      <ProjectTabs projectId={projectId!} active="evolution" />

      {weeks.length === 0 ? (
        <EmptyState icon={TrendingUp} title={t('page.evolution.noDataTitle')} description={t('page.evolution.buildingHistory')} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {charts.map((chart) => (
            <EvolutionChart key={chart.config.key} title={chart.title} data={weeks} config={chart.config} />
          ))}
        </div>
      )}
    </div>
  );
}
