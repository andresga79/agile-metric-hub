import {
  db,
  evolutionSprintsTable,
  evolutionDeliveriesTable,
  projectMilestonesTable,
  type EvolutionSprint,
  type NewEvolutionSprint,
  type Milestone,
  type NewMilestone,
} from "@workspace/db";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { FORMULA_VERSION, type EvolutionDelivery, type EvolutionSprintRow } from "./evolution";

export type { EvolutionSprint, NewEvolutionSprint, Milestone, NewMilestone };
export type SprintSource = "backfill" | "on_close";

const DELIVERY_CHUNK = 500;

export function toSprintRecord(row: EvolutionSprintRow, source: SprintSource): NewEvolutionSprint {
  return {
    projectId: row.projectId,
    sprintId: row.sprintId,
    sprintName: row.sprintName,
    startAt: row.startAt,
    closedAt: row.closedAt,
    scopeIssues: row.scopeIssues,
    scopeSp: row.scopeSp,
    plannedIssues: row.plannedIssues,
    addedIssues: row.addedIssues,
    carryoverIssues: row.carryoverIssues,
    closedAtEndIssues: row.closedAtEndIssues,
    closedAtEndSp: row.closedAtEndSp,
    realClosedPct: row.realClosedPct,
    rovoPct: row.rovoPct,
    delivered: row.delivered,
    deliveredSp: row.deliveredSp,
    people: row.people,
    ctN: row.ct.n,
    ctP50: row.ct.p50,
    ctP85: row.ct.p85,
    ctAvg: row.ct.avg,
    ltN: row.lt.n,
    ltP50: row.lt.p50,
    ltP85: row.lt.p85,
    ltAvg: row.lt.avg,
    formulaVersion: FORMULA_VERSION,
    source,
  };
}

export function fromSprintRecord(r: EvolutionSprint): EvolutionSprintRow {
  return {
    projectId: r.projectId,
    sprintId: r.sprintId,
    sprintName: r.sprintName,
    startAt: r.startAt,
    closedAt: r.closedAt,
    scopeIssues: r.scopeIssues,
    scopeSp: r.scopeSp,
    plannedIssues: r.plannedIssues,
    addedIssues: r.addedIssues,
    carryoverIssues: r.carryoverIssues,
    closedAtEndIssues: r.closedAtEndIssues,
    closedAtEndSp: r.closedAtEndSp,
    realClosedPct: r.realClosedPct,
    rovoPct: r.rovoPct,
    delivered: r.delivered,
    deliveredSp: r.deliveredSp,
    people: r.people,
    ct: { n: r.ctN, p50: r.ctP50, p85: r.ctP85, avg: r.ctAvg },
    lt: { n: r.ltN, p50: r.ltP50, p85: r.ltP85, avg: r.ltAvg },
    formulaVersion: r.formulaVersion,
  };
}

/** Writes (or refreshes) one sprint; a frozen row is never touched and reports "frozen". */
export async function upsertSprintRow(
  row: EvolutionSprintRow,
  source: SprintSource,
): Promise<"written" | "frozen"> {
  const rec = toSprintRecord(row, source);
  const { projectId: _p, sprintId: _s, ...updatable } = rec;
  const written = await db
    .insert(evolutionSprintsTable)
    .values(rec)
    .onConflictDoUpdate({
      target: [evolutionSprintsTable.projectId, evolutionSprintsTable.sprintId],
      set: { ...updatable, computedAt: new Date() },
      setWhere: isNull(evolutionSprintsTable.frozenAt),
    })
    .returning({ id: evolutionSprintsTable.id });
  return written.length > 0 ? "written" : "frozen";
}

/** One entry per issueKey, the last occurrence winning (Postgres rejects a key twice in one upsert). */
export function dedupeDeliveries(ds: EvolutionDelivery[]): EvolutionDelivery[] {
  const byKey = new Map<string, EvolutionDelivery>();
  for (const d of ds) {
    byKey.delete(d.issueKey);
    byKey.set(d.issueKey, d);
  }
  return [...byKey.values()];
}

export async function upsertDeliveries(
  projectId: string,
  input: EvolutionDelivery[],
): Promise<{ written: number; frozen: number }> {
  const ds = dedupeDeliveries(input);
  let written = 0;
  for (let i = 0; i < ds.length; i += DELIVERY_CHUNK) {
    const chunk = ds.slice(i, i + DELIVERY_CHUNK);
    const res = await db
      .insert(evolutionDeliveriesTable)
      .values(chunk.map((d) => ({ projectId, ...d, formulaVersion: FORMULA_VERSION })))
      .onConflictDoUpdate({
        target: [evolutionDeliveriesTable.projectId, evolutionDeliveriesTable.issueKey],
        set: {
          issueType: sql`excluded.issue_type`,
          deliveredAt: sql`excluded.delivered_at`,
          leadDays: sql`excluded.lead_days`,
          cycleDays: sql`excluded.cycle_days`,
          storyPoints: sql`excluded.story_points`,
          assigneeId: sql`excluded.assignee_id`,
          sprintId: sql`excluded.sprint_id`,
          formulaVersion: sql`excluded.formula_version`,
          computedAt: new Date(),
        },
        setWhere: isNull(evolutionDeliveriesTable.frozenAt),
      })
      .returning({ id: evolutionDeliveriesTable.id });
    written += res.length;
  }
  return { written, frozen: ds.length - written };
}

interface MetaSource {
  source: string;
  computedAt: Date;
  frozenAt: Date | null;
  closedAt: Date;
}

/**
 * `reconstructedAt`: newest compute time among backfilled (reconstructed) rows, frozen or not, so
 * freezing never erases the note; on_close rows are live captures, not reconstructions.
 * `frozenUntil`: latest close among frozen rows.
 */
export function evolutionMeta(rows: MetaSource[]): { reconstructedAt: Date | null; frozenUntil: Date | null } {
  let reconstructedAt: Date | null = null;
  let frozenUntil: Date | null = null;
  for (const r of rows) {
    if (r.source === "backfill" && (reconstructedAt === null || r.computedAt > reconstructedAt)) {
      reconstructedAt = r.computedAt;
    }
    if (r.frozenAt !== null && (frozenUntil === null || r.closedAt > frozenUntil)) frozenUntil = r.closedAt;
  }
  return { reconstructedAt, frozenUntil };
}

const TZ = "America/Santiago";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const wallFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function santiagoOffsetMs(at: Date): number {
  const p = Object.fromEntries(wallFmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Exclusive upper bound for "freeze until <day>": midnight starting the day after `until`, Santiago
 * time. `until` is an inclusive calendar day: a "YYYY-MM-DD" string is that day; a Date is read as
 * the Santiago calendar day it falls on.
 */
export function freezeBoundary(until: Date | string): Date {
  const day = typeof until === "string" ? until : dayFmt.format(until);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDay = next.toISOString().slice(0, 10);
  const wall = next.getTime();
  // First instant whose Santiago date is the next day. Try both offsets around the date (they differ on a
  // DST change day); when midnight itself doesn't exist (spring-forward) the valid one is 01:00.
  const candidates = [-1, 1]
    .map((k) => wall - santiagoOffsetMs(new Date(wall + k * 24 * 3600 * 1000)))
    .sort((p, q) => p - q);
  const hit = candidates.find(
    (t) => dayFmt.format(new Date(t)) === nextDay && dayFmt.format(new Date(t - 1)) !== nextDay,
  );
  return new Date(hit ?? candidates[0]!);
}

/**
 * Sprints closed and deliveries delivered in [from, to). See evolutionMeta for `reconstructedAt` / `frozenUntil`.
 */
export async function readEvolution(
  projectId: string,
  from: Date,
  to: Date,
): Promise<{
  rows: EvolutionSprintRow[];
  deliveries: EvolutionDelivery[];
  reconstructedAt: Date | null;
  frozenUntil: Date | null;
}> {
  const sprints = await db
    .select()
    .from(evolutionSprintsTable)
    .where(
      and(
        eq(evolutionSprintsTable.projectId, projectId),
        gte(evolutionSprintsTable.closedAt, from),
        lt(evolutionSprintsTable.closedAt, to),
      ),
    )
    .orderBy(asc(evolutionSprintsTable.closedAt));
  const dels = await db
    .select()
    .from(evolutionDeliveriesTable)
    .where(
      and(
        eq(evolutionDeliveriesTable.projectId, projectId),
        gte(evolutionDeliveriesTable.deliveredAt, from),
        lt(evolutionDeliveriesTable.deliveredAt, to),
      ),
    )
    .orderBy(asc(evolutionDeliveriesTable.deliveredAt));

  const { reconstructedAt, frozenUntil } = evolutionMeta(sprints);

  return {
    rows: sprints.map(fromSprintRecord),
    deliveries: dels.map((d) => ({
      issueKey: d.issueKey,
      issueType: d.issueType,
      deliveredAt: d.deliveredAt,
      leadDays: d.leadDays,
      cycleDays: d.cycleDays,
      storyPoints: d.storyPoints,
      assigneeId: d.assigneeId,
      sprintId: d.sprintId,
    })),
    reconstructedAt,
    frozenUntil,
  };
}

export async function storedSprintIds(projectId: string): Promise<Set<number>> {
  const rows = await db
    .select({ sprintId: evolutionSprintsTable.sprintId })
    .from(evolutionSprintsTable)
    .where(eq(evolutionSprintsTable.projectId, projectId));
  return new Set(rows.map((r) => r.sprintId));
}

/**
 * Freezes every not-yet-frozen sprint closed, and delivery delivered, up to and including the
 * calendar day `until` in America/Santiago (until 2026-12-31 covers all of 31-dic Santiago time).
 */
export async function freezeUntil(
  projectId: string,
  untilDay: Date | string,
): Promise<{ sprints: number; deliveries: number }> {
  const until = freezeBoundary(untilDay);
  const now = new Date();
  const sprints = await db
    .update(evolutionSprintsTable)
    .set({ frozenAt: now })
    .where(
      and(
        eq(evolutionSprintsTable.projectId, projectId),
        lt(evolutionSprintsTable.closedAt, until),
        isNull(evolutionSprintsTable.frozenAt),
      ),
    )
    .returning({ id: evolutionSprintsTable.id });
  const deliveries = await db
    .update(evolutionDeliveriesTable)
    .set({ frozenAt: now })
    .where(
      and(
        eq(evolutionDeliveriesTable.projectId, projectId),
        lt(evolutionDeliveriesTable.deliveredAt, until),
        isNull(evolutionDeliveriesTable.frozenAt),
      ),
    )
    .returning({ id: evolutionDeliveriesTable.id });
  return { sprints: sprints.length, deliveries: deliveries.length };
}

export async function listMilestones(projectId: string): Promise<Milestone[]> {
  return db
    .select()
    .from(projectMilestonesTable)
    .where(eq(projectMilestonesTable.projectId, projectId))
    .orderBy(asc(projectMilestonesTable.createdAt), asc(projectMilestonesTable.id));
}

export async function addMilestone(m: NewMilestone): Promise<Milestone> {
  const [created] = await db.insert(projectMilestonesTable).values(m).returning();
  return created!;
}

export async function deleteMilestone(projectId: string, id: number): Promise<boolean> {
  const res = await db
    .delete(projectMilestonesTable)
    .where(and(eq(projectMilestonesTable.projectId, projectId), eq(projectMilestonesTable.id, id)))
    .returning({ id: projectMilestonesTable.id });
  return res.length > 0;
}
