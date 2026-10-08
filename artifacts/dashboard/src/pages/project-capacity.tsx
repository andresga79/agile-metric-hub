import { Fragment, useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProject,
  getGetProjectQueryKey,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  useGetProjectCapacity,
  getGetProjectCapacityQueryKey,
  useUpdateProjectCapacity,
  type CapacityTeamRow,
  type CapacityMemberInput,
  type CapacityAbsence,
} from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ArrowLeft, Gauge, AlertTriangle, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricTooltip } from "@/components/metric-tooltip";
import { ProjectTabs } from "@/components/project-tabs";
import { EmptyState } from "@/components/empty-state";

type Band = "ok" | "warn" | "over";
type Unit = "sp" | "issues";
type View = "active" | "next";
type Portion = CapacityAbsence["portion"];
type AbsenceType = CapacityAbsence["type"];

const PORTIONS: Portion[] = ["full", "am", "pm"];
const ABSENCE_TYPES: AbsenceType[] = ["vacation", "sick", "personal", "training", "holiday", "other"];
const SELECT = "h-7 bg-background border border-border rounded px-1 text-xs";

/** Full day 1, morning or afternoon 0.5 — same rule as the server. */
function absenceTotal(absences: CapacityAbsence[]): number {
  return absences.reduce((sum, a) => sum + (a.portion === "full" ? 1 : 0.5), 0);
}

const BAND_TEXT: Record<Band, string> = {
  ok: "text-green-500",
  warn: "text-amber-600 dark:text-yellow-300",
  over: "text-red-400",
};
const BAND_BG: Record<Band, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  over: "bg-red-500",
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Recommended range as a band on a bar, with a marker where the planned amount falls. */
function RangeBar({ range, committed, band }: { range: number[]; committed: number; band: Band }) {
  const [lo, hi] = range as [number, number];
  const max = Math.max(hi * 1.4, committed * 1.1, 1);
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div className="relative h-3 rounded bg-muted mt-2" aria-hidden>
      <div className="absolute inset-y-0 bg-green-500/30 rounded" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
      <div className={`absolute -top-1 h-5 w-1 rounded ${BAND_BG[band]}`} style={{ left: pct(committed) }} />
    </div>
  );
}

export default function ProjectCapacity() {
  const { t, i18n } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const token = localStorage.getItem("auth_token");
  const queryClient = useQueryClient();

  const { data: project } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const { data: currentUser } = useGetCurrentUser({
    query: { enabled: !!token, queryKey: getGetCurrentUserQueryKey() },
  });
  const isAdmin = currentUser?.role === "admin";

  // undefined = let the server pick (next future sprint, else the active one) on first load.
  const [view, setView] = useState<View | undefined>(undefined);
  const params = view ? { sprint: view } : undefined;
  const { data, isLoading, isError } = useGetProjectCapacity(projectId!, params, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectCapacityQueryKey(projectId!, params) },
  });
  const save = useUpdateProjectCapacity();
  const shownView: View | undefined = view ?? (data?.sprint ? (data.sprint.state === "active" ? "active" : "next") : undefined);

  const [draft, setDraft] = useState<CapacityMemberInput[]>([]);
  const [dirty, setDirty] = useState(false);
  const [unit, setUnit] = useState<Unit>("sp");
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showNotCounting, setShowNotCounting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The route reuses this component across projects: drop the previous project's unsaved draft,
  // or Save would PUT one project's people into another project's sprint.
  // Same for switching between the active and the next sprint.
  useEffect(() => {
    setDirty(false);
    setDraft([]);
    setMessage(null);
    setExpanded(new Set());
  }, [projectId, view]);
  useEffect(() => setView(undefined), [projectId]);

  useEffect(() => {
    if (!data || dirty) return;
    setDraft(
      data.team.map(({ accountId, displayName, absenceDays, dedicationPct, counts, manual, recent, absences }) => ({
        accountId,
        displayName,
        absenceDays,
        dedicationPct,
        counts,
        manual,
        recent,
        absences,
      }))
    );
  }, [data, dirty]);

  const updateDraft = (accountId: string, patch: Partial<CapacityMemberInput>) => {
    setDirty(true);
    setMessage(null);
    setDraft((rows) => rows.map((r) => (r.accountId === accountId ? { ...r, ...patch } : r)));
  };

  /** Someone joining the team has no Jira issues yet, so no accountId: use a stable synthetic one. */
  const addPerson = () => {
    const name = newName.trim();
    if (!name) return;
    const accountId = `manual:${name.toLowerCase().replace(/\s+/g, "-")}`;
    if (draft.some((r) => r.accountId === accountId)) return;
    setDirty(true);
    setMessage(null);
    setDraft((rows) => [...rows, { accountId, displayName: name, absenceDays: 0, dedicationPct: 100, counts: true, manual: true, recent: true, absences: [] }]);
    setNewName("");
  };

  /** Dated absences set the total; with none left, the number goes back to 0 (editable by hand). */
  const setAbsences = (accountId: string, absences: CapacityAbsence[]) =>
    updateDraft(accountId, { absences, absenceDays: absenceTotal(absences) });

  const toggleExpanded = (accountId: string) =>
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });

  const sprintDays = data?.sprint?.days ?? [];
  const dayLabel = (date: string) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: "short",
      day: "numeric",
      month: "numeric",
      timeZone: "UTC",
    });

  /** New absence on the first day that still has room, full day. */
  const addAbsence = (m: CapacityMemberInput) => {
    const taken = (d: string) => m.absences.filter((a) => a.date === d).reduce((s, a) => s + (a.portion === "full" ? 1 : 0.5), 0);
    const date = sprintDays.find((d) => taken(d) === 0) ?? sprintDays[0];
    if (!date) return;
    setAbsences(m.accountId, [...m.absences, { date, portion: "full", type: "personal", note: null }]);
  };

  const absenceSummary = (absences: CapacityAbsence[]) => {
    const byType = new Map<AbsenceType, number>();
    for (const a of absences) byType.set(a.type, (byType.get(a.type) ?? 0) + (a.portion === "full" ? 1 : 0.5));
    return [...byType].map(([type, days]) => `${t(`page.capacity.absenceType.${type}`)} ${fmt(days)} d`).join(" · ");
  };

  const removePerson = (accountId: string) => {
    setDirty(true);
    setMessage(null);
    setDraft((rows) => rows.filter((r) => r.accountId !== accountId));
  };

  const onSave = () => {
    if (!data?.sprint) return;
    save.mutate(
      { projectId: projectId!, sprintId: data.sprint.id, data: draft },
      {
        onSuccess: async () => {
          // Refetch first, then release the draft: clearing `dirty` before the new data arrives
          // let the effect copy the OLD server data back over the table for a few seconds.
          await queryClient.invalidateQueries({ queryKey: getGetProjectCapacityQueryKey(projectId!) });
          setDirty(false);
          setMessage(t("page.capacity.saved"));
        },
        onError: (err: unknown) => {
          const body = (err as { data?: { error?: string } })?.data;
          setMessage(body?.error ?? String(err));
        },
      }
    );
  };

  const rowsById = new Map<string, CapacityTeamRow>((data?.team ?? []).map((r) => [r.accountId, r]));
  /** Showing the sprint in progress: progress so far, and load on what is still open. */
  const inProgress = !!data?.progress;
  const columns = inProgress ? 9 : 7;

  const renderMember = (m: CapacityMemberInput) => {
    const row = rowsById.get(m.accountId);
    const editable = isAdmin && m.counts && m.recent;
    const open = expanded.has(m.accountId);
    return (
      <Fragment key={m.accountId}>
      <TableRow className={m.counts && m.recent ? "" : "opacity-60"}>
        <TableCell className="font-medium">
          {m.displayName}
          {m.absences.length > 0 && (
            <div className="text-[11px] font-normal text-muted-foreground">{absenceSummary(m.absences)}</div>
          )}
          {m.manual && (
            <span className="ml-2 text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground">{t("page.capacity.manual")}</span>
          )}
          {!m.recent && (
            <span className="ml-2 text-[10px] rounded px-1 py-0.5 bg-muted text-muted-foreground">{t("page.capacity.historyOnly")}</span>
          )}
          {m.manual && isAdmin && (
            <button
              type="button"
              className="ml-2 text-xs text-red-400 hover:underline"
              onClick={() => removePerson(m.accountId)}
            >
              {t("page.capacity.remove")}
            </button>
          )}
        </TableCell>
        <TableCell className="text-center">
          <input
            type="checkbox"
            aria-label={`${t("page.capacity.counts")}: ${m.displayName}`}
            checked={m.counts}
            disabled={!isAdmin}
            onChange={(e) => updateDraft(m.accountId, { counts: e.target.checked })}
          />
        </TableCell>
        <TableCell className="text-right whitespace-nowrap">
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            aria-label={`${t("page.capacity.absence")}: ${m.displayName}`}
            title={m.absences.length > 0 ? t("page.capacity.absenceFromDates") : undefined}
            className="w-16 bg-background border border-border rounded px-1 text-right disabled:border-transparent"
            value={m.absenceDays}
            disabled={!editable || m.absences.length > 0}
            onChange={(e) => updateDraft(m.accountId, { absenceDays: Number(e.target.value) })}
          />
          {m.recent && m.counts && (editable || m.absences.length > 0) && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${t("page.capacity.absences")}: ${m.displayName}`}
              title={t("page.capacity.absences")}
              onClick={() => toggleExpanded(m.accountId)}
              className={`ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs align-middle ${open || m.absences.length > 0 ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <CalendarDays size={14} />
              {m.absences.length > 0 && m.absences.length}
            </button>
          )}
        </TableCell>
        <TableCell className="text-right">
          <input
            type="number"
            min={0}
            max={100}
            step={10}
            aria-label={`${t("page.capacity.dedication")}: ${m.displayName}`}
            className="w-16 bg-background border border-border rounded px-1 text-right disabled:border-transparent"
            value={m.dedicationPct}
            disabled={!isAdmin || !m.counts || !m.recent}
            onChange={(e) => updateDraft(m.accountId, { dedicationPct: Math.round(Number(e.target.value)) })}
          />
          %
        </TableCell>
        <TableCell className="text-right font-mono text-xs">
          {row && m.counts && m.recent ? `${fmt(row.capacity.sp)} SP · ${fmt(row.capacity.issues)}` : "—"}
        </TableCell>
        <TableCell className="text-right font-mono text-xs">
          {row ? `${fmt(row.assigned.sp)} SP · ${row.assigned.issues}` : "—"}
        </TableCell>
        {inProgress && (
          <>
            <TableCell className="text-right font-mono text-xs">
              {row ? `${fmt(row.done.sp)} SP · ${row.done.issues}` : "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {row ? `${fmt(row.assigned.sp - row.done.sp)} SP · ${row.assigned.issues - row.done.issues}` : "—"}
            </TableCell>
          </>
        )}
        <TableCell className={`text-right font-mono text-xs ${row && m.counts && m.recent ? BAND_TEXT[row.band as Band] : ""}`}>
          {!m.counts || !m.recent || !row ? "—" : row.loadPct == null ? (row.band === "over" ? "∞" : "—") : `${row.loadPct}%`}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent bg-muted/30">
          <TableCell colSpan={columns} className="py-3">
            <div className="space-y-2">
              {m.absences.length === 0 && <p className="text-xs text-muted-foreground">{t("page.capacity.noAbsences")}</p>}
              {m.absences.map((a, idx) => {
                const patch = (p: Partial<CapacityAbsence>) =>
                  setAbsences(m.accountId, m.absences.map((x, i) => (i === idx ? { ...x, ...p } : x)));
                if (!editable) {
                  return (
                    <p key={idx} className="text-xs">
                      <span className="font-medium">{dayLabel(a.date)}</span> · {t(`page.capacity.portion.${a.portion}`)} ·{" "}
                      {t(`page.capacity.absenceType.${a.type}`)}
                      {a.note && <span className="text-muted-foreground"> — {a.note}</span>}
                    </p>
                  );
                }
                return (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t("page.capacity.absenceDate")}
                      className={SELECT}
                      value={a.date}
                      onChange={(e) => patch({ date: e.target.value })}
                    >
                      {(sprintDays.includes(a.date) ? sprintDays : [a.date, ...sprintDays]).map((d) => (
                        <option key={d} value={d}>
                          {dayLabel(d)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("page.capacity.absencePortion")}
                      className={SELECT}
                      value={a.portion}
                      onChange={(e) => patch({ portion: e.target.value as Portion })}
                    >
                      {PORTIONS.map((p) => (
                        <option key={p} value={p}>
                          {t(`page.capacity.portion.${p}`)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t("page.capacity.absenceTypeLabel")}
                      className={SELECT}
                      value={a.type}
                      onChange={(e) => patch({ type: e.target.value as AbsenceType })}
                    >
                      {ABSENCE_TYPES.map((ty) => (
                        <option key={ty} value={ty}>
                          {t(`page.capacity.absenceType.${ty}`)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      maxLength={200}
                      aria-label={t("page.capacity.absenceNote")}
                      placeholder={t("page.capacity.absenceNotePlaceholder")}
                      className="h-7 flex-1 min-w-[12rem] bg-background border border-border rounded px-2 text-xs"
                      value={a.note ?? ""}
                      onChange={(e) => patch({ note: e.target.value || null })}
                    />
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:underline"
                      onClick={() => setAbsences(m.accountId, m.absences.filter((_, i) => i !== idx))}
                    >
                      {t("page.capacity.remove")}
                    </button>
                  </div>
                );
              })}
              {editable && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => addAbsence(m)} disabled={sprintDays.length === 0}>
                  {t("page.capacity.addAbsence")}
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
      </Fragment>
    );
  };

  const header = (
    <>
      <div>
        <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
          <ArrowLeft size={14} />
          {project?.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Gauge size={22} /> {t("page.capacity.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("page.capacity.subtitle")}</p>
      </div>
      <ProjectTabs projectId={projectId!} active="capacity" />
      <div className="inline-flex bg-background border border-border rounded-md p-1" role="group" aria-label={t("page.capacity.title")}>
        {(["active", "next"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={shownView === v}
            onClick={() => setView(v)}
            className={`px-3 py-1 text-xs font-medium rounded-sm ${shownView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {v === "active" ? t("page.capacity.viewActive") : t("page.capacity.viewNext")}
          </button>
        ))}
      </div>
    </>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-destructive">{t("common.loadFailed")}</p>
      </div>
    );
  }

  const rec = data.recommendation;
  const progress = data.progress;

  return (
    <div className="space-y-6">
      {header}

      {data.warnings.length > 0 && (
        <div className="space-y-1">
          {data.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600 dark:text-yellow-300 flex items-center gap-1">
              <AlertTriangle size={12} /> {w}
            </p>
          ))}
        </div>
      )}

      {!data.sprint ? (
        <EmptyState
          icon={Gauge}
          title={t(view === "active" ? "page.capacity.noActiveSprint" : view === "next" ? "page.capacity.noNextSprint" : "page.capacity.noSprint")}
          description=""
        />
      ) : (
        <Card className="bg-card/50">
          <CardHeader>
            <CardTitle>
              {data.sprint.state === "future" ? t("page.capacity.nextSprint") : t("page.capacity.activeSprint")}: {data.sprint.name}
            </CardTitle>
            <CardDescription>
              {progress
                ? `${t("page.capacity.dayOf", { elapsed: progress.elapsedDays, total: data.sprint.workingDays, remaining: progress.remainingDays })} · `
                : ""}
              {rec ? `${t("page.capacity.availability")}: ${rec.availabilityPct}% · ` : ""}
              {data.rate ? t("page.capacity.rateNote", { count: data.rate.sprintsUsed }) : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            {(["sp", "issues"] as Unit[]).map((u) => (
              <div key={u}>
                <div className="text-xs text-muted-foreground">{u === "sp" ? t("page.capacity.unitSp") : t("page.capacity.unitIssues")}</div>
                <div className="text-2xl font-bold">
                  {rec ? `${rec.range[u][0]}–${rec.range[u][1]}` : "—"}
                  <span className="text-sm font-normal text-muted-foreground"> {t("page.capacity.recommended").toLowerCase()}</span>
                </div>
                <div className={`text-sm ${rec ? BAND_TEXT[rec.band[u] as Band] : "text-muted-foreground"}`}>
                  {t("page.capacity.committed")}: {fmt(data.committed[u])}
                </div>
                {rec && <RangeBar range={rec.range[u]} committed={data.committed[u]} band={rec.band[u] as Band} />}
                {progress && (
                  <div className="mt-4">
                    <div className={`text-sm ${progress.pace ? BAND_TEXT[progress.pace[u] as Band] : ""}`}>
                      {t("page.capacity.done")}: {fmt(progress.done[u])}
                      <span className="text-muted-foreground">
                        {" "}· {t("page.capacity.remaining")}: {fmt(progress.remaining[u])}
                        {progress.expected && ` · ${t("page.capacity.expectedToday")}: ${progress.expected[u][0]}–${progress.expected[u][1]}`}
                      </span>
                      {progress.expected && <MetricTooltip description={t("page.capacity.paceTooltip")} />}
                    </div>
                    {progress.expected && progress.pace && (
                      <RangeBar range={progress.expected[u]} committed={progress.done[u]} band={progress.pace[u] as Band} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {data.sprint && (
        <Card className="bg-card/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-1">
              {t("page.capacity.team")}
              <MetricTooltip description={t(inProgress ? "page.capacity.loadTooltipActive" : "page.capacity.loadTooltip")} />
            </CardTitle>
            {!isAdmin && <CardDescription>{t("page.capacity.readOnly")}</CardDescription>}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("page.capacity.person")}</TableHead>
                    <TableHead className="text-center">
                      {t("page.capacity.counts")}
                      <MetricTooltip description={t("page.capacity.countsTooltip")} />
                    </TableHead>
                    <TableHead className="text-right">{t("page.capacity.absence")}</TableHead>
                    <TableHead className="text-right">{t("page.capacity.dedication")}</TableHead>
                    <TableHead className="text-right">
                      {inProgress ? t("page.capacity.capacityLeft") : t("page.capacity.capacity")}
                    </TableHead>
                    <TableHead className="text-right">{t("page.capacity.assigned")}</TableHead>
                    {inProgress && (
                      <>
                        <TableHead className="text-right">{t("page.capacity.done")}</TableHead>
                        <TableHead className="text-right">{t("page.capacity.remaining")}</TableHead>
                      </>
                    )}
                    <TableHead className="text-right">{t("page.capacity.load")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.filter((m) => m.counts && m.recent).map(renderMember)}
                  {(data.unassigned.sp > 0 || data.unassigned.issues > 0) && (
                    <TableRow>
                      <TableCell className="italic text-muted-foreground" colSpan={5}>
                        {t("page.capacity.unassigned")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-amber-600 dark:text-yellow-300">
                        {fmt(data.unassigned.sp)} SP · {data.unassigned.issues}
                      </TableCell>
                      <TableCell colSpan={columns - 6} />
                    </TableRow>
                  )}
                  {draft.some((m) => !(m.counts && m.recent)) && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns}>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          aria-expanded={showNotCounting}
                          onClick={() => setShowNotCounting((v) => !v)}
                        >
                          {showNotCounting ? "▾" : "▸"} {t("page.capacity.notCounting", { count: draft.filter((m) => !(m.counts && m.recent)).length })}
                        </button>
                      </TableCell>
                    </TableRow>
                  )}
                  {showNotCounting && draft.filter((m) => !(m.counts && m.recent)).map(renderMember)}
                </TableBody>
              </Table>
            </div>
            {isAdmin && (
              <div className="flex flex-wrap items-center gap-3 mt-4">
                <input
                  type="text"
                  value={newName}
                  placeholder={t("page.capacity.addPersonPlaceholder")}
                  aria-label={t("page.capacity.addPerson")}
                  className="h-8 w-48 bg-background border border-border rounded px-2 text-sm"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPerson()}
                />
                <Button size="sm" variant="outline" onClick={addPerson} disabled={!newName.trim()}>
                  {t("page.capacity.addPerson")}
                </Button>
                <Button size="sm" onClick={onSave} disabled={!dirty || save.isPending}>
                  {save.isPending ? t("page.capacity.saving") : t("page.capacity.save")}
                </Button>
                {message && <span className="text-xs text-muted-foreground">{message}</span>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.history.length > 0 && (
        <Card className="bg-card/40">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{t("page.capacity.history")}</CardTitle>
            <div className="flex bg-background border border-border rounded-md p-1">
              {(["sp", "issues"] as Unit[]).map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`px-3 py-1 text-xs font-medium rounded-sm ${unit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {u === "sp" ? t("page.capacity.unitSp") : t("page.capacity.unitIssues")}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={data.history.map((h) => ({
                  name: h.sprintName,
                  committed: h.committed[unit],
                  completed: h.completed[unit],
                  pct: h.completionPct,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number, n: string) => [fmt(v), n]} labelFormatter={(l: string) => l} />
                <Legend />
                <Bar dataKey="committed" name={t("page.capacity.committed")} fill="#94a3b8" />
                <Bar dataKey="completed" name={t("page.capacity.completed")} fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2">
              {data.history.map((h) => (
                <span key={h.sprintId}>
                  {h.sprintName}: <strong className="text-foreground">{h.completionPct}%</strong>
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
