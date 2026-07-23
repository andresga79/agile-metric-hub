import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { ForecastResponse } from "@workspace/api-client-react";

export function ForecastChart({ forecast }: { forecast: ForecastResponse }) {
  const { t } = useTranslation();

  if (!forecast.histogram.length) return <div className="text-sm text-muted-foreground">{t('page.forecast.noData')}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card/60 rounded-lg border border-border p-3 text-center">
          <div className="text-xs text-muted-foreground">{t('page.forecast.probability')}</div>
          <div className="text-xl font-bold text-primary">{forecast.probability}%</div>
          <div className="text-[11px] text-muted-foreground">
            {t('page.forecast.probabilityWithinWeeks', { weeks: forecast.medianWeeks })}
          </div>
        </div>
        <div className="bg-card/60 rounded-lg border border-border p-3 text-center">
          <div className="text-xs text-muted-foreground">{t('page.forecast.p50')}</div>
          <div className="text-xl font-bold">{forecast.medianWeeks}{t('page.forecast.weeks')}</div>
        </div>
        <div className="bg-card/60 rounded-lg border border-border p-3 text-center">
          <div className="text-xs text-muted-foreground">P85</div>
          <div className="text-xl font-bold">{forecast.p85Weeks}{t('page.forecast.weeks')}</div>
        </div>
        <div className="bg-card/60 rounded-lg border border-border p-3 text-center">
          <div className="text-xs text-muted-foreground">P95</div>
          <div className="text-xl font-bold">{forecast.p95Weeks}{t('page.forecast.weeks')}</div>
        </div>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={forecast.histogram}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              dataKey="week"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: t('page.forecast.weeks'), position: "insideBottom", offset: -5, style: { fill: "hsl(var(--muted-foreground))", fontSize: 11 } }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              label={{ value: "%", angle: -90, position: "insideLeft", style: { fill: "hsl(var(--muted-foreground))", fontSize: 11 } }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", fontSize: "13px" }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number) => `${value}%`}
            />
            <Bar dataKey="count" name="Simulations" fill="hsl(var(--primary))" fillOpacity={0.6} radius={[3, 3, 0, 0]} />
            <ReferenceLine x={forecast.medianWeeks} stroke="hsl(var(--primary))" strokeDasharray="4 4" label={{ value: `${t('page.forecast.p50')} ${forecast.medianWeeks}${t('page.forecast.weeks')}`, position: "top", fontSize: 10, fill: "hsl(var(--primary))" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {t('page.forecast.simulations', { count: forecast.simulations })}
      </p>
      <p className="text-xs text-muted-foreground text-center">
        {t('page.forecast.percentileLegend')}
      </p>
    </div>
  );
}
