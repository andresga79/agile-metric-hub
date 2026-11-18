import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject, getGetProjectQueryKey,
  useGetCurrentUser, getGetCurrentUserQueryKey,
  useGetProjectEvolution, getGetProjectEvolutionQueryKey,
  useGetProjectMetrics, getGetProjectMetricsQueryKey,
  useCreateProjectMilestone, useDeleteProjectMilestone,
  useRunEvolutionBackfill, useGetEvolutionBackfillStatus, getGetEvolutionBackfillStatusQueryKey,
  NewMilestoneBodyKind,
  type EvolutionSprintRow, type EvolutionPeriodRow, type EvolutionComparison, type EvolutionComparisonSide, type EvolutionTimeSummary,
  type GetProjectEvolutionParams, type Milestone,
} from "@workspace/api-client-react";
import {
  ComposedChart, LineChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { ArrowLeft, ArrowRight, AlertTriangle, Download, LineChart as LineChartIcon, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { DetailSkeleton } from "@/components/page-skeleton";
import { ProjectTabs } from "@/components/project-tabs";
import { toEvolutionCsv, type CsvCell } from "@/lib/evolution-csv";

type By = "sprint" | "month" | "quarter";
type Row = EvolutionSprintRow | EvolutionPeriodRow;

const BY_OPTIONS: By[] = ["sprint", "month", "quarter"];
const FIRST_YEAR = 2026;
const TZ = "America/Santiago";
const SELECT_CLASS = "h-8 rounded-md border border-border bg-background px-2 text-xs";
const SEGMENT_CLASS = "px-3 py-1 text-xs font-medium rounded-sm transition-colors";
const TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const TOOLTIP_STYLE = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 };
const COLORS = { primary: "hsl(var(--primary))", rovo: "#a1a1aa", p85: "#f59e0b", milestone: "#8b5cf6" };

const isSprintRow = (r: Row): r is EvolutionSprintRow => "sprintId" in r;

/** Santiago-local year-month / quarter, same rule the server groups by. */
function periodOf(iso: string, by: "month" | "quarter"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit" }).formatToParts(new Date(iso));
  const year = parts.find((p) => p.type === "year")!.value;
  const month = Number(parts.find((p) => p.type === "month")!.value);
  return by === "month" ? `${year}-${String(month).padStart(2, "0")}` : `${year}-Q${Math.ceil(month / 3)}`;
}

function dayMonth(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

function dayMonthYear(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

const num = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : v.toFixed(digits));
const pctText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}%`);
const daysText = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(1)}d`);

function shortSprint(name: string): string {
  return name.replace(/^.*\s/, "S");
}

/** Log axes cannot draw 0; a same-day delivery is shown at the axis floor instead of vanishing. */
const forLog = (v: number | null) => (v === null ? null : Math.max(v, 0.1));

type TooltipArgs = { active?: boolean; payload?: readonly { payload?: unknown }[] };
function tooltipRow<T>(props: TooltipArgs): T | null {
  return props.active ? ((props.payload?.[0]?.payload as T | undefined) ?? null) : null;
}

interface MilestoneMark { x: string; label: string }

export default function ProjectEvolution() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const token = localStorage.getItem("auth_token");
  const queryClient = useQueryClient();

  const [by, setBy] = useState<By>("sprint");
  const [year, setYear] = useState(FIRST_YEAR);
  // undefined = default (first "rol" milestone); null = explicitly none.
  const [milestoneChoice, setMilestoneChoice] = useState<number | null | undefined>(undefined);

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: currentUser } = useGetCurrentUser({
    query: { enabled: !!token, queryKey: getGetCurrentUserQueryKey() },
  });
  const isAdmin = currentUser?.role === "admin";
  const isScrum = project?.boardType === "scrum";

  // Same endpoint/window as Métricas, only to read the lead/cycle time target.
  const { data: metrics } = useGetProjectMetrics(projectId!, "6s", {
    query: { enabled: !!projectId && !!token && isScrum, queryKey: getGetProjectMetricsQueryKey(projectId!, "6s") },
  });

  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  // Sprint rows are always loaded: they feed the milestone pickers and place milestones on month/quarter axes.
  const sprintParams: GetProjectEvolutionParams = { ...range, by: "sprint" };
  const sprintQuery = useGetProjectEvolution(projectId!, sprintParams, {
    query: { enabled: !!projectId && !!token && isScrum, queryKey: getGetProjectEvolutionQueryKey(projectId!, sprintParams) },
  });
  const milestones: Milestone[] = sprintQuery.data?.milestones ?? [];
  const defaultMilestone = milestones.find((m) => m.kind === "rol") ?? null;
  const selectedMilestone =
    milestoneChoice === null ? null
    : milestones.find((m) => m.id === milestoneChoice) ?? (milestoneChoice === undefined ? defaultMilestone : null);

  const params: GetProjectEvolutionParams = { ...range, by, ...(selectedMilestone ? { compare: selectedMilestone.id } : {}) };
  const mainQuery = useGetProjectEvolution(projectId!, params, {
    query: {
      enabled: !!projectId && !!token && isScrum && sprintQuery.isSuccess,
      queryKey: getGetProjectEvolutionQueryKey(projectId!, params),
    },
  });

  const invalidateEvolution = () => queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/evolution`] });

  // Backfill (admin): asynchronous; poll its status while it runs, then reload the evolution.
  const statusParams = { projectId: projectId! };
  const { data: backfill } = useGetEvolutionBackfillStatus(statusParams, {
    query: {
      enabled: !!projectId && !!token && isAdmin && isScrum,
      queryKey: getGetEvolutionBackfillStatusQueryKey(statusParams),
      refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
    },
  });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && backfill && !backfill.running) void invalidateEvolution();
    wasRunning.current = !!backfill?.running;
  }, [backfill?.running]);

  const [startNote, setStartNote] = useState<string | null>(null);
  const runBackfill = useRunEvolutionBackfill({
    mutation: {
      onSuccess: (res) => {
        setStartNote(res.started ? null : t("page.evolution.rebuildNotStarted", { reason: res.reason ?? "" }));
        void queryClient.invalidateQueries({ queryKey: getGetEvolutionBackfillStatusQueryKey(statusParams) });
      },
      onError: (err) => {
        const data = (err as { data?: { reason?: string; error?: string } }).data;
        setStartNote(t("page.evolution.rebuildNotStarted", { reason: data?.reason ?? data?.error ?? (err as Error).message }));
      },
    },
  });
  const backfillRunning = !!backfill?.running || runBackfill.isPending;

  const [milestoneError, setMilestoneError] = useState(false);
  const milestoneMutationOptions = {
    onSuccess: () => { setMilestoneError(false); void invalidateEvolution(); },
    onError: () => setMilestoneError(true),
  };
  const createMilestone = useCreateProjectMilestone({ mutation: milestoneMutationOptions });
  const deleteMilestone = useDeleteProjectMilestone({ mutation: milestoneMutationOptions });
  const [newSprintId, setNewSprintId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newKind, setNewKind] = useState<keyof typeof NewMilestoneBodyKind>("rol");

  if (loadingProject) return <DetailSkeleton />;
  if (!project) return <div className="p-6">{t("page.evolution.notFound")}</div>;

  const header = (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Link href={`/projects/${project.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-2 py-1 rounded">{project.key}</span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{t("page.evolution.title")}</h1>
      <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{t("page.evolution.subtitle")}</p>
    </div>
  );

  const failedBox = (msg: string) => (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{msg}</span>
    </div>
  );

  if (!isScrum) {
    return (
      <div className="space-y-6">
        {header}
        <ProjectTabs projectId={project.id} active="evolution" />
        <EmptyState icon={LineChartIcon} title={t("page.evolution.emptyMember")} />
      </div>
    );
  }

  if (sprintQuery.isLoading || (sprintQuery.isSuccess && mainQuery.isLoading)) {
    return (
      <div className="space-y-6">
        {header}
        <ProjectTabs projectId={project.id} active="evolution" />
        <div className="text-sm text-muted-foreground">{t("page.evolution.loading")}</div>
      </div>
    );
  }

  if (sprintQuery.isError || mainQuery.isError || !mainQuery.data) {
    return (
      <div className="space-y-6">
        {header}
        <ProjectTabs projectId={project.id} active="evolution" />
        {failedBox(t("page.evolution.loadError"))}
      </div>
    );
  }

  const data = mainQuery.data;
  const rows = data.rows;
  const sprintRows = (sprintQuery.data?.rows ?? []) as EvolutionSprintRow[];
  const comparison = data.comparison;

  // Backfill outcome (admin): an error or a failed sprint is always shown, never silently dropped.
  const backfillResult = backfill?.result ?? null;
  const backfillMessages: string[] = [];
  if (startNote) backfillMessages.push(startNote);
  if (isAdmin && backfill && !backfill.running) {
    if (backfill.error) backfillMessages.push(t("page.evolution.rebuildError", { error: backfill.error }));
    if (backfillResult?.failed) {
      backfillMessages.push(t("page.evolution.rebuildFailed", { sprint: backfillResult.failed.sprintName, error: backfillResult.failed.error }));
    }
  }
  const backfillDone = isAdmin && backfill && !backfill.running && !backfill.error && backfillResult && !backfillResult.failed
    ? t("page.evolution.rebuildDone", { written: backfillResult.written, frozen: backfillResult.frozen, skipped: backfillResult.skipped })
    : null;

  const rebuildButton = (
    <Button size="sm" disabled={backfillRunning} onClick={() => { setStartNote(null); runBackfill.mutate({ data: { projectId: project.id, from: `${year}-01-01` } }); }}>
      {backfillRunning ? t("page.evolution.rebuilding") : t("page.evolution.rebuild")}
    </Button>
  );
  const backfillBlock = (
    <div className="space-y-2">
      {backfillRunning && <p className="text-sm text-muted-foreground">{t("page.evolution.rebuildRunning")}</p>}
      {backfillMessages.map((m) => <div key={m}>{failedBox(m)}</div>)}
      {backfillDone && <p className="text-sm text-muted-foreground">{backfillDone}</p>}
    </div>
  );

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <ProjectTabs projectId={project.id} active="evolution" />
        <EmptyState icon={LineChartIcon} title={isAdmin ? t("page.evolution.empty") : t("page.evolution.emptyMember")} />
        {isAdmin && (
          <div className="space-y-3 flex flex-col items-center">
            {rebuildButton}
            {backfillBlock}
          </div>
        )}
      </div>
    );
  }

  // X axis: sprint short names, or period labels. A milestone sits at its sprint, or at the period that sprint closed in.
  const xOf = (r: Row) => (isSprintRow(r) ? shortSprint(r.sprintName) : r.period);
  const marks: MilestoneMark[] = [];
  for (const m of milestones) {
    const s = sprintRows.find((r) => r.sprintId === m.sprintId);
    if (!s) continue;
    const x = by === "sprint" ? shortSprint(s.sprintName) : periodOf(s.closedAt, by);
    if (rows.some((r) => xOf(r) === x)) marks.push({ x, label: m.label });
  }
  const markLines = marks.map((m) => (
    <ReferenceLine
      key={`${m.x}-${m.label}`} x={m.x} stroke={COLORS.milestone} strokeDasharray="3 3"
      label={{ value: m.label, position: "insideTopRight", fill: COLORS.milestone, fontSize: 10 }}
    />
  ));

  const target = (key: "cycleTime" | "leadTime") => metrics?.timeTargets?.[key] ?? null;
  const targetLine = (value: number | null) =>
    value === null ? null : (
      <ReferenceLine y={value} stroke="#22c55e" strokeDasharray="6 3" label={{ value: t("page.evolution.target", { value }), position: "insideBottomRight", fill: "#22c55e", fontSize: 10 }} />
    );

  const realClosedData = rows.map((r) => ({
    x: xOf(r),
    real: r.realClosedPct,
    rovo: isSprintRow(r) ? r.rovoPct : null,
  }));
  const timesData = (key: "ct" | "lt") =>
    rows.map((r) => ({ x: xOf(r), p50: forLog(r[key].p50), p85: forLog(r[key].p85), rawP50: r[key].p50, rawP85: r[key].p85, n: r[key].n }));
  const deliveredData = rows.map((r) => ({ x: xOf(r), delivered: r.delivered, people: r.people }));

  const logTooltip = (props: TooltipArgs) => {
    const p = tooltipRow<{ x: string; rawP50: number | null; rawP85: number | null; n: number }>(props);
    if (!p) return null;
    return (
      <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-0.5">
        <div className="font-semibold">{p.x}</div>
        <div>P50: {daysText(p.rawP50)}</div>
        <div>P85: {daysText(p.rawP85)}</div>
        <div className="text-muted-foreground">n = {p.n}</div>
      </div>
    );
  };

  const realTooltip = (props: TooltipArgs) => {
    const p = tooltipRow<{ x: string; real: number | null; rovo: number | null }>(props);
    if (!p) return null;
    return (
      <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-0.5 max-w-[16rem]">
        <div className="font-semibold">{p.x}</div>
        <div>{t("page.evolution.realClosedLabel")}: {pctText(p.real)}</div>
        {p.rovo !== null && <div>{t("page.evolution.rovoLabel")}: {pctText(p.rovo)}</div>}
        <div className="text-muted-foreground text-[11px] pt-1">{t("page.evolution.rovoNote")}</div>
      </div>
    );
  };

  const deliveredTooltip = (props: TooltipArgs) => {
    const p = tooltipRow<{ x: string; delivered: number; people: number }>(props);
    if (!p) return null;
    return (
      <div style={TOOLTIP_STYLE} className="px-3 py-2 space-y-0.5">
        <div className="font-semibold">{p.x}</div>
        <div>{t("page.evolution.deliveredLabel")}: {p.delivered}</div>
        <div>{t("page.evolution.peopleLabel")}: {p.people}</div>
      </div>
    );
  };

  const axes = (logScale = false, unit = "") => (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis dataKey="x" tick={TICK} />
      {logScale
        ? <YAxis scale="log" domain={["auto", "auto"]} tick={TICK} allowDataOverflow tickFormatter={(v: number) => `${v}${unit}`} />
        : <YAxis tick={TICK} unit={unit} />}
    </>
  );

  const timeChart = (key: "ct" | "lt", titleKey: string) => (
    <Card className="bg-card/40">
      <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t(titleKey)}</CardTitle></CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timesData(key)} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
              {axes(true)}
              <Tooltip content={logTooltip} />
              <Legend />
              <Line type="monotone" dataKey="p50" name="P50" stroke={COLORS.primary} strokeWidth={2} connectNulls={false} dot />
              <Line type="monotone" dataKey="p85" name="P85" stroke={COLORS.p85} strokeWidth={2} connectNulls={false} dot />
              {targetLine(target(key === "ct" ? "cycleTime" : "leadTime"))}
              {markLines}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );

  // ---- before / after
  const sinceLabel = selectedMilestone ? t("page.evolution.sinceMilestone", { label: selectedMilestone.label }) : "";
  type Metric = { key: string; label: string; value: (s: EvolutionComparisonSide) => number | null; n: (s: EvolutionComparisonSide) => number; fmt: (v: number | null) => string; unit: string; dev?: (s: EvolutionComparisonSide) => number | null };
  const metricDefs: Metric[] = [
    { key: "real", label: t("page.evolution.mRealClosed"), value: (s) => s.realClosedMean, dev: (s) => s.realClosedStdevPp, n: (s) => s.sprints, fmt: pctText, unit: "pp" },
    { key: "ct", label: t("page.evolution.mCtP85"), value: (s) => s.ctP85, n: (s) => s.ctN, fmt: daysText, unit: "d" },
    { key: "lt", label: t("page.evolution.mLtP50"), value: (s) => s.ltP50, n: (s) => s.ltN, fmt: daysText, unit: "d" },
    { key: "pp", label: t("page.evolution.mPerPerson"), value: (s) => s.deliveredPerPersonPerSprint, n: (s) => s.sprints, fmt: (v) => num(v, 1), unit: "" },
  ];
  const side = (m: Metric, s: EvolutionComparisonSide) => (
    <div>
      <div className="text-lg font-semibold tabular-nums">
        {m.fmt(m.value(s))}
        {m.dev && m.value(s) !== null && m.dev(s) !== null && <span className="text-xs font-normal text-muted-foreground"> ± {num(m.dev(s))} pp</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">{m.key === "real" || m.key === "pp" ? t("page.evolution.nSprints", { n: m.n(s) }) : t("page.evolution.nIssues", { n: m.n(s) })}</div>
    </div>
  );
  const delta = (m: Metric, c: EvolutionComparison) => {
    const a = m.value(c.before);
    const b = m.value(c.after);
    if (a === null || b === null) return "";
    const d = b - a;
    return `${d > 0 ? "+" : ""}${d.toFixed(1)}${m.unit ? ` ${m.unit}` : ""}`;
  };

  // ---- table + CSV
  const columns: { header: string; cell: (r: Row) => CsvCell; text?: (r: Row) => string }[] = isSprintRow(rows[0])
    ? ([
        ["page.evolution.col.sprint", (r: EvolutionSprintRow) => r.sprintName],
        ["page.evolution.col.start", (r: EvolutionSprintRow) => dayMonthYear(r.startAt)],
        ["page.evolution.col.close", (r: EvolutionSprintRow) => dayMonthYear(r.closedAt)],
        ["page.evolution.col.scope", (r: EvolutionSprintRow) => r.scopeIssues],
        ["page.evolution.col.planned", (r: EvolutionSprintRow) => r.plannedIssues],
        ["page.evolution.col.added", (r: EvolutionSprintRow) => r.addedIssues],
        ["page.evolution.col.carryover", (r: EvolutionSprintRow) => r.carryoverIssues],
        ["page.evolution.col.closedAtEnd", (r: EvolutionSprintRow) => r.closedAtEndIssues],
        ["page.evolution.col.realPct", (r: EvolutionSprintRow) => r.realClosedPct],
        ["page.evolution.col.rovoPct", (r: EvolutionSprintRow) => r.rovoPct],
        ["page.evolution.col.delivered", (r: EvolutionSprintRow) => r.delivered],
        ["page.evolution.col.sp", (r: EvolutionSprintRow) => r.deliveredSp],
        ["page.evolution.col.people", (r: EvolutionSprintRow) => r.people],
      ] as [string, (r: EvolutionSprintRow) => CsvCell][]).map(([k, f]) => ({ header: t(k), cell: f as (r: Row) => CsvCell }))
    : ([
        ["page.evolution.col.period", (r: EvolutionPeriodRow) => r.period],
        ["page.evolution.col.sprints", (r: EvolutionPeriodRow) => r.sprints],
        ["page.evolution.col.realPct", (r: EvolutionPeriodRow) => r.realClosedPct],
        ["page.evolution.col.delivered", (r: EvolutionPeriodRow) => r.delivered],
        ["page.evolution.col.sp", (r: EvolutionPeriodRow) => r.deliveredSp],
        ["page.evolution.col.people", (r: EvolutionPeriodRow) => r.people],
      ] as [string, (r: EvolutionPeriodRow) => CsvCell][]).map(([k, f]) => ({ header: t(k), cell: f as (r: Row) => CsvCell }));
  const timeCols: [string, (s: EvolutionTimeSummary) => CsvCell, "ct" | "lt"][] = [
    ["page.evolution.col.ctN", (s) => s.n, "ct"],
    ["page.evolution.col.ctP50", (s) => s.p50, "ct"],
    ["page.evolution.col.ctP85", (s) => s.p85, "ct"],
    ["page.evolution.col.ctAvg", (s) => s.avg, "ct"],
    ["page.evolution.col.ltP50", (s) => s.p50, "lt"],
    ["page.evolution.col.ltP85", (s) => s.p85, "lt"],
    ["page.evolution.col.ltAvg", (s) => s.avg, "lt"],
  ];
  for (const [k, f, which] of timeCols) columns.push({ header: t(k), cell: (r) => f(r[which]) });

  const display = (v: CsvCell) => (v === null || v === undefined ? "—" : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(1) : String(v));

  const exportCsv = () => {
    const csv = toEvolutionCsv(columns.map((c) => c.header), rows.map((r) => columns.map((c) => c.cell(r))));
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `evolucion-${project.key}-${by}-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const meta = data.meta;
  const footer = t("page.evolution.footer", {
    version: meta.formulaVersion,
    rebuilt: meta.reconstructedAt ? dayMonth(meta.reconstructedAt) : t("page.evolution.notYet"),
    frozen: meta.frozenUntil ? dayMonth(meta.frozenUntil) : t("page.evolution.notFrozen"),
  });

  const years = Array.from({ length: Math.max(FIRST_YEAR, new Date().getFullYear()) - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        {header}
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={t("page.evolution.year")} className={SELECT_CLASS} value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={years.length === 1}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <div className="flex bg-background border border-border rounded-md p-1">
            {BY_OPTIONS.map((b) => (
              <button key={b} onClick={() => setBy(b)} className={`${SEGMENT_CLASS} ${by === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {t(`page.evolution.by.${b}`)}
              </button>
            ))}
          </div>
          <select
            aria-label={t("page.evolution.milestone")} className={SELECT_CLASS}
            value={selectedMilestone?.id ?? ""} onChange={(e) => setMilestoneChoice(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">{t("page.evolution.noMilestone")}</option>
            {milestones.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      </div>

      <ProjectTabs projectId={project.id} active="evolution" />

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          {rebuildButton}
          {backfillBlock}
        </div>
      )}

      <Card className="bg-card/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("page.evolution.compareTitle")}{sinceLabel && <span className="text-muted-foreground font-normal"> · {sinceLabel}</span>}</CardTitle>
          <CardDescription>{t("page.evolution.compareNote")}</CardDescription>
        </CardHeader>
        <CardContent>
          {comparison ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {metricDefs.map((m) => (
                <div key={m.key} className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{m.label}</div>
                  <div className="flex items-center gap-3">
                    <div><div className="text-[11px] uppercase text-muted-foreground">{t("page.evolution.before")}</div>{side(m, comparison.before)}</div>
                    <ArrowRight size={14} className="text-muted-foreground shrink-0" />
                    <div><div className="text-[11px] uppercase text-muted-foreground">{t("page.evolution.after")}</div>{side(m, comparison.after)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">{delta(m, comparison) || "—"}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("page.evolution.noComparison")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("page.evolution.realClosedChart")}</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={realClosedData} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
                {axes(false, "%")}
                <Tooltip content={realTooltip} />
                <Legend />
                <Bar dataKey="real" name={t("page.evolution.realClosedLabel")} fill={COLORS.primary} radius={[3, 3, 0, 0]} />
                <Line dataKey="rovo" name={t("page.evolution.rovoLabel")} stroke={COLORS.rovo} strokeDasharray="5 4" strokeWidth={2} connectNulls={false} dot={false} />
                {markLines}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {timeChart("ct", "page.evolution.cycleChart")}
        {timeChart("lt", "page.evolution.leadChart")}
      </div>
      <p className="text-xs text-muted-foreground -mt-3">{t("page.evolution.lowN")}</p>

      <Card className="bg-card/40">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("page.evolution.deliveredChart")}</CardTitle></CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deliveredData} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
                {axes()}
                <Tooltip content={deliveredTooltip} />
                <Bar dataKey="delivered" name={t("page.evolution.deliveredLabel")} fill={COLORS.primary} radius={[3, 3, 0, 0]} />
                {markLines}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/40">
        <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">{t("page.evolution.tableTitle")}</CardTitle>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download size={14} className="mr-1.5" />{t("page.evolution.exportCsv")}</Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>{columns.map((c) => <TableHead key={c.header} className="whitespace-nowrap text-xs">{c.header}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={isSprintRow(r) ? r.sprintId : r.period + i}>
                  {columns.map((c) => <TableCell key={c.header} className="whitespace-nowrap text-xs tabular-nums">{display(c.cell(r))}</TableCell>)}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="bg-card/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">{t("page.evolution.milestonesTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("page.evolution.milestonesNone")}</p>
            ) : (
              <ul className="space-y-1">
                {milestones.map((m) => {
                  const s = sprintRows.find((r) => r.sprintId === m.sprintId);
                  return (
                    <li key={m.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{m.label}</span>
                      <span className="text-xs text-muted-foreground">{t(`page.evolution.kind.${m.kind}`)}{s ? ` · ${s.sprintName}` : ""}</span>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7" aria-label={t("page.evolution.milestoneDelete")} title={t("page.evolution.milestoneDelete")}
                        disabled={deleteMilestone.isPending} onClick={() => deleteMilestone.mutate({ projectId: project.id, milestoneId: m.id })}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newSprintId || !newLabel.trim()) return;
                createMilestone.mutate(
                  { projectId: project.id, data: { sprintId: Number(newSprintId), label: newLabel.trim(), kind: newKind } },
                  { onSuccess: () => setNewLabel("") },
                );
              }}
            >
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                {t("page.evolution.milestoneSprint")}
                <select className={SELECT_CLASS} value={newSprintId} onChange={(e) => setNewSprintId(e.target.value)} required>
                  <option value="" />
                  {sprintRows.map((r) => <option key={r.sprintId} value={r.sprintId}>{r.sprintName}</option>)}
                </select>
              </label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                {t("page.evolution.milestoneLabel")}
                <Input className="h-8 w-56 text-xs" maxLength={120} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} required />
              </label>
              <label className="text-xs text-muted-foreground flex flex-col gap-1">
                {t("page.evolution.milestoneKind")}
                <select className={SELECT_CLASS} value={newKind} onChange={(e) => setNewKind(e.target.value as keyof typeof NewMilestoneBodyKind)}>
                  {Object.values(NewMilestoneBodyKind).map((k) => <option key={k} value={k}>{t(`page.evolution.kind.${k}`)}</option>)}
                </select>
              </label>
              <Button type="submit" size="sm" disabled={createMilestone.isPending}>{t("page.evolution.milestoneAdd")}</Button>
            </form>
            {milestoneError && failedBox(t("page.evolution.milestoneError"))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{footer}</p>
    </div>
  );
}
