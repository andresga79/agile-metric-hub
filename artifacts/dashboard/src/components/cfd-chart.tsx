import { useTranslation } from "react-i18next";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface CfdDataPoint {
  date: string;
  todo: number;
  inProgress: number;
  done: number;
}

interface CfdChartProps {
  data: CfdDataPoint[];
}

export default function CfdChart({ data }: CfdChartProps) {
  const { t } = useTranslation();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
        />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            borderColor: "hsl(var(--border))",
            fontSize: "13px",
          }}
          itemStyle={{ color: "hsl(var(--foreground))" }}
          labelFormatter={(v: string) => new Date(v).toLocaleDateString()}
        />
        <Legend
          wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
        />
        <Area
          type="monotone"
          dataKey="done"
          stackId="1"
          stroke="hsl(142, 76%, 36%)"
          fill="hsl(142, 76%, 36%)"
          fillOpacity={0.6}
          name={t('page.detail.done')}
        />
        <Area
          type="monotone"
          dataKey="inProgress"
          stackId="1"
          stroke="hsl(199, 89%, 48%)"
          fill="hsl(199, 89%, 48%)"
          fillOpacity={0.5}
          name={t('common.inProgress')}
        />
        <Area
          type="monotone"
          dataKey="todo"
          stackId="1"
          stroke="hsl(220, 10%, 60%)"
          fill="hsl(220, 10%, 60%)"
          fillOpacity={0.4}
          name={t('common.toDo')}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
