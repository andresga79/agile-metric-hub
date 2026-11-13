import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectSprintMetrics, getGetProjectSprintMetricsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Gauge, CheckCircle2, Clock, BarChart3, Layers, Target } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ComposedChart, Bar, Cell, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ProjectTabs, ProjectSubNav } from "@/components/project-tabs";
import { SprintCompositionCard, SPRINT_WINDOWS, type SprintWindow } from "@/components/sprint-composition-card";
import { useThresholds } from "@/hooks/use-thresholds";
import { EmptyState } from "@/components/empty-state";

/** What "% real cerrado" in the table is measured against: the final scope or the plan. */
type RealClosedBasis = "total" | "planned";

const DEFAULT_COMPLETION_THRESHOLD = { good: 80, warning: 50 };

const STATE_KEYS: Record<string, string> = {
  active: "page.sprints.stateActive",
  closed: "page.sprints.stateClosed",
  future: "page.sprints.stateFuture",
};

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

// Least-squares linear fit over the series index, used to draw a velocity trend line.
function linearTrend(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, v) => sum + v, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xMean) * (y - yMean);
    den += (x - xMean) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return values.map((_, x) => slope * x + intercept);
}

// z-scores for one-sided confidence levels (P(actual >= mean - z*sd) = confidence),
// used to turn "average and spread of past closed sprints" into a planning commitment.
const CONFIDENCE_Z_SCORES: Array<{ confidence: number; z: number }> = [
  { confidence: 95, z: 1.645 },
  { confidence: 85, z: 1.036 },
  { confidence: 70, z: 0.524 },
];

interface CommitmentStats {
  avg: number;
  stdDev: number;
  recommendations: Array<{ confidence: number; value: number }>;
}

// Sample standard deviation (n-1 denominator) — with only a handful of closed sprints, the
// population formula understates real variance, so this is the more honest estimate to plan on.
// "Compromiso Recomendado" card: hidden on request (2026-11-06). Its numbers come from the
// cumulative completion (Done today), which no longer matches the "% real cerrado" the page
// now leads with. Set to true to bring it back; the computation below is kept.
const SHOW_RECOMMENDED_COMMITMENT = false;

function commitmentStats(values: number[]): CommitmentStats | null {
  const n = values.length;
  if (n < 2) return null;
  const avg = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  return {
    avg,
    stdDev,
    recommendations: CONFIDENCE_Z_SCORES.map(({ confidence, z }) => ({
      confidence,
      value: Math.max(0, avg - z * stdDev),
    })),
  };
}

function days(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}d`;
}

function sprintDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ProjectSprints() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  // One window for the whole page (table, cards, chart and Composición del sprint): last 2 / 6
  // closed sprints, plus the one in progress.
  const [period, setPeriod] = useState<SprintWindow>("6s");
  const [realClosedBasis, setRealClosedBasis] = useState<RealClosedBasis>("total");
  const token = localStorage.getItem("auth_token");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { data, isLoading } = useGetProjectSprintMetrics(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectSprintMetricsQueryKey(projectId!, period) },
  });

  const completionThreshold = useThresholds(projectId).sprintCompletion ?? DEFAULT_COMPLETION_THRESHOLD;


  if (isLoading || loadingProject) return <div>{t('page.sprints.loading')}</div>;
  if (!project) return <div>{t('page.sprints.notFound')}</div>;

  const sprints = data?.sprints ?? [];
  const summary = data?.summary;
  const activeSprint = sprints.find((s) => s.state === "active") ?? null;

  // Recommended commitment is computed from CLOSED sprints only — an active sprint's partial
  // numbers would understate the team's real spread, same reasoning as the summary averages.
  const closedSprints = sprints.filter((s) => s.state === "closed");
  const issuesStats = commitmentStats(closedSprints.map((s) => s.completedIssues));
  const spStats = commitmentStats(closedSprints.map((s) => s.completedStoryPoints));

  // "% Real cerrado": what was already done when each sprint closed. The active sprint hasn't
  // closed, so its current progress stands in (same as the table column).
  const realClosedSp = (s: (typeof sprints)[number]) => s.closedAtSprintEndStoryPoints ?? s.completedStoryPoints;
  const realClosedRate = (s: (typeof sprints)[number]) => s.closedAtSprintEndRate ?? s.completionRate;
  const closedRealRates = closedSprints
    .map((s) => s.closedAtSprintEndRate)
    .filter((r): r is number => r != null);
  const avgRealClosedRate = closedRealRates.length > 0
    ? closedRealRates.reduce((a, b) => a + b, 0) / closedRealRates.length
    : 0;

  // Issues already Done when each sprint closed, averaged over closed sprints (a count, not a %).
  const sprintsWithRealIssues = closedSprints.filter((s) => s.closedAtSprintEndIssues != null);
  const avgRealClosedIssues = sprintsWithRealIssues.length > 0
    ? sprintsWithRealIssues.reduce((sum, s) => sum + (s.closedAtSprintEndIssues ?? 0), 0) / sprintsWithRealIssues.length
    : 0;
  const avgPlannedIssues = sprintsWithRealIssues.length > 0
    ? sprintsWithRealIssues.reduce((sum, s) => sum + s.totalIssues, 0) / sprintsWithRealIssues.length
    : 0;

  const velocityTrendLine = linearTrend(sprints.map(realClosedSp));
  const chartData = sprints.map((s, i) => ({
    name: s.sprintName.replace(/^.*\s/, "S"),
    plannedStoryPoints: s.totalStoryPoints,
    realClosedSp: realClosedSp(s),
    realClosedRate: realClosedRate(s),
    velocityTrend: velocityTrendLine[i],
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${project.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={18} />
            </Link>
            {project && (
              <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-1 rounded">
                {project.key}
              </span>
            )}
            <span className="text-xs font-semibold bg-blue-500/20 text-blue-400 px-2 py-1 rounded">{t('page.sprints.scrum')}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.sprints.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('page.sprints.subtitle')}</p>
        </div>
        <div className="flex bg-background border border-border rounded-md p-1">
          {SPRINT_WINDOWS.map((w) => (
            <button
              key={w.value}
              onClick={() => setPeriod(w.value)}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                period === w.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(w.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <ProjectTabs projectId={project.id} active="sprints" />
      <ProjectSubNav projectId={project.id} group="delivery" active="sprints" />

      {sprints.length === 0 ? (
        <EmptyState icon={Gauge} title={t('page.sprints.noSprints')} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Layers size={14} /> {t('page.sprints.totalSprints')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{summary?.totalSprints ?? 0}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {activeSprint ? t('page.sprints.closedPlusActive', { name: activeSprint.sprintName }) : t('page.sprints.closedOnly')}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> {t('page.sprints.avgRealClosed')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" title={t('page.sprints.avgCumulativeHint', { value: pct(summary?.avgCompletionRate ?? 0) })}>
                  {pct(avgRealClosedRate)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t('page.sprints.avgRealClosedDesc')}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <BarChart3 size={14} /> {t('page.sprints.avgRealClosedIssues')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold" title={t('page.sprints.avgRealClosedIssuesHint')}>
                  {avgRealClosedIssues.toFixed(1)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('page.sprints.avgRealClosedIssuesDesc', { planned: avgPlannedIssues.toFixed(1) })}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Gauge size={14} /> {t('page.sprints.avgVelocity')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{(summary?.avgVelocity ?? 0).toFixed(1)}</div>
                <p className="text-xs text-muted-foreground mt-1">{summary?.totalCompletedStoryPoints.toFixed(0)} {t('page.sprints.totalSpDelivered')}</p>
              </CardContent>
            </Card>

            <Card className="bg-card/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock size={14} /> {t('page.sprints.avgCycleTime')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{days(summary?.medianCycleTimeDays ?? null)}</div>
                <p className="text-xs text-muted-foreground mt-1">{t('page.sprints.daysStartToDone')}</p>
              </CardContent>
            </Card>
          </div>

          {chartData.length > 0 && (
            <Card className="bg-card/40">
              <CardHeader>
                <CardTitle className="text-lg">{t('page.sprints.velocityTrend')}</CardTitle>
                <CardDescription>{t('page.sprints.velocityTrendDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))' }}
                      itemStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }} />
                    <Bar dataKey="plannedStoryPoints" fill="hsl(var(--muted-foreground))" fillOpacity={0.25} radius={[2, 2, 0, 0]} name={`${t('page.sprints.spPlanned')} (SP)`} />
                    <Bar dataKey="realClosedSp" radius={[2, 2, 0, 0]} name={t('page.sprints.realClosedSpSeries')}>
                      {chartData.map((d, i) => (
                        <Cell
                          key={i}
                          fill={
                            d.realClosedRate >= completionThreshold.good
                              ? "hsl(142, 76%, 36%)"
                              : d.realClosedRate >= completionThreshold.warning
                              ? "hsl(38, 92%, 50%)"
                              : "hsl(var(--destructive))"
                          }
                        />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="velocityTrend" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="5 3" dot={false} name={t('page.sprints.velocityTrendLine')} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {SHOW_RECOMMENDED_COMMITMENT && (
          <Card className="bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">{t('page.sprints.recommendedCommitment')}</CardTitle>
              {issuesStats && spStats ? (
                <CardDescription>{t('page.sprints.recommendedCommitmentDesc', { count: closedSprints.length })}</CardDescription>
              ) : (
                <CardDescription>{t('page.sprints.recommendedCommitmentNotEnough')}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {issuesStats && spStats ? (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead></TableHead>
                          <TableHead className="text-right">{t('page.sprints.issues')}</TableHead>
                          <TableHead className="text-right">{t('terms.velocity')} (SP)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableCell className="font-medium">{t('page.sprints.average')}</TableCell>
                          <TableCell className="text-right font-mono">{issuesStats.avg.toFixed(1)}</TableCell>
                          <TableCell className="text-right font-mono">{spStats.avg.toFixed(1)}</TableCell>
                        </TableRow>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableCell className="font-medium">{t('page.sprints.stdDev')}</TableCell>
                          <TableCell className="text-right font-mono">{issuesStats.stdDev.toFixed(1)}</TableCell>
                          <TableCell className="text-right font-mono">{spStats.stdDev.toFixed(1)}</TableCell>
                        </TableRow>
                        {CONFIDENCE_Z_SCORES.map(({ confidence }) => {
                          const issuesRec = issuesStats.recommendations.find((r) => r.confidence === confidence)!;
                          const spRec = spStats.recommendations.find((r) => r.confidence === confidence)!;
                          return (
                            <TableRow key={confidence} className="border-border hover:bg-accent/50 bg-muted/30">
                              <TableCell className="font-medium">{t('page.sprints.confidenceLevel', { confidence })}</TableCell>
                              <TableCell className="text-right font-mono font-semibold text-primary">{Math.round(issuesRec.value)}</TableCell>
                              <TableCell className="text-right font-mono font-semibold text-primary">{Math.round(spRec.value)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{t('page.sprints.recommendedCommitmentLegend')}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t('page.sprints.recommendedCommitmentNotEnoughHint')}</p>
              )}
            </CardContent>
          </Card>
          )}

          <Card className="bg-card/40">
            <CardHeader>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg">{t('page.sprints.breakdown')}</CardTitle>
                  <CardDescription>{t('page.sprints.breakdownDesc')}</CardDescription>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('page.sprints.realClosedOver')}</span>
                  <div className="flex bg-background border border-border rounded-md p-1">
                    {(["total", "planned"] as RealClosedBasis[]).map((b) => (
                      <button
                        key={b}
                        onClick={() => setRealClosedBasis(b)}
                        className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                          realClosedBasis === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t(b === "total" ? 'page.sprints.realClosedOverTotal' : 'page.sprints.realClosedOverPlanned')}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.sprints.sprint')}</TableHead>
                    <TableHead>{t('page.sprints.state')}</TableHead>
                    <TableHead>{t('page.sprints.startDate')}</TableHead>
                    <TableHead>{t('page.sprints.endDate')}</TableHead>
                    <TableHead className="text-right" title={t('page.sprints.plannedTooltip')}>{t('page.sprints.plannedCol')}</TableHead>
                    <TableHead className="text-right" title={t('page.sprints.addedAfterPlanningTooltip')}>{t('page.sprints.addedAfterPlanning')}</TableHead>
                    <TableHead
                      className="text-right"
                      title={t(realClosedBasis === "total" ? 'page.sprints.realClosedTooltip' : 'page.sprints.realClosedPlannedTooltip')}
                    >
                      {t('page.sprints.realClosed')}
                    </TableHead>
                    <TableHead className="text-right" title={t('page.sprints.carryoverTooltip')}>{t('page.sprints.carryover')}</TableHead>
                    <TableHead className="text-right" title={t('page.sprints.cycleTimeTooltip')}>{t('page.sprints.cycleTime')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sprints.map((s, i) => {
                      const sp = s.completionBasis === "storyPoints";
                      const unit = sp ? "SP" : "issues";
                      const planned = realClosedBasis === "planned";
                      // Done at close and its denominator, in the same unit as the %.
                      const doneAtClose = planned
                        ? (sp ? s.closedAtSprintEndPlannedStoryPoints : s.closedAtSprintEndPlannedIssues)
                        : (sp ? s.closedAtSprintEndStoryPoints : s.closedAtSprintEndIssues);
                      const scope = planned
                        ? (sp ? s.plannedStoryPoints : s.plannedIssues)
                        : (sp ? s.totalStoryPoints : s.totalIssues);
                      const closedRate = planned ? s.closedAtSprintEndPlannedRate : s.closedAtSprintEndRate;
                      const activeRate = planned ? s.plannedCompletionRate : s.completionRate;
                      const rovoHint = t('page.sprints.avgCumulativeHint', { value: pct(s.completionRate) });
                      const firstActive = s.state === "active" && sprints[i - 1]?.state !== "active";
                      return (
                      <TableRow
                        key={s.sprintId}
                        className={`border-border hover:bg-accent/50 ${i % 2 === 0 ? 'bg-muted/30' : ''} ${firstActive ? 'border-t-2 border-t-blue-500/40' : ''}`}
                      >
                        <TableCell className="font-medium">
                          <span className="inline-flex items-center gap-1.5">
                            {s.sprintName}
                            {s.goal && (
                              <span title={t('page.sprints.goalTooltip', { goal: s.goal })} className="shrink-0">
                                <Target size={12} className="text-muted-foreground" />
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            s.state === "active"
                              ? "bg-blue-500/20 text-blue-400"
                              : s.state === "closed"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-secondary text-secondary-foreground"
                          }`}>
                            {STATE_KEYS[s.state] ? t(STATE_KEYS[s.state]) : s.state}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{sprintDate(s.startDate)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{sprintDate(s.endDate)}</TableCell>
                        <TableCell className="text-right font-mono text-xs whitespace-nowrap" title={t('page.sprints.plannedTooltip')}>
                          {s.plannedIssues} · <span className="text-muted-foreground">{s.plannedStoryPoints.toFixed(0)} SP</span>
                        </TableCell>
                        <TableCell
                          className="text-right font-mono text-xs whitespace-nowrap"
                          title={s.addedAfterPlanningCount > 0
                            ? `${t('page.sprints.addedAfterPlanningTooltip')}\n\n${t('page.sprints.addedAfterPlanningKeys', { keys: s.addedAfterPlanningKeys.join(', ') })}`
                            : t('page.sprints.addedAfterPlanningTooltip')}
                        >
                          {s.addedAfterPlanningCount > 0
                            ? <>+{s.addedAfterPlanningCount} · <span className="text-muted-foreground">{s.addedAfterPlanningStoryPoints.toFixed(0)} SP</span></>
                            : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.state === "active" ? (
                            activeRate != null ? (
                              <span
                                className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/20 text-blue-400"
                                title={`${t('page.sprints.realClosedActive')}\n${rovoHint}`}
                              >
                                {pct(activeRate)}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>
                          ) : closedRate != null && doneAtClose != null ? (
                            <span
                              className="inline-flex items-center gap-2 justify-end"
                              title={`${t('page.sprints.realClosedDetail', {
                                issues: s.closedAtSprintEndIssues ?? 0,
                                total: s.totalIssues,
                                sp: (s.closedAtSprintEndStoryPoints ?? 0).toFixed(0),
                                totalSp: s.totalStoryPoints.toFixed(0),
                              })}\n${rovoHint}`}
                            >
                              <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                {doneAtClose.toFixed(0)}/{scope.toFixed(0)} {unit}
                              </span>
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                  closedRate >= completionThreshold.good ? "bg-green-500/20 text-green-400" :
                                  closedRate >= completionThreshold.warning ? "bg-orange-500/20 text-orange-400" :
                                  "bg-red-500/20 text-red-400"
                                }`}
                              >
                                {pct(closedRate)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs whitespace-nowrap" title={t('page.sprints.carryoverTooltip')}>
                          {s.carryoverCount > 0
                            ? <>{s.carryoverCount} · <span className="text-muted-foreground">{s.carryoverStoryPoints.toFixed(0)} SP</span></>
                            : <span className="text-muted-foreground">0</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs whitespace-nowrap" title={t('page.sprints.cycleTimeTooltip')}>
                          {days(s.medianCycleTimeDays)}
                          {s.cycleSampleSize > 0 && (
                            <span className="text-muted-foreground"> · n={s.cycleSampleSize}</span>
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <SprintCompositionCard projectId={project.id} window={period} />
        </>
      )}
    </div>
  );
}
