import {
  getBoardIdOrThrow,
  getJiraSprintsOrThrow,
  getSprintIssuesOrThrow,
  getResolvedJiraIssuesBetween,
  getEffectiveIssueType,
  getDeliveryDate,
  getLeadTimeDays,
  getCycleTimeDays,
  getStoryPoints,
  isIssueDone,
  type JiraIssue,
  type JiraSprint,
} from "./jira";
import { getPortfolioAllowedIssueTypes } from "./portfolio-metric-settings";
import { computeSprintMetrics, type SprintMetric } from "../routes/sprint-metrics";
import {
  assignDeliverySprint,
  buildSprintRow,
  ownSprints,
  type EvolutionDelivery,
  type SprintWindow,
} from "./evolution";
import {
  upsertSprintRow,
  upsertDeliveries,
  storedSprintIds,
  latestStoredClose,
  type SprintSource,
} from "./evolution-store";

/** Jira and store access, injectable so the orchestration can be tested without either. */
export interface EvolutionDeps {
  getBoardId(projectId: string): Promise<number | null>;
  getSprints(projectId: string): Promise<JiraSprint[]>;
  getSprintIssues(sprintId: number): Promise<JiraIssue[]>;
  getAllowedIssueTypes(): Promise<string[]>;
  computeSprintMetrics(
    sprint: JiraSprint,
    issues: JiraIssue[],
    allowedIssueTypes: string[],
    allSprints: JiraSprint[],
  ): Promise<SprintMetric>;
  /** Deliveries (sprintId null) of allowed types around [from, toExclusive); may over-fetch. */
  getDeliveries(
    projectId: string,
    from: Date,
    toExclusive: Date,
    allowedIssueTypes: string[],
  ): Promise<EvolutionDelivery[]>;
  upsertSprintRow(row: Parameters<typeof upsertSprintRow>[0], source: SprintSource): Promise<"written" | "frozen">;
  upsertDeliveries(projectId: string, ds: EvolutionDelivery[]): Promise<{ written: number; frozen: number }>;
  storedSprintIds(projectId: string): Promise<Set<number>>;
  latestStoredClose(projectId: string): Promise<Date | null>;
}

export interface BackfillResult {
  projectId: string;
  written: number;
  frozen: number;
  skipped: number;
  failed: { sprintId: number; sprintName: string; error: string } | null;
}

/** Snapshots never reach back before the year the report covers. */
const SNAPSHOT_FLOOR = new Date("2026-01-01T00:00:00Z");

/** Delivered work in [from, toExclusive) by the same rules as Sprints/Métricas: allowed types,
 *  done, a delivery date (getDeliveryDate drops cancellations and cleanups). */
async function fetchDeliveries(
  projectId: string,
  from: Date,
  toExclusive: Date,
  allowedIssueTypes: string[],
): Promise<EvolutionDelivery[]> {
  const issues = await getResolvedJiraIssuesBetween(projectId, from, toExclusive, { includeChangelog: true });
  const candidates = issues.filter((i) => allowedIssueTypes.includes(getEffectiveIssueType(i)) && isIssueDone(i));
  const out: EvolutionDelivery[] = [];
  for (const i of candidates) {
    const deliveredAt = await getDeliveryDate(i);
    if (deliveredAt === null) continue;
    out.push({
      issueKey: i.key,
      issueType: getEffectiveIssueType(i),
      deliveredAt,
      leadDays: await getLeadTimeDays(i),
      cycleDays: await getCycleTimeDays(i),
      storyPoints: getStoryPoints(i),
      assigneeId: i.fields.assignee?.accountId ?? null,
      sprintId: null,
    });
  }
  return out;
}

const defaultDeps: EvolutionDeps = {
  getBoardId: (projectId) => getBoardIdOrThrow(projectId),
  getSprints: (projectId) => getJiraSprintsOrThrow(projectId),
  getSprintIssues: (sprintId) => getSprintIssuesOrThrow(sprintId),
  getAllowedIssueTypes: () => getPortfolioAllowedIssueTypes(),
  computeSprintMetrics,
  getDeliveries: fetchDeliveries,
  upsertSprintRow,
  upsertDeliveries,
  storedSprintIds,
  latestStoredClose,
};

interface ClosedSprint {
  sprint: JiraSprint;
  window: SprintWindow;
}

/** Own closed sprints with a usable [start, close) window, oldest close first. `unusable` are the
 *  ones without a start or a close (close kept when known, so callers count only those in range). */
async function closedOwnSprints(
  projectId: string,
  deps: EvolutionDeps,
): Promise<{ all: JiraSprint[]; closed: ClosedSprint[]; unusable: (Date | null)[] }> {
  const [all, boardId] = await Promise.all([deps.getSprints(projectId), deps.getBoardId(projectId)]);
  const unusable: (Date | null)[] = [];
  const closed: ClosedSprint[] = [];
  const parse = (raw: string | undefined) => {
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  for (const sprint of ownSprints(all, boardId)) {
    if (sprint.state !== "closed") continue;
    const start = parse(sprint.startDate);
    const close = parse(sprint.completeDate ?? sprint.endDate);
    if (!start || !close) {
      unusable.push(close);
      continue;
    }
    closed.push({ sprint, window: { sprintId: sprint.id, start, close } });
  }
  closed.sort((a, b) => a.window.close.getTime() - b.window.close.getTime());
  return { all, closed, unusable };
}

/** Unusable sprints that would have been processed: closed at or after `floor`, or with no close at all. */
const countSkipped = (unusable: (Date | null)[], floor: Date) =>
  unusable.filter((close) => close === null || close.getTime() >= floor.getTime()).length;

const within = (d: EvolutionDelivery, from: Date, toExclusive: Date) =>
  d.deliveredAt.getTime() >= from.getTime() && d.deliveredAt.getTime() < toExclusive.getTime();

/**
 * One sprint at a time, oldest close first. Each sprint's unit is: the gap before it (deliveries
 * since the previous close, or since `gapFrom`, outside every sprint), its scope and its window's
 * deliveries. Everything is fetched before anything is written, and deliveries are written before
 * the row, so a sprint that fails (read or write) gets no row and stops the run, reported in `failed`:
 * a row is never built on data that could not be read, nor stored without its deliveries.
 */
async function processSprints(
  projectId: string,
  todo: ClosedSprint[],
  allSprints: JiraSprint[],
  windows: SprintWindow[],
  gapFrom: Date,
  source: SprintSource,
  deps: EvolutionDeps,
  result: BackfillResult,
): Promise<BackfillResult> {
  if (todo.length === 0) return result;
  const allowed = await deps.getAllowedIssueTypes();
  let cursor = gapFrom;

  for (const { sprint, window } of todo) {
    try {
      let gapDeliveries: EvolutionDelivery[] = [];
      if (window.start.getTime() > cursor.getTime()) {
        const gapFrom = cursor;
        gapDeliveries = (await deps.getDeliveries(projectId, gapFrom, window.start, allowed))
          .filter((d) => within(d, gapFrom, window.start))
          .map((d) => ({ ...d, sprintId: assignDeliverySprint(d.deliveredAt, windows) }));
      }
      const issues = await deps.getSprintIssues(sprint.id);
      const metric = await deps.computeSprintMetrics(sprint, issues, allowed, allSprints);
      const windowDeliveries = (await deps.getDeliveries(projectId, window.start, window.close, allowed))
        .filter((d) => within(d, window.start, window.close));
      const row = buildSprintRow(projectId, sprint, metric, windowDeliveries);

      // Deliveries before the row: the row is what marks the sprint as stored (latestStoredClose), so
      // it must only exist once its deliveries are in, or a failed delivery write would leave a hole
      // the daily snapshot never revisits.
      await deps.upsertDeliveries(projectId, [
        ...gapDeliveries,
        ...windowDeliveries.map((d) => ({ ...d, sprintId: assignDeliverySprint(d.deliveredAt, windows) })),
      ]);
      const outcome = await deps.upsertSprintRow(row, source);
      if (outcome === "written") result.written += 1;
      else result.frozen += 1;
    } catch (err) {
      result.failed = {
        sprintId: sprint.id,
        sprintName: sprint.name,
        error: err instanceof Error ? err.message : String(err),
      };
      return result;
    }
    if (window.close.getTime() > cursor.getTime()) cursor = window.close;
  }
  return result;
}

const emptyResult = (projectId: string, skipped = 0): BackfillResult => ({
  projectId,
  written: 0,
  frozen: 0,
  skipped,
  failed: null,
});

/** (Re)computes every own closed sprint whose close is on or after `from`; frozen rows stay as they are. */
export async function backfillProject(
  projectId: string,
  from: Date,
  deps: EvolutionDeps = defaultDeps,
): Promise<BackfillResult> {
  const { all, closed, unusable } = await closedOwnSprints(projectId, deps);
  const todo = closed.filter((c) => c.window.close.getTime() >= from.getTime());
  return processSprints(
    projectId,
    todo,
    all,
    closed.map((c) => c.window),
    from,
    "backfill",
    deps,
    emptyResult(projectId, countSkipped(unusable, from)),
  );
}

/**
 * Daily sync: stores sprints closed since the newest stored one. Only for projects already
 * backfilled (no rows = nothing to extend; the first rows come from an explicit backfill), so the
 * sync never turns into a year-long fetch.
 */
export async function snapshotClosedSprints(
  projectId: string,
  deps: EvolutionDeps = defaultDeps,
): Promise<BackfillResult> {
  const latest = await deps.latestStoredClose(projectId);
  if (latest === null) return emptyResult(projectId);

  const [{ all, closed, unusable }, stored] = await Promise.all([
    closedOwnSprints(projectId, deps),
    deps.storedSprintIds(projectId),
  ]);
  const floor = latest.getTime() > SNAPSHOT_FLOOR.getTime() ? latest : SNAPSHOT_FLOOR;
  const todo = closed.filter(
    (c) =>
      !stored.has(c.sprint.id) &&
      c.window.close.getTime() > latest.getTime() &&
      c.window.close.getTime() >= SNAPSHOT_FLOOR.getTime(),
  );
  return processSprints(
    projectId,
    todo,
    all,
    closed.map((c) => c.window),
    floor,
    "on_close",
    deps,
    emptyResult(projectId, unusable.filter((close) => close !== null && close.getTime() > floor.getTime()).length),
  );
}
