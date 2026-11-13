import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import {
  useGetProjectSprintComposition,
  getGetProjectSprintCompositionQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { EmptyState } from "@/components/empty-state";

// Composición del sprint por tipo de trabajo over the last 2 / 6 closed sprints
// (docs/superpowers/specs/2026-11-13-sprint-composition-design.md). Hotfix = Jira "Error".

/** i18n suffix per effective issue type; other types show their raw name. */
const CATEGORY_I18N: Record<string, string> = {
  Story: "story",
  Bug: "bug",
  Task: "task",
  Spike: "spike",
  "Tech Debt": "techDebt",
};

export const CATEGORY_LABEL_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_I18N).map(([c, k]) => [c, `page.sprintComposition.cat.${k}`])
);
export const CATEGORY_SHORT_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_I18N).map(([c, k]) => [c, `page.sprintComposition.short.${k}`])
);

export const CATEGORY_COLOR: Record<string, string> = {
  Story: "hsl(217, 91%, 60%)",
  Bug: "hsl(0, 72%, 58%)",
  Task: "hsl(142, 60%, 45%)",
  Spike: "hsl(38, 92%, 55%)",
  "Tech Debt": "hsl(270, 60%, 62%)",
};
const FALLBACK_COLOR = "hsl(var(--muted-foreground))";

export type SprintWindow = "2s" | "6s";

/** The Sprints page's one window selector (it drives this card and the Sprints table). */
export const SPRINT_WINDOWS: { value: SprintWindow; labelKey: string }[] = [
  { value: "2s", labelKey: "page.sprintComposition.last2" },
  { value: "6s", labelKey: "page.sprintComposition.last6" },
];

const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function SprintCompositionCard({ projectId, window: win }: { projectId: string; window: SprintWindow }) {
  const { t } = useTranslation();
  const token = localStorage.getItem("auth_token");
  const { data, isLoading, isError } = useGetProjectSprintComposition(projectId, win, {
    query: {
      enabled: !!token,
      queryKey: getGetProjectSprintCompositionQueryKey(projectId, win),
      retry: false,
    },
  });

  const label = (category: string) => (CATEGORY_LABEL_KEY[category] ? t(CATEGORY_LABEL_KEY[category]) : category);
  const days = (v: number | null) => (v === null ? "—" : t("page.sprintComposition.days", { value: num(v) }));
  const rows = data?.rows ?? [];
  const sprints = data?.sprints ?? [];
  const chartData = sprints.map((s) => ({ name: s.sprintName, ...s.shares }));

  return (
    <Card className="bg-card/40">
      <CardHeader>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{t("page.sprintComposition.title")}</CardTitle>
            {data && sprints.length > 0 && (
              <CardDescription>
                {t("page.sprintComposition.subtitle", {
                  count: data.sprintCount,
                  first: sprints[0].sprintName,
                  last: sprints[sprints.length - 1].sprintName,
                })}
              </CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {isError ? (
          <p className="text-sm text-red-400">{t("page.sprintComposition.error")}</p>
        ) : isLoading || !data ? (
          <p className="text-sm text-muted-foreground">{t("page.sprintComposition.loading")}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={Layers} title={t("page.sprintComposition.empty")} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t("page.sprintComposition.type")}</TableHead>
                    <TableHead className="text-right">{t("page.sprintComposition.issueShare")}</TableHead>
                    <TableHead className="text-right">{t("page.sprintComposition.issuesPerSprint")}</TableHead>
                    <TableHead className="text-right">{t("page.sprintComposition.spPerSprint")}</TableHead>
                    <TableHead className="text-right">{t("page.sprintComposition.realClosed")}</TableHead>
                    <TableHead className="text-right">{t("page.sprintComposition.cycle")}</TableHead>
                    <TableHead className="text-right">{t("page.sprintComposition.addedAfterPlanning")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.category} className="border-border hover:bg-accent/50">
                      <TableCell className="font-medium">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                          style={{ backgroundColor: CATEGORY_COLOR[r.category] ?? FALLBACK_COLOR }}
                        />
                        {label(r.category)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{num(r.issueShare)} %</TableCell>
                      <TableCell className="text-right font-mono text-sm">{num(r.issuesPerSprint)}</TableCell>
                      <TableCell className="text-right font-mono text-sm text-muted-foreground">{num(r.storyPointsPerSprint)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.realClosedRate === null ? "—" : `${num(r.realClosedRate)} %`}</TableCell>
                      <TableCell className="text-right font-mono text-sm whitespace-nowrap">
                        {days(r.cycleP50)} / {days(r.cycleP85)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{num(r.addedAfterPlanningRate)} %</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <section>
              <h3 className="text-sm font-semibold mb-2">{t("page.sprintComposition.chartTitle")}</h3>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: 0, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} unit="%" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                      itemStyle={{ color: "hsl(var(--foreground))" }}
                      cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.3 }}
                      formatter={(v: number) => `${num(v)} %`}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {rows.map((r) => (
                      <Bar
                        key={r.category}
                        dataKey={r.category}
                        stackId="mix"
                        name={label(r.category)}
                        fill={CATEGORY_COLOR[r.category] ?? FALLBACK_COLOR}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <p className="text-xs text-muted-foreground">{t("page.sprintComposition.note")}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
