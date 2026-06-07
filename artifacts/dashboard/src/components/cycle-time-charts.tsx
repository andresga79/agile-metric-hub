import { useTranslation } from "react-i18next";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

import type { Issue } from "@workspace/api-client-react";

interface CycleTimeDist {
  range: string;
  count: number;
}

interface CycleTimeChartsProps {
  issues: Issue[];
  distribution: CycleTimeDist[];
}

export function CycleTimeScatter({ issues }: { issues: Issue[] }) {
  const { t } = useTranslation();
  const points = issues
    .filter((i) => i.cycleTimeDays !== null && i.resolvedAt)
    .map((i) => ({
      x: new Date(i.resolvedAt!).getTime(),
      y: i.cycleTimeDays!,
      name: i.key,
    }));

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('common.noData')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="x"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          domain={["auto", "auto"]}
        />
        <YAxis
          dataKey="y"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          label={{
            value: t('common.days'),
            angle: -90,
            position: "insideLeft",
            style: { fill: "hsl(var(--muted-foreground))", fontSize: 11 },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            fontSize: "13px",
          }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          formatter={(value: number, name: string) => {
            if (name === "y") return [`${value.toFixed(1)}d`, t('terms.cycleTime')];
            return [new Date(value).toLocaleDateString(), t('common.resolved')];
          }}
          labelFormatter={() => ""}
        />
        <Scatter
          data={points}
          fill="hsl(var(--primary))"
          fillOpacity={0.6}
          stroke="none"
          shape="circle"
          r={4}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const DIST_COLORS = [
  "hsl(142, 76%, 36%)",
  "hsl(142, 76%, 45%)",
  "hsl(199, 89%, 48%)",
  "hsl(30, 80%, 50%)",
  "hsl(0, 84%, 60%)",
];

export function CycleTimeHistogram({ distribution }: { distribution: CycleTimeDist[] }) {
  const { t } = useTranslation();
  if (distribution.every((d) => d.count === 0)) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('common.noData')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={distribution}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="range"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            fontSize: "13px",
          }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
        />
        <Bar dataKey="count" name={t('common.issues')} radius={[3, 3, 0, 0]}>
          {distribution.map((_, index) => (
            <Cell key={index} fill={DIST_COLORS[index % DIST_COLORS.length]} fillOpacity={0.7} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
