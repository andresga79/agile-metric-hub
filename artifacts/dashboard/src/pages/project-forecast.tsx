import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, postProjectForecast, type ForecastResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ForecastChart } from "@/components/forecast-chart";
import { ArrowLeft, Calendar } from "lucide-react";

export default function ProjectForecast() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();

  const token = localStorage.getItem("auth_token");

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const [forecastTarget, setForecastTarget] = useState(30);
  const [forecastUnit, setForecastUnit] = useState<"issues" | "story_points">("issues");
  const [forecastWindow, setForecastWindow] = useState(180);
  const [forecastResult, setForecastResult] = useState<ForecastResponse | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);

  const runForecast = useCallback(async () => {
    if (!projectId) return;
    setForecastLoading(true);
    try {
      const result = await postProjectForecast(projectId, {
        target: forecastTarget,
        unit: forecastUnit,
        simulations: 5000,
        windowDays: forecastWindow,
      });
      setForecastResult(result);
    } catch (e) {
      console.error("Forecast failed", e);
    }
    setForecastLoading(false);
  }, [projectId, forecastTarget, forecastUnit, forecastWindow]);

  // Predictive forecast
  const [remainingIssues, setRemainingIssues] = useState(50);
  const [predResult, setPredResult] = useState<any>(null);
  const [predLoading, setPredLoading] = useState(false);

  const runPredictive = useCallback(async () => {
    if (!projectId) return;
    setPredLoading(true);
    const token = localStorage.getItem("auth_token");
    try {
      const r = await fetch(`/api/projects/${projectId}/predictive-forecast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ remainingIssues, windowWeeks: 12 }),
      });
      setPredResult(await r.json());
    } catch (e) {
      console.error("Predictive forecast failed", e);
    }
    setPredLoading(false);
  }, [projectId, remainingIssues]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-1">
        {project && (
          <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ArrowLeft size={14} />
            {project.name}
          </Link>
        )}
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t('page.forecast.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('page.forecast.subtitle')}</p>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle>{t('page.forecast.monteCarlo')}</CardTitle>
          <CardDescription>{t('page.forecast.monteCarloDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t('page.forecast.target')}</label>
              <input
                type="number"
                min={1}
                value={forecastTarget}
                onChange={(e) => setForecastTarget(Math.max(1, Number(e.target.value)))}
                className="w-24 px-2 py-1.5 text-sm bg-background border border-border rounded"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t('page.forecast.unit')}</label>
              <select
                value={forecastUnit}
                onChange={(e) => setForecastUnit(e.target.value as "issues" | "story_points")}
                className="px-2 py-1.5 text-sm bg-background border border-border rounded"
              >
                <option value="issues">{t('page.forecast.issues')}</option>
                <option value="story_points">{t('page.forecast.storyPoints')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t('page.forecast.window')}</label>
              <select
                value={forecastWindow}
                onChange={(e) => setForecastWindow(Number(e.target.value))}
                className="px-2 py-1.5 text-sm bg-background border border-border rounded"
              >
                <option value={30}>{`30 ${t('page.forecast.days')}`}</option>
                <option value={90}>{`90 ${t('page.forecast.days')}`}</option>
                <option value={180}>{`180 ${t('page.forecast.days')}`}</option>
              </select>
            </div>
            <div className="mt-6">
              <button
                onClick={runForecast}
                disabled={forecastLoading}
                className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {forecastLoading ? t('page.forecast.simulating') : t('page.forecast.runForecast')}
              </button>
            </div>
          </div>
          {forecastResult && <ForecastChart forecast={forecastResult} />}
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar size={18} />
            {t('page.forecast.predictiveTitle')}
          </CardTitle>
          <CardDescription>{t('page.forecast.predictiveDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 mb-4 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t('page.forecast.remainingIssues')}</label>
              <input
                type="number"
                min={1}
                value={remainingIssues}
                onChange={(e) => setRemainingIssues(Math.max(1, Number(e.target.value)))}
                className="w-24 px-2 py-1.5 text-sm bg-background border border-border rounded"
              />
            </div>
            <button
              onClick={runPredictive}
              disabled={predLoading}
              className="px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {predLoading ? t('page.forecast.calculating') : t('page.forecast.predict')}
            </button>
          </div>
          {predResult && (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('page.forecast.avgThroughput')}</div>
                <div className="text-lg font-bold">{predResult.avgThroughput}/wk</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('page.forecast.optimistic')}</div>
                <div className="text-lg font-bold text-green-400">{predResult.optimisticDate}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('page.forecast.projected')}</div>
                <div className="text-lg font-bold">{predResult.projectedDate}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">{t('page.forecast.pessimistic')}</div>
                <div className="text-lg font-bold text-red-400">{predResult.pessimisticDate}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
