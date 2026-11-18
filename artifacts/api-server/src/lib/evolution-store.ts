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

export async function upsertDeliveries(
  projectId: string,
  ds: EvolutionDelivery[],
): Promise<{ written: number; frozen: number }> {
  let written = 0;
  for (let i = 0; i < ds.length; i += DELIVERY_CHUNK) {
    const chunk = ds.slice(i, i + DELIVERY_CHUNK);
    const res = await db
      .insert(evolutionDeliveriesTable)
      .values(chunk.map((d) => ({ projectId, ...d })))
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
          computedAt: new Date(),
        },
        setWhere: isNull(evolutionDeliveriesTable.frozenAt),
      })
      .returning({ id: evolutionDeliveriesTable.id });
    written += res.length;
  }
  return { written, frozen: ds.length - written };
}

/**
 * Sprints closed and deliveries delivered in [from, to). `reconstructedAt` is the newest compute time
 * among rows still open to rewrites; `frozenUntil` the latest close covered by a frozen sprint.
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

  let reconstructedAt: Date | null = null;
  let frozenUntil: Date | null = null;
  for (const s of sprints) {
    if (s.frozenAt === null) {
      if (reconstructedAt === null || s.computedAt > reconstructedAt) reconstructedAt = s.computedAt;
    } else if (frozenUntil === null || s.closedAt > frozenUntil) {
      frozenUntil = s.closedAt;
    }
  }

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

/** Freezes every not-yet-frozen sprint closed, and delivery delivered, before `until`. */
export async function freezeUntil(
  projectId: string,
  until: Date,
): Promise<{ sprints: number; deliveries: number }> {
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
