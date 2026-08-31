import { logger } from "./logger";
import {
  withCache,
  projectsCacheKey,
  issuesCacheKey,
  sprintsCacheKey,
} from "./jira-cache";

const ISSUE_TYPE_MAP: Record<string, string> = {
  // English
  story: "Story",
  "user story": "Story",
  bug: "Bug",
  defect: "Bug",
  task: "Task",
  subtask: "Task",
  "sub-task": "Task",
  epic: "Epic",
  "test execution": "Test Execution",
  test: "Test",
  "test plan": "Test Plan",
  // Spanish
  historia: "Story",
  "historia de usuario": "Story",
  problema: "Bug",
  error: "Bug",
  tarea: "Task",
  subtarea: "Task",
  "sub-tarea": "Task",
  "tarea técnica": "Task",
  "tarea tecnica": "Task",
  épica: "Epic",
  epica: "Epic",
};

export function mapIssueType(typeName: string): string {
  const key = typeName.toLowerCase().trim();
  return ISSUE_TYPE_MAP[key] ?? "Other";
}

export function getEffectiveIssueType(issue: JiraIssue): string {
  // Detect Jira subtasks explicitly so they can be handled separately from Tasks
  const subtype = (issue.fields.issuetype as any)?.subtask;
  if (subtype === true) return "Subtask";
  return mapIssueType(issue.fields.issuetype?.name ?? "");
}

export interface QaRejection {
  issueKey: string;
  issueSummary: string;
  issueType: string;
  fromStatus: string;
  toStatus: string;
  transitionedAt: Date;
}

export interface LinkedBug {
  bugKey: string;
  bugSummary: string;
  bugStatus: string;
  bugCreated: string;
  parentStoryKey: string;
  parentStorySummary: string;
  parentStoryRejected: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  description?: string;
  projectTypeKey: string;
  avatarUrls?: { "48x48": string };
  lead?: { displayName: string };
  self: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory?: { key: string; name?: string } };
    issuetype: { name: string; subtask?: boolean };
    priority: { name: string };
    assignee?: { displayName: string; accountId: string; avatarUrls?: { "48x48": string } };
    story_points?: number;
    customfield_10016?: number;
    customfield_10028?: number;
    customfield_10072?: number;
    customfield_10021?: Array<{ value?: string; id?: string; self?: string }> | null;
    created: string;
    resolutiondate?: string;
    timespent?: number;
    updated: string;
  };
  changelog?: {
    histories: {
      created: string;
      items: { field: string; fieldId?: string; fromString?: string | null; toString?: string | null }[];
    }[];
  };
  issuelinks?: {
    id: string;
    type: { name: string; inward: string; outward: string };
    inwardIssue?: {
      key: string;
      fields: { summary: string; issuetype: { name: string }; status: { name: string }; created: string };
    };
    outwardIssue?: {
      key: string;
      fields: { summary: string; issuetype: { name: string }; status: { name: string }; created: string };
    };
  }[];
}

export type ProjectBoardType = "scrum" | "kanban" | "simple";

/** A Jira issue is considered completed when its status category is "done",
 * regardless of the custom status name (works for Spanish/English workflows). */
export function isIssueDone(issue: JiraIssue): boolean {
  const cat = issue.fields.status.statusCategory?.key;
  if (cat) return cat === "done";
  // Fallback for instances that don't return statusCategory
  return /^(done|listo|terminado|finalizada|cerrado|resuelto|closed|resolved)$/i.test(
    issue.fields.status.name.trim()
  );
}

/** A Jira issue is in progress when its status category is "indeterminate". */
export function isIssueInProgress(issue: JiraIssue): boolean {
  return issue.fields.status.statusCategory?.key === "indeterminate";
}

/** Story points can live in several custom fields depending on the Jira
 * instance/project. Use whichever one carries a value. */
export function getStoryPoints(issue: JiraIssue): number {
  return (
    issue.fields.customfield_10016 ??
    issue.fields.customfield_10028 ??
    issue.fields.customfield_10072 ??
    0
  );
}

let statusCategoryCache: Map<string, string> | null = null;

/** Build (and cache) a map of status name -> status category key for the whole
 * Jira instance, so changelog entries (which only carry status names) can be
 * mapped back to their category ("new" | "indeterminate" | "done"). */
export async function getStatusCategoryMap(): Promise<Map<string, string>> {
  if (statusCategoryCache) return statusCategoryCache;
  const map = new Map<string, string>();
  try {
    const statuses = await jiraFetch<
      { name: string; statusCategory?: { key: string } }[]
    >("/status");
    for (const s of statuses) {
      if (s.statusCategory?.key) {
        map.set(s.name.trim().toLowerCase(), s.statusCategory.key);
      }
    }
    // Only persist the cache on a successful fetch, so a transient Jira error
    // doesn't permanently force cycle-time to fall back to lead time.
    statusCategoryCache = map;
  } catch (err) {
    logger.warn({ err }, "Failed to load status categories");
  }
  return map;
}

// --- QA rejection detection ---

let allStatusesCache: { id?: string; name: string; statusCategory?: { key: string } }[] | null = null;

const QA_PATTERNS = [/qa/i, /test(ing)?/i, /quality/i, /qc/i, /verification/i];

export function isQaStatus(statusName: string): boolean {
  return QA_PATTERNS.some((p) => p.test(statusName.trim()));
}

async function fetchAllStatuses(): Promise<
  { id?: string; name: string; statusCategory?: { key: string } }[]
> {
  if (!isJiraConfigured()) return [];
  if (allStatusesCache) return allStatusesCache;
  try {
    const statuses = await jiraFetch<
      { id?: string; name: string; statusCategory?: { key: string } }[]
    >("/status");
    allStatusesCache = statuses;
    return statuses;
  } catch (err) {
    logger.warn({ err }, "Failed to load statuses");
    return [];
  }
}

function deduplicateCaseInsensitive(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const lower = n.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

/** Returns all status names that are QA-related (matched by pattern). */
export async function getQaStatuses(): Promise<string[]> {
  const statuses = await fetchAllStatuses();
  return deduplicateCaseInsensitive(
    statuses.filter((s) => isQaStatus(s.name)).map((s) => s.name)
  );
}

const DEV_RETURN_BLOCKLIST_PATTERNS = [
  /ready for approve/i,
  /listo para aprob/i,
  /^approved$/i,
  /^aprobado$/i,
  /po accepted/i,
  /aprobe po/i,
  /peer review/i,
  /in review/i,
  /revision.*progreso/i,
  /ready for po/i,
  /listo para po/i,
  /validaci/i,
];

// Projects where QA returns are considered valid when moving back to backlog OR
// to a "ready" status (e.g. "Ready for DEV"). Supports project id or key.
const DEV_RETURN_ALLOW_READY_PROJECTS = new Set([
  "10848",
  "DCX",
]);

function allowsReadyReturnStatus(projectId?: string): boolean {
  if (!projectId) return false;
  return DEV_RETURN_ALLOW_READY_PROJECTS.has(projectId.trim().toUpperCase());
}

/** Statuses in the "new" category (backlog / to-do) are valid "return from
 *  QA" targets. Some projects also allow explicit "ready" targets.
 *
 *  Important: this still excludes generic in-progress states, so QA -> In
 *  Progress is not counted as backlog rejection noise. */
export async function getDevReturnStatuses(projectId?: string): Promise<string[]> {
  const statuses = await fetchAllStatuses();
  const allowReady = allowsReadyReturnStatus(projectId);
  return deduplicateCaseInsensitive(
    statuses
      .filter((s) => {
        const statusName = s.name.trim();
        const cat = s.statusCategory?.key;
        const isBacklogTarget = cat === "new";
        const isReadyTarget =
          allowReady &&
          /(^|\s)(ready|listo)(\s|$)/i.test(statusName) &&
          (cat === "new" || cat === "indeterminate");
        if (!isBacklogTarget && !isReadyTarget) return false;
        if (isQaStatus(s.name)) return false;
        return !DEV_RETURN_BLOCKLIST_PATTERNS.some((p) => p.test(s.name));
      })
      .map((s) => s.name)
  );
}

/** Build lookup sets for fast case-insensitive matching. */
export async function getQaStatusSet(): Promise<Set<string>> {
  const names = await getQaStatuses();
  return new Set(names.map((n) => n.toLowerCase()));
}

export async function getDevReturnStatusSet(projectId?: string): Promise<Set<string>> {
  const names = await getDevReturnStatuses(projectId);
  return new Set(names.map((n) => n.toLowerCase()));
}

/** Scan an issue's changelog for transitions from a QA status to a Dev/backlog
 *  status. Returns an array of QaRejection objects. */
export function findQaRejections(
  issue: JiraIssue,
  qaStatusSet: Set<string>,
  devStatusSet: Set<string>
): QaRejection[] {
  const histories = issue.changelog?.histories ?? [];
  const rejections: QaRejection[] = [];

  for (const h of histories) {
    for (const item of h.items) {
      if (item.field !== "status") continue;
      const from = item.fromString?.trim() ?? "";
      const to = item.toString?.trim() ?? "";
      if (!from || !to) continue;

      if (qaStatusSet.has(from.toLowerCase()) && devStatusSet.has(to.toLowerCase())) {
        rejections.push({
          issueKey: issue.key,
          issueSummary: issue.fields.summary,
          issueType: issue.fields.issuetype.name,
          fromStatus: from,
          toStatus: to,
          transitionedAt: new Date(h.created),
        });
      }
    }
  }

  return rejections;
}

export function isBugIssue(issue: JiraIssue): boolean {
  return mapIssueType(issue.fields.issuetype.name) === "Bug";
}

/** Extract bugs linked via issuelinks from a set of issues.
 *  For each issue, scans its issuelinks looking for Bug-type linked issues.
 *  Returns deduplicated LinkedBug entries. */
export function extractLinkedBugs(
  issues: JiraIssue[],
  rejectedIssueKeys: Set<string>
): LinkedBug[] {
  const bugs = new Map<string, LinkedBug>();

  for (const issue of issues) {
    const links = issue.issuelinks ?? [];
    for (const link of links) {
      // The linked issue could be inward or outward
      const linked = link.inwardIssue ?? link.outwardIssue;
      if (!linked) continue;
      if (mapIssueType(linked.fields.issuetype.name) !== "Bug") continue;

      const bugKey = linked.key;
      if (bugs.has(bugKey)) continue;

      bugs.set(bugKey, {
        bugKey,
        bugSummary: linked.fields.summary,
        bugStatus: linked.fields.status.name,
        bugCreated: linked.fields.created,
        parentStoryKey: issue.key,
        parentStorySummary: issue.fields.summary,
        parentStoryRejected: rejectedIssueKeys.has(issue.key),
      });
    }
  }

  return Array.from(bugs.values());
}

/** Count standalone Bug issues (not linked to any story in the set). */
export function countStandaloneBugs(
  issues: JiraIssue[],
  linkedBugKeys: Set<string>
): number {
  return issues.filter(
    (i) => isBugIssue(i) && !linkedBugKeys.has(i.key)
  ).length;
}

/** Lightweight QA rejection rate for a bounded [since, until) window — bounds BOTH the "entered
 *  QA" transitions and the rejections themselves to the window, unlike a naive scan of full
 *  issue-level changelogs (which lets stale, out-of-window transitions leak into the rate; see
 *  qa-rejected.ts's fixed logic, which this mirrors for portfolio-wide/summary use). */
export function computeQaRejectionRate(
  issues: JiraIssue[],
  qaStatusSet: Set<string>,
  devStatusSet: Set<string>,
  since: Date,
  until?: Date
): { totalIssuesThatEnteredQa: number; totalIssuesRejected: number; overallRejectionRate: number } {
  const enteredKeys = new Set<string>();
  const rejectedKeys = new Set<string>();

  for (const issue of issues) {
    const histories = issue.changelog?.histories ?? [];
    for (const h of histories) {
      const created = new Date(h.created);
      if (created < since || (until && created >= until)) continue;
      for (const item of h.items) {
        if (item.field !== "status") continue;
        const to = item.toString?.trim() ?? "";
        if (to && qaStatusSet.has(to.toLowerCase())) {
          enteredKeys.add(issue.key);
        }
      }
    }
    for (const r of findQaRejections(issue, qaStatusSet, devStatusSet)) {
      if (r.transitionedAt < since || (until && r.transitionedAt >= until)) continue;
      rejectedKeys.add(issue.key);
    }
  }

  const totalIssuesThatEnteredQa = enteredKeys.size;
  const totalIssuesRejected = rejectedKeys.size;
  const overallRejectionRate =
    totalIssuesThatEnteredQa > 0
      ? Math.round((totalIssuesRejected / totalIssuesThatEnteredQa) * 1000) / 10
      : 0;

  return { totalIssuesThatEnteredQa, totalIssuesRejected, overallRejectionRate };
}

// --- End QA rejection detection ---

/** Best effort resolution date: use resolutiondate, or find the last changelog
 * transition into a "done" status, or fall back to updated date. */
export async function getResolutionDate(
  issue: JiraIssue
): Promise<Date | null> {
  if (issue.fields.resolutiondate) {
    return new Date(issue.fields.resolutiondate);
  }
  if (!isIssueDone(issue)) return null;

  const histories = issue.changelog?.histories ?? [];
  if (histories.length > 0) {
    const categoryMap = await getStatusCategoryMap();
    const statusTransitions = histories
      .filter((h) => h.items.some((it) => it.field === "status"))
      .map((h) => ({
        at: new Date(h.created).getTime(),
        to: h.items.find((it) => it.field === "status")?.toString ?? "",
      }));

    // Try first with category map, then fall back to regex pattern matching
    let doneTransitions = statusTransitions.filter((t) => 
      categoryMap.get(t.to.trim().toLowerCase()) === "done"
    );

    // If no matches using the category map, try regex pattern matching
    if (doneTransitions.length === 0) {
      doneTransitions = statusTransitions.filter((t) =>
        /^(done|listo|terminado|finalizada|cerrado|resuelto|closed|resolved)$/i.test(t.to.trim())
      );
    }

    if (doneTransitions.length > 0) {
      doneTransitions.sort((a, b) => b.at - a.at);
      return new Date(doneTransitions[0].at);
    }
  }

  // Fallback to updated date if issue is marked as done but has no explicit resolution date
  if (issue.fields.updated) {
    return new Date(issue.fields.updated);
  }

  return null;
}

/** Lead time (days) = from issue creation to resolution. Total elapsed time,
 * including time spent waiting in the backlog. */
export async function getLeadTimeDays(issue: JiraIssue): Promise<number | null> {
  if (!isIssueDone(issue)) return null;
  const resolved = await getResolutionDate(issue);
  if (!resolved) return null;
  const created = new Date(issue.fields.created).getTime();
  return (resolved.getTime() - created) / (1000 * 60 * 60 * 24);
}

/** Cycle time (days) = from when active work started (first transition into an
 * "in progress" status) to resolution. Falls back to lead time when no such
 * transition is recorded in the changelog. */
export async function getCycleTimeDays(issue: JiraIssue): Promise<number | null> {
  if (!isIssueDone(issue)) return null;
  const resolved = await getResolutionDate(issue);
  if (!resolved) return null;
  const resolvedMs = resolved.getTime();

  const histories = issue.changelog?.histories ?? [];
  if (histories.length > 0) {
    const categoryMap = await getStatusCategoryMap();
    const transitions = histories
      .filter((h) => h.items.some((it) => it.field === "status"))
      .map((h) => ({
        at: new Date(h.created).getTime(),
        to: h.items.find((it) => it.field === "status")?.toString ?? "",
      }))
      .sort((a, b) => a.at - b.at);

    // Try first with category map for "indeterminate" (in progress)
    let firstInProgress = transitions.find(
      (t) => categoryMap.get(t.to.trim().toLowerCase()) === "indeterminate"
    );

    // If not found using category map, try regex pattern for in-progress statuses
    if (!firstInProgress) {
      firstInProgress = transitions.find((t) =>
        /^(in progress|en progreso|en proceso|in development|en desarrollo|working|trabajando)$/i.test(t.to.trim())
      );
    }

    if (firstInProgress) {
      return (resolvedMs - firstInProgress.at) / (1000 * 60 * 60 * 24);
    }
  }

  // No changelog / no in-progress transition recorded: fall back to lead time.
  return getLeadTimeDays(issue);
}

/** Matches status names like "Blocked", "Bloqueado", "Impediment", "Obstáculo" (case-insensitive). */
export function isBlockedStatus(name: string): boolean {
  return /block|impediment|bloqueado|obstáculo/i.test(name.trim());
}

function isBlockedFlagValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return /block|impediment|bloqueado|obstáculo/i.test(value.trim());
}

/** Whether the Jira "Flagged" field (customfield_10021) currently holds a blocked-like value. */
export function isIssueCurrentlyFlagged(issue: JiraIssue): boolean {
  const flagged = issue.fields.customfield_10021;
  if (!Array.isArray(flagged)) return false;
  return flagged.some((entry) => isBlockedFlagValue(entry?.value ?? null));
}

/** Blocked-time analysis only applies to work-item types that carry meaningful in-flight state. */
export function isBlockedEligibleIssueType(issue: JiraIssue): boolean {
  const normalized = mapIssueType(issue.fields.issuetype.name ?? "");
  return normalized === "Story" || normalized === "Task" || normalized === "Bug";
}

/** Whether an issue is blocked right now (status or Flagged field), independent of history. */
export function isIssueCurrentlyBlocked(issue: JiraIssue): boolean {
  if (isIssueDone(issue)) return false;
  return isBlockedStatus(issue.fields.status.name) || isIssueCurrentlyFlagged(issue);
}

// Counts issues that were marked "done" at some point and later moved back out of done — a real
// quality signal (premature "done", QA bounce-back). Shared by sprint-metrics.ts and
// kanban-metrics.ts. Requires the issues to have been fetched with includeChangelog: true.
//
// Matches transitions via statusCategory (falling back to a multi-language "done" name regex) —
// NOT a literal /^done$/i check, which only works by coincidence on projects whose done column is
// named exactly "Done" and silently undercounts everywhere else (listo, terminado, resuelto...).
export async function countReopenedIssues(issues: JiraIssue[]): Promise<number> {
  const categoryMap = await getStatusCategoryMap();
  const isDoneStatusName = (name: string | null | undefined): boolean => {
    if (!name) return false;
    const trimmed = name.trim();
    const category = categoryMap.get(trimmed.toLowerCase());
    if (category) return category === "done";
    return /^(done|listo|terminado|finalizada|cerrado|resuelto|closed|resolved)$/i.test(trimmed);
  };

  return issues.filter((issue) => {
    const statusTransitions = (issue.changelog?.histories ?? [])
      .map((h) => ({ at: new Date(h.created).getTime(), items: h.items.filter((it) => it.field === "status") }))
      .filter((h) => h.items.length > 0)
      .sort((a, b) => a.at - b.at);

    let sawDone = false;
    for (const transition of statusTransitions) {
      for (const item of transition.items) {
        if (sawDone && isDoneStatusName(item.fromString) && !isDoneStatusName(item.toString)) {
          return true;
        }
        if (isDoneStatusName(item.toString)) {
          sawDone = true;
        }
      }
    }
    return false;
  }).length;
}

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  goal?: string;
}

function sprintEndTime(sprint: JiraSprint): number | null {
  const raw = sprint.endDate ?? sprint.completeDate ?? null;
  return raw ? new Date(raw).getTime() : null;
}

// Jira's "Sprint" changelog field is multi-valued and cumulative: toString/fromString are
// comma-separated lists of every sprint name the issue has ever been tagged with as of that
// history entry (e.g. "Sprint 109, Sprint 110"), not a single before/after pair. We only need
// the union of every sprint name that ever appeared in either side across the whole history.
function sprintNamesEverAssociated(issue: JiraIssue): Set<string> {
  const names = new Set<string>();
  for (const h of issue.changelog?.histories ?? []) {
    for (const item of h.items) {
      if (item.field !== "Sprint") continue;
      for (const raw of [item.fromString, item.toString]) {
        for (const name of (raw ?? "").split(",")) {
          const trimmed = name.trim();
          if (trimmed) names.add(trimmed);
        }
      }
    }
  }
  return names;
}

/** Whether an issue carried over into `currentSprint` from a genuinely earlier sprint — one it
 * was already tagged with (per Sprint field history) whose end date precedes this sprint's
 * start date. Excludes sprints named in the history that end at/after the current sprint's
 * start (future/planning tags, or the current sprint itself), so pre-planning into an upcoming
 * sprint is never mistaken for carryover. Returns false (not true by default) when no changelog
 * or Sprint-field history exists — no evidence of a prior sprint means no carryover claim. */
export function isCarryoverIssue(issue: JiraIssue, allSprints: JiraSprint[], currentSprint: JiraSprint): boolean {
  const currentStart = currentSprint.startDate ? new Date(currentSprint.startDate).getTime() : null;
  if (currentStart === null) return false;

  const associatedNames = sprintNamesEverAssociated(issue);
  if (associatedNames.size === 0) return false;

  const sprintsByName = new Map(allSprints.map((s) => [s.name, s] as const));
  for (const name of associatedNames) {
    if (name === currentSprint.name) continue;
    const candidate = sprintsByName.get(name);
    if (!candidate) continue;
    const candidateEnd = sprintEndTime(candidate);
    if (candidateEnd !== null && candidateEnd < currentStart) return true;
  }
  return false;
}

/** Days from now back to the start of the earliest sprint among the last
 * `sprintCount` CLOSED sprints (by end date), capped by capLookbackDays so the
 * day count returned here always matches what getJiraIssuesForProject will
 * actually fetch. Also returns the exact sprint list selected, so callers have
 * a single source of truth for "which sprints" instead of re-deriving a
 * (potentially different) set via their own date filter. Returns null when
 * there are no closed sprints, or the earliest candidate has no startDate —
 * callers should fall back to a default day-based window in that case. */
export function resolveSprintWindowDays(
  sprints: JiraSprint[],
  sprintCount: number
): { days: number; sprintsIncluded: JiraSprint[] } | null {
  const closed = sprints
    .filter((s) => s.state === "closed")
    .sort((a, b) => (sprintEndTime(b) ?? 0) - (sprintEndTime(a) ?? 0))
    .slice(0, sprintCount);

  if (closed.length === 0) return null;

  const earliest = closed[closed.length - 1];
  if (!earliest.startDate) return null;

  const startMs = new Date(earliest.startDate).getTime();
  if (Number.isNaN(startMs)) return null;

  const rawDays = Math.max(1, Math.ceil((Date.now() - startMs) / (24 * 60 * 60 * 1000)));
  return { days: capLookbackDays(rawDays), sprintsIncluded: closed };
}

// "<N>s" = últimos N sprints CERRADOS (solo válido para proyectos Scrum). Solo se soportan los
// dos valores publicados en el contrato OpenAPI: "2s", "6s". Mirrors the token routes/metrics.ts
// already parses locally for /metrics/:period - shared here so the routes below (members, issues,
// health, analytics) don't each reinvent it.
const SPRINT_WINDOW_TOKEN_RE = /^(2|6)s$/;

export function parseSprintWindowToken(period: string): number | null {
  const match = SPRINT_WINDOW_TOKEN_RE.exec(period);
  return match ? Number(match[1]) : null;
}

export function isValidPeriodOrSprintWindow(period: string): boolean {
  return period === "1m" || period === "3m" || SPRINT_WINDOW_TOKEN_RE.test(period);
}

/** Resolves a "1m"/"3m"/"2s"/"6s" period token to an actual day count, fetching this project's
 * sprints only when the token is a sprint-window one. Returns an `error` for a sprint-window
 * token on a non-Scrum project, or when the project has no closed sprints yet to measure from -
 * callers should respond 400 in the first case (matches /metrics/:period's existing behavior) and
 * fall back to periodToDays in the second, mirroring computeMetrics' own "no sprints yet" fallback. */
export async function resolvePeriodDays(
  projectId: string,
  period: string,
  boardType: ProjectBoardType
): Promise<{ error: string } | { periodDays: number; sprintsIncluded: JiraSprint[] | null }> {
  const sprintWindowCount = parseSprintWindowToken(period);
  if (sprintWindowCount === null) {
    return { periodDays: periodToDays(period), sprintsIncluded: null };
  }
  if (boardType !== "scrum") {
    return { error: "Sprint-window periods (2s/6s) are only valid for Scrum projects." };
  }
  const sprints = await getJiraSprints(projectId);
  const resolved = resolveSprintWindowDays(sprints, sprintWindowCount);
  if (!resolved) {
    return { periodDays: periodToDays("3m"), sprintsIncluded: null };
  }
  return { periodDays: resolved.days, sprintsIncluded: resolved.sprintsIncluded };
}

/** Groups resolved issues into one bucket per sprint (chronological order),
 * summing story points resolved within each sprint's [startDate, endDate]
 * window. Mirrors the shape buildWeeklyVelocity produces for the weekly
 * (kanban / non-sprint-window) case, so the frontend chart doesn't need to
 * know which mode produced the data. */
export function buildSprintVelocityBuckets(
  resolved: JiraIssue[],
  resolvedMap: Map<string, Date>,
  closedSprints: JiraSprint[],
  leadCycleByIssueId: Map<string, { lead: number | null; cycle: number | null }>
): { label: string; value: number; avgCycleTime: number | null; avgLeadTime: number | null }[] {
  const chronological = [...closedSprints].sort((a, b) => {
    const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
    const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
    return aStart - bStart;
  });

  const avgOf = (values: number[]): number | null =>
    values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

  return chronological.map((sprint) => {
    const start = sprint.startDate ? new Date(sprint.startDate).getTime() : -Infinity;
    const endRaw = sprint.completeDate ?? sprint.endDate ?? null;
    const end = endRaw ? new Date(endRaw).getTime() : Infinity;

    const sprintIssues = resolved.filter((issue) => {
      const resolvedAt = resolvedMap.get(issue.id);
      if (!resolvedAt) return false;
      const t = resolvedAt.getTime();
      return t >= start && t < end;
    });

    const value = sprintIssues.reduce((sum, issue) => sum + getStoryPoints(issue), 0);
    const avgCycleTime = avgOf(
      sprintIssues.map((i) => leadCycleByIssueId.get(i.id)?.cycle).filter((v): v is number => v !== null && v !== undefined)
    );
    const avgLeadTime = avgOf(
      sprintIssues.map((i) => leadCycleByIssueId.get(i.id)?.lead).filter((v): v is number => v !== null && v !== undefined)
    );

    return { label: sprint.name, value, avgCycleTime, avgLeadTime };
  });
}

const JIRA_URL = process.env["JIRA_URL"] ?? "";
const JIRA_TIMEOUT_MS = 10000;
const JIRA_EMAIL = process.env["JIRA_EMAIL"] ?? "";
const JIRA_API_TOKEN = process.env["JIRA_API_TOKEN"] ?? "";

export const isJiraConfigured = () =>
  JIRA_URL.trim() !== "" &&
  JIRA_EMAIL.trim() !== "" &&
  JIRA_API_TOKEN.trim() !== "";

// Safe to expose to the frontend (unlike JIRA_EMAIL/JIRA_API_TOKEN) - lets pages link
// out to a real issue at ${getJiraBaseUrl()}/browse/${issueKey}.
export const getJiraBaseUrl = () => JIRA_URL;

function jiraHeaders(): Record<string, string> {
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// Retries only network-level failures (dropped/reset connections, abort timeouts) - an
// HTTP error response (4xx/5xx) still resolves normally and is handled by the caller,
// since retrying an actual bad request wouldn't help.
const JIRA_FETCH_MAX_ATTEMPTS = 3;
const JIRA_FETCH_RETRY_DELAY_MS = 500;

function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return (
    message.includes("econnreset") ||
    message.includes("other side closed") ||
    message.includes("fetch failed") ||
    message.includes("aborted")
  );
}

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 1; attempt <= JIRA_FETCH_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      return await fetch(url, { headers: jiraHeaders(), signal: controller.signal });
    } catch (err) {
      if (attempt === JIRA_FETCH_MAX_ATTEMPTS || !isTransientFetchError(err)) {
        throw err;
      }
      logger.warn({ err, url, attempt }, "Transient Jira fetch error, retrying");
      await new Promise((resolve) => setTimeout(resolve, JIRA_FETCH_RETRY_DELAY_MS * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("unreachable");
}

async function jiraFetch<T>(path: string): Promise<T> {
  const url = `${JIRA_URL}/rest/api/3${path}`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, path, body: text }, "Jira API error");
    throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function jiraAgileFetch<T>(url: string): Promise<T> {
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    const text = await response.text();
    const lowerBody = text.toLowerCase();
    const sprintBoardUnsupported =
      response.status === 400 &&
      /\/board\/\d+\/sprint/.test(url) &&
      (lowerBody.includes("no admite sprints") ||
        lowerBody.includes("does not support sprints") ||
        lowerBody.includes("tablero no admite sprints"));

    if (sprintBoardUnsupported) {
      logger.info({ status: response.status, url, body: text }, "Jira board does not support sprints");
      throw new Error("Jira board does not support sprints");
    }

    logger.warn({ status: response.status, url, body: text }, "Jira Agile API error");
    throw new Error(`Jira Agile API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function listJiraProjects(options?: { forceRefresh?: boolean }): Promise<JiraProject[]> {
  if (!isJiraConfigured()) {
    return getMockProjects();
  }

  return withCache(projectsCacheKey(), async () => {
    try {
      const result = await jiraFetch<{ values: JiraProject[] }>(
        "/project/search?maxResults=50&orderBy=name"
      );
      return result.values;
    } catch (err) {
      logger.warn({ err }, "Failed to fetch Jira projects, using mock data");
      return getMockProjects();
    }
  }, options);
}

export async function getJiraProject(projectId: string): Promise<JiraProject | null> {
  if (!isJiraConfigured()) {
    return getMockProjects().find((p) => p.id === projectId || p.key === projectId) ?? null;
  }

  try {
    return await jiraFetch<JiraProject>(`/project/${encodeURIComponent(projectId)}`);
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to fetch Jira project by id/key, falling back to project list");
  }

  try {
    const projects = await listJiraProjects();
    return projects.find((p) => p.id === projectId || p.key === projectId) ?? null;
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to fetch Jira project from project list");
    return null;
  }
}

export interface JiraComment {
  id: string;
  author?: { displayName: string };
  body: unknown; // Atlassian Document Format (ADF), not plain text - use adfToPlainText
  created: string;
  updated: string;
}

// Comments come back as ADF (a nested doc/paragraph/text tree), not plain strings -
// this walks the tree and concatenates every text node.
export function adfToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const node = doc as { type?: string; text?: string; content?: unknown[] };
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(adfToPlainText).join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

// Not cached: comments are low-volume, change at any time, and aren't part of the
// periodic project sync/warm-cache - unlike issues/sprints, there's no dashboard-wide
// re-read pattern here that would justify the 6h TTL used elsewhere in this file.
export async function getIssueComments(issueKey: string): Promise<JiraComment[]> {
  if (!isJiraConfigured()) return [];
  try {
    const result = await jiraFetch<{ comments: JiraComment[] }>(
      `/issue/${encodeURIComponent(issueKey)}/comment?orderBy=created`
    );
    return result.comments;
  } catch (err) {
    logger.warn({ err, issueKey }, "Failed to fetch issue comments");
    return [];
  }
}

const canonicalProjectIdCache = new Map<string, string>();

export async function getCanonicalProjectId(projectId: string): Promise<string> {
  if (!isJiraConfigured()) return projectId;

  const cached = canonicalProjectIdCache.get(projectId);
  if (cached) return cached;

  const projects = await listJiraProjects();
  const project = projects.find(
    (p) => p.id === projectId || p.key === projectId
  );
  const result = project?.id ?? projectId;
  canonicalProjectIdCache.set(projectId, result);
  return result;
}

/** Detect whether a project is run as Scrum or Kanban by inspecting its boards.
 * A project with at least one Scrum board is treated as Scrum (has velocity);
 * otherwise it's treated as Kanban (no velocity). */
/** Manual overrides when Jira board detection is incorrect.
 *  Key can be project ID (numeric) or project key. */
const MANUAL_BOARD_OVERRIDES: Record<string, ProjectBoardType> = {
  "10003": "scrum",  // OLP - Olimpo: no board resolves via location (detection falls to "simple"), but team uses Scrum
  "OLP": "scrum",
};

const MOCK_BOARD_TYPES: Record<string, ProjectBoardType> = {
  "10001": "scrum",
  "10002": "kanban",
  "10003": "scrum",
  "10004": "kanban",
};

export async function getProjectBoardType(
  projectId: string,
  options?: { forceRefresh?: boolean }
): Promise<ProjectBoardType> {
  if (!isJiraConfigured()) return MOCK_BOARD_TYPES[projectId] ?? "scrum";

  const override = MANUAL_BOARD_OVERRIDES[projectId];
  if (override) {
    // Route through the cache even though there's nothing to fetch, so the
    // boardType cache key still gets populated - the background sync's
    // health check otherwise always flags overridden projects as "partial".
    return withCache(`boardType:${projectId}`, async () => override, options);
  }

  return withCache(`boardType:${projectId}`, async () => {
    try {
      const url = `${JIRA_URL}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(
        projectId
      )}&maxResults=50`;
      const data = await jiraAgileFetch<{
        values?: { type?: string; location?: { projectId?: number; projectKey?: string } }[];
      }>(url);
      const boards = data.values ?? [];

      const owned = boards.filter((b) => {
        const loc = b.location;
        if (!loc) return false;
        return (
          String(loc.projectId ?? "") === String(projectId) ||
          String(loc.projectKey ?? "") === String(projectId)
        );
      });
      if (owned.length === 0) return "simple";

      // Prefer a Scrum board over the creation-order first - mirrors getBoardId's own
      // preference below. A project can accumulate an old/unused Kanban board alongside the
      // Scrum board the team actually works from (seen in practice: OLI has both "Tablero OLI"
      // (Kanban, board 10, created first) and "Tablero de Scrum" (board 15) - picking
      // creation-order-first previously misclassified it as Kanban).
      const scrum = owned.find((b) => b.type === "scrum");
      const primaryType = (scrum ?? owned[0]!).type;
      if (primaryType === "scrum" || primaryType === "kanban") return primaryType;
      return "simple";
    } catch (err) {
      logger.warn({ err, projectId }, "Failed to detect board type");
      return "simple";
    }
  }, options);
}

export async function getBoardId(
  projectId: string
): Promise<number | null> {
  if (!isJiraConfigured()) return null;
  try {
    const url = `${JIRA_URL}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectId)}&maxResults=50`;
    const data = await jiraAgileFetch<{
      values?: { id: number; type?: string; location?: { projectId?: number; projectKey?: string } }[];
    }>(url);
    const boards = data.values ?? [];
    // Find a board that belongs to this project (by location)
    const owned = boards.filter((b) => {
      const loc = b.location;
      if (!loc) return false;
      return (
        String(loc.projectId ?? "") === String(projectId) ||
        String(loc.projectKey ?? "") === String(projectId)
      );
    });
    if (owned.length === 0) return null;
    // Prefer a scrum board
    const scrum = owned.find((b) => b.type === "scrum");
    return (scrum ?? owned[0]!).id ?? null;
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to get board ID");
    return null;
  }
}

/** Return the set of status names that are columns of the project's board, so
 *  time-in-status / flow analytics can be scoped to the board's real workflow
 *  instead of mixing in statuses from other workflows living in the same project
 *  (e.g. SOLVIX, UX/UI tracks). Returns null when no owned board or columns are
 *  available (callers should then keep the unfiltered behavior). */
/** Maps lowercased status name -> current canonical (correctly-cased) status name, for every
 *  status configured on the project's board. A Map (not a Set) because a status renamed at some
 *  point in Jira's history (e.g. "In Progress" -> "IN PROGRESS") leaves old changelog entries
 *  carrying the pre-rename spelling - grouping by the raw string would otherwise split one board
 *  column's time into two near-duplicate rows (see computeTimeInStatus). */
export async function getBoardStatusNames(
  projectId: string
): Promise<Map<string, string> | null> {
  if (!isJiraConfigured()) return null;
  try {
    const boardId = await getBoardId(projectId);
    if (!boardId) return null;

    const url = `${JIRA_URL}/rest/agile/1.0/board/${boardId}/configuration`;
    const data = await jiraAgileFetch<{
      columnConfig?: {
        columns?: { name?: string; statuses?: { id?: string }[] }[];
      };
    }>(url);
    const columns = data.columnConfig?.columns ?? [];
    const statusIds = new Set<string>();
    for (const col of columns) {
      for (const s of col.statuses ?? []) {
        if (s.id) statusIds.add(s.id);
      }
    }
    if (statusIds.size === 0) return null;

    const statuses = await fetchAllStatuses();
    const idToName = new Map(
      statuses.filter((s) => s.id).map((s) => [s.id, s.name])
    );
    const names = new Map<string, string>();
    for (const id of statusIds) {
      const name = idToName.get(id);
      if (name) names.set(name.trim().toLowerCase(), name.trim());
    }
    return names.size > 0 ? names : null;
  } catch (err) {
    logger.warn({ err, projectId }, "Failed to load board status names");
    return null;
  }
}

export async function getJiraSprints(
  projectId: string,
  maxResults: number = 50,
  options?: { forceRefresh?: boolean }
): Promise<JiraSprint[]> {
  if (!isJiraConfigured()) return [];

  return withCache(sprintsCacheKey(projectId), async () => {
    let boardId: number | null = null;
    try {
      boardId = await getBoardId(projectId);
      if (!boardId) return [];

      // Fetch all sprints with pagination
      const allSprints: JiraSprint[] = [];
      const pageSize = 50;
      let startAt = 0;
      let total = 0;

      for (let page = 0; page < 5; page++) {
        const sprintUrl = `${JIRA_URL}/rest/agile/1.0/board/${boardId}/sprint?maxResults=${pageSize}&startAt=${startAt}&state=closed,active`;
        const sprintData = await jiraAgileFetch<{
          values: JiraSprint[];
          total?: number;
          isLast?: boolean;
        }>(sprintUrl);

        const sprints = sprintData.values ?? [];
        allSprints.push(...sprints);
        total = sprintData.total ?? allSprints.length;

        if (sprintData.isLast || sprints.length < pageSize) break;
        startAt += pageSize;
      }

      return allSprints.sort((a, b) => {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
        return bEnd - aEnd;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      if (message.includes("does not support sprints") || message.includes("no admite sprints")) {
        logger.info({ projectId, boardId }, "Skipping sprint fetch for board without sprint support");
        return [];
      }
      logger.warn({ err, projectId }, "Failed to fetch sprints");
      return [];
    }
  }, options);
}

type JiraSearchResponse = {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
};

/** Fetch all issues assigned to a specific sprint via JQL `sprint = {sprintId}`. */
export async function getSprintIssues(
  sprintId: number,
  maxResults: number = 100
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) return [];
  const fields =
    "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,created,resolutiondate,updated";
  try {
    const allIssues: JiraIssue[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < 5; page++) {
      const jql = encodeURIComponent(`sprint = ${sprintId} ORDER BY created DESC`);
      const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
        `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}&expand=changelog${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
      );
      const pageIssues = result.issues ?? [];
      allIssues.push(...pageIssues);
      if (result.isLast || pageIssues.length < maxResults) break;
      pageToken = result.nextPageToken ?? null;
      if (!pageToken) break;
    }
    return allIssues;
  } catch (err) {
    logger.warn({ err, sprintId }, "Failed to fetch sprint issues");
    return [];
  }
}

export const JIRA_MAX_LOOKBACK_DAYS = 90;

export function capLookbackDays(periodDays: number): number {
  return Math.min(Math.max(1, periodDays), JIRA_MAX_LOOKBACK_DAYS);
}

export async function getJiraIssuesForProject(
  projectId: string,
  periodDays: number,
  options?: { includeChangelog?: boolean; includeIssueLinks?: boolean; forceRefresh?: boolean }
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) {
    return getMockIssues(projectId);
  }

  const includeChangelog = options?.includeChangelog === true;
  const includeIssueLinks = options?.includeIssueLinks === true;
  const effectivePeriodDays = capLookbackDays(periodDays);
  const canonicalProjectId = await getCanonicalProjectId(projectId);
  const cacheKey = includeChangelog
    ? `${issuesCacheKey(canonicalProjectId, effectivePeriodDays)}:changelog${includeIssueLinks ? ":links" : ""}`
    : issuesCacheKey(canonicalProjectId, effectivePeriodDays);

  return withCache(cacheKey, async () => {
    const since = new Date();
    since.setDate(since.getDate() - effectivePeriodDays);

    const baseFields =
      "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,customfield_10021,created,resolutiondate,updated";
    const fields = includeIssueLinks ? `${baseFields},issuelinks` : baseFields;

    const maxResults = 100;
    const MAX_PAGES = 5;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const formatDate = (d: Date): string => d.toISOString().split("T")[0]!;

    // This Jira site's /search/jql nextPageToken never actually advances the
    // result window (confirmed directly against the API: page 2 returns the
    // identical issues as page 1, regardless of sort field). Work around it by
    // splitting the date range into weekly chunks small enough that a single
    // page (100 results) covers each chunk, instead of depending on multi-page
    // pagination at all. The inner loop below still attempts pagination
    // defensively in case a chunk genuinely exceeds 100, but bails out the
    // moment it detects the page isn't moving instead of grinding to MAX_PAGES.
    const fetchPagedIssuesInRange = async (
      buildJql: (from: string, to: string) => string,
      fromDate: Date,
      toDate: Date
    ): Promise<JiraIssue[]> => {
      const issues: JiraIssue[] = [];
      let pageToken: string | null = null;
      let pageCount = 0;
      let lastSeenKey: string | null = null;
      const jql = encodeURIComponent(buildJql(formatDate(fromDate), formatDate(toDate)));

      for (;;) {
        if (++pageCount > MAX_PAGES) break;

        const expandParam = includeChangelog ? "&expand=changelog" : "";
        const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
          `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}${expandParam}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
        );
        const pageIssues = result.issues ?? [];
        const newLastKey = pageIssues[pageIssues.length - 1]?.key ?? null;
        if (pageCount > 1 && newLastKey !== null && newLastKey === lastSeenKey) {
          logger.warn({ projectId, jql: buildJql(formatDate(fromDate), formatDate(toDate)) }, "Pagination stalled (Jira returned the same page again), stopping");
          break;
        }
        issues.push(...pageIssues);
        if (result.isLast || pageIssues.length < maxResults) break;
        lastSeenKey = newLastKey;
        pageToken = result.nextPageToken ?? null;
        if (!pageToken) break;
      }

      return issues;
    };

    const fetchPagedIssuesChunked = async (buildJql: (from: string, to: string) => string): Promise<JiraIssue[]> => {
      const CHUNK_DAYS = 7;
      const CONCURRENCY = 4;
      const now = new Date();
      const chunks: Array<[Date, Date]> = [];
      let chunkStart = since;
      while (chunkStart <= now) {
        const chunkEnd = new Date(Math.min(chunkStart.getTime() + (CHUNK_DAYS - 1) * ONE_DAY_MS, now.getTime()));
        chunks.push([chunkStart, chunkEnd]);
        chunkStart = new Date(chunkEnd.getTime() + ONE_DAY_MS);
      }

      const allIssues: JiraIssue[] = [];
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(([from, to]) => fetchPagedIssuesInRange(buildJql, from, to)));
        for (const r of results) allIssues.push(...r);
      }
      return allIssues;
    };

    // Fetch resolved and unresolved streams separately so large active backlogs don't hide resolved issues.
    const [resolvedIssues, unresolvedIssues] = await Promise.all([
      fetchPagedIssuesChunked(
        (from, to) =>
          `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND resolutiondate >= "${from}" AND resolutiondate <= "${to}"`
      ),
      fetchPagedIssuesChunked(
        (from, to) =>
          `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND created >= "${from}" AND created <= "${to}" AND resolutiondate is EMPTY`
      ),
    ]);

    const allIssues = [...resolvedIssues, ...unresolvedIssues];
    const deduped = Array.from(new Map(allIssues.map((issue) => [issue.id, issue])).values());

    return deduped;
  }, { forceRefresh: options?.forceRefresh });
}

/** Resolved issues only, in an arbitrary [now - fromDaysAgo, now - toDaysAgo) historical slice —
 *  deliberately bypasses capLookbackDays/JIRA_MAX_LOOKBACK_DAYS (unlike getJiraIssuesForProject),
 *  since that 90-day ceiling is specifically about "how far back a *current* activity fetch looks"
 *  (Forecast and Analytics both build on it and were tuned to respect it). This is for a genuinely
 *  historical comparison window instead — e.g. "the 90 days before the current period" — so it
 *  needs to reach further back than 90 days without touching that shared constant. */
export async function getResolvedJiraIssuesInRange(
  projectId: string,
  fromDaysAgo: number,
  toDaysAgo: number,
  options?: { includeChangelog?: boolean; forceRefresh?: boolean }
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) {
    return getMockIssues(projectId);
  }

  const includeChangelog = options?.includeChangelog === true;
  const canonicalProjectId = await getCanonicalProjectId(projectId);
  const cacheKey = `issues:${canonicalProjectId}:range:${fromDaysAgo}-${toDaysAgo}${includeChangelog ? ":changelog" : ""}`;

  return withCache(cacheKey, async () => {
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - fromDaysAgo);
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() - toDaysAgo);

    const fields =
      "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,customfield_10021,created,resolutiondate,updated";
    const maxResults = 100;
    const MAX_PAGES = 5;
    const CHUNK_DAYS = 7;
    const CONCURRENCY = 4;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const formatDate = (d: Date): string => d.toISOString().split("T")[0]!;

    const expandParam = includeChangelog ? "&expand=changelog" : "";

    const fetchPage = async (from: string, to: string): Promise<JiraIssue[]> => {
      const jql = encodeURIComponent(
        `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND resolutiondate >= "${from}" AND resolutiondate <= "${to}"`
      );
      const issues: JiraIssue[] = [];
      let pageToken: string | null = null;
      let pageCount = 0;
      let lastSeenKey: string | null = null;

      for (;;) {
        if (++pageCount > MAX_PAGES) break;
        const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
          `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}${expandParam}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
        );
        const pageIssues = result.issues ?? [];
        const newLastKey = pageIssues[pageIssues.length - 1]?.key ?? null;
        if (pageCount > 1 && newLastKey !== null && newLastKey === lastSeenKey) {
          logger.warn({ projectId, from, to }, "Pagination stalled (Jira returned the same page again), stopping");
          break;
        }
        issues.push(...pageIssues);
        if (result.isLast || pageIssues.length < maxResults) break;
        lastSeenKey = newLastKey;
        pageToken = result.nextPageToken ?? null;
        if (!pageToken) break;
      }
      return issues;
    };

    const chunks: Array<[Date, Date]> = [];
    let chunkStart = rangeStart;
    while (chunkStart <= rangeEnd) {
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + (CHUNK_DAYS - 1) * ONE_DAY_MS, rangeEnd.getTime()));
      chunks.push([chunkStart, chunkEnd]);
      chunkStart = new Date(chunkEnd.getTime() + ONE_DAY_MS);
    }

    const allIssues: JiraIssue[] = [];
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(([from, to]) => fetchPage(formatDate(from), formatDate(to))));
      for (const r of results) allIssues.push(...r);
    }

    return Array.from(new Map(allIssues.map((issue) => [issue.id, issue])).values());
  }, { forceRefresh: options?.forceRefresh });
}

export async function getFlaggedJiraIssuesForProject(
  projectId: string,
  options?: { includeChangelog?: boolean; forceRefresh?: boolean }
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) {
    return [];
  }

  const includeChangelog = options?.includeChangelog === true;
  const canonicalProjectId = await getCanonicalProjectId(projectId);
  const cacheKeyBase = `issues:${canonicalProjectId}:flagged`;
  const cacheKey = includeChangelog ? `${cacheKeyBase}:changelog` : cacheKeyBase;

  return withCache(cacheKey, async () => {
    const fields =
      "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,customfield_10021,created,resolutiondate,updated";

    const maxResults = 100;
    const MAX_PAGES = 50;
    const issues: JiraIssue[] = [];
    let pageToken: string | null = null;
    let pageCount = 0;
    const jql = encodeURIComponent(
      `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND Flagged is not EMPTY ORDER BY updated DESC`
    );

    for (;;) {
      if (++pageCount > MAX_PAGES) {
        logger.warn({ projectId, total: issues.length }, "Too many pages while fetching flagged issues");
        break;
      }

      const expandParam = includeChangelog ? "&expand=changelog" : "";
      const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
        `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}${expandParam}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
      );

      const pageIssues = result.issues ?? [];
      issues.push(...pageIssues);
      if (result.isLast || pageIssues.length < maxResults) break;
      pageToken = result.nextPageToken ?? null;
      if (!pageToken) break;
    }

    return Array.from(new Map(issues.map((issue) => [issue.id, issue])).values());
  }, { forceRefresh: options?.forceRefresh });
}

/** All currently unresolved issues for a project, with no age bound at all — unlike
 * getJiraIssuesForProject(periodDays), which only ever returns an issue that's still open if it
 * was ALSO created within the period window. That makes it unsuitable for "what's actually open
 * right now": an issue opened 60 days ago and still in progress silently disappears from a 30-day
 * view. Use this whenever you need true current WIP/blocked state, not period-scoped activity. */
export async function getOpenIssuesForProject(
  projectId: string,
  options?: { forceRefresh?: boolean; includeChangelog?: boolean; includeIssueLinks?: boolean }
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) {
    return getMockIssues(projectId).filter((issue) => !isIssueDone(issue));
  }

  const includeChangelog = options?.includeChangelog === true;
  const includeIssueLinks = options?.includeIssueLinks === true;
  const canonicalProjectId = await getCanonicalProjectId(projectId);
  const cacheKeyBase = `issues:${canonicalProjectId}:open`;
  const cacheKey = `${cacheKeyBase}${includeChangelog ? ":changelog" : ""}${includeIssueLinks ? ":links" : ""}`;

  return withCache(cacheKey, async () => {
    const baseFields =
      "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,customfield_10021,created,resolutiondate,updated";
    const fields = includeIssueLinks ? `${baseFields},issuelinks` : baseFields;

    const maxResults = 100;
    const MAX_PAGES = 50;
    const issues: JiraIssue[] = [];
    let pageToken: string | null = null;
    let pageCount = 0;
    // Scope "open" to work that's actually live: in progress, blocked (Flagged), or touched in
    // the last 30 days. The bare `resolutiondate is EMPTY` pulls in the project's entire backlog
    // (OLP alone had 27k+ such issues), forcing 50 sequential Jira pages (~30-60s) on every cache
    // expiry while the vast majority of items sit untouched in To Do.
    const jql = encodeURIComponent(
      `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND statusCategory != done AND (statusCategory = indeterminate OR Flagged is not EMPTY OR updated >= -30d) ORDER BY updated DESC`
    );
    const expandParam = includeChangelog ? "&expand=changelog" : "";

    for (;;) {
      if (++pageCount > MAX_PAGES) {
        logger.warn({ projectId, total: issues.length }, "Too many pages while fetching open issues");
        break;
      }

      const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
        `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}${expandParam}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
      );

      const pageIssues = result.issues ?? [];
      issues.push(...pageIssues);
      if (result.isLast || pageIssues.length < maxResults) break;
      pageToken = result.nextPageToken ?? null;
      if (!pageToken) break;
    }

    return Array.from(new Map(issues.map((issue) => [issue.id, issue])).values());
  }, { forceRefresh: options?.forceRefresh });
}

export async function getRecentlyResolvedIssues(
  projectId: string,
  periodDays: number
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) {
    return getMockIssues(projectId);
  }

  const canonicalProjectId = await getCanonicalProjectId(projectId);
  const effectivePeriodDays = capLookbackDays(periodDays);
  return withCache(`resolved:${canonicalProjectId}:${effectivePeriodDays}`, async () => {
    const since = new Date();
    since.setDate(since.getDate() - effectivePeriodDays);
    const sinceStr = since.toISOString().split("T")[0];

    const fields =
      "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,created,resolutiondate,updated,issuelinks";

    try {
      const allIssues: JiraIssue[] = [];
      const maxResults = 100;
      let pageToken: string | null = null;

      for (;;) {
        const jql = encodeURIComponent(
          `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND resolutiondate >= "${sinceStr}" ORDER BY resolutiondate DESC`
        );
        const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
          `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
        );
        const pageIssues = result.issues ?? [];
        allIssues.push(...pageIssues);
        if (result.isLast || pageIssues.length < maxResults) break;
        pageToken = result.nextPageToken ?? null;
        if (!pageToken) break;
      }

      return allIssues;
    } catch (err) {
      logger.warn({ err, projectId }, "Failed to fetch resolved Jira issues, using mock data");
      return getMockIssues(projectId);
    }
  });
}

export interface StatusCounts {
  total: number;
  done: number;
  inProgress: number;
  todo: number;
}

export async function getIssuesStatusCounts(
  projectId: string,
  periodDays: number,
  allowedIssueTypes?: string[]
): Promise<StatusCounts> {
  if (!isJiraConfigured()) {
    return { total: 0, done: 0, inProgress: 0, todo: 0 };
  }

  const normalizedIssueTypes = (allowedIssueTypes ?? []).map((value) => mapIssueType(value));
  normalizedIssueTypes.sort((a, b) => a.localeCompare(b));
  const issueTypeKey = normalizedIssueTypes.length > 0 ? normalizedIssueTypes.join(",") : "all";
  const effectivePeriodDays = capLookbackDays(periodDays);

  const canonicalProjectId = await getCanonicalProjectId(projectId);
  return withCache(`status:${canonicalProjectId}:${effectivePeriodDays}:${issueTypeKey}`, async () => {
    const since = new Date();
    since.setDate(since.getDate() - effectivePeriodDays);
    const sinceStr = since.toISOString().split("T")[0];

    const counts: StatusCounts = { total: 0, done: 0, inProgress: 0, todo: 0 };
    const maxResults = 100;
    const maxPages = 10;
    let pageToken: string | null = null;
    const allowedTypeSet = new Set(normalizedIssueTypes);

    try {
      for (let page = 0; page < maxPages; page++) {
        const jql = encodeURIComponent(
          `project = ${projectId} AND created >= "${sinceStr}" ORDER BY created DESC`
        );
        const result: JiraSearchResponse = await jiraFetch<JiraSearchResponse>(
          `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=status,issuetype${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
        );
        const pageIssues = result.issues ?? [];
        for (const issue of pageIssues) {
          const issueType = mapIssueType(issue.fields.issuetype?.name ?? "");
          if (allowedTypeSet.size > 0 && !allowedTypeSet.has(issueType)) {
            continue;
          }

          counts.total++;
          const key = issue.fields.status?.statusCategory?.key ?? "";
          if (key === "done") counts.done++;
          else if (key === "indeterminate") counts.inProgress++;
          else counts.todo++;
        }
        if (result.isLast || pageIssues.length < maxResults) break;
        pageToken = result.nextPageToken ?? null;
        if (!pageToken) break;
      }
    } catch (err) {
      logger.warn({ err, projectId }, "Failed to fetch status counts, returning zeros");
    }

    return counts;
  });
}

export function periodToDays(period: string): number {
  switch (period) {
    case "1m": return 30;
    case "3m": return 90;
    default: return 90;
  }
}

// --- Mock data for when Jira is not configured ---

function getMockProjects(): JiraProject[] {
  return [
    {
      id: "10001",
      key: "PLATFORM",
      name: "Platform Engineering",
      description: "Core infrastructure and platform services",
      projectTypeKey: "software",
      avatarUrls: { "48x48": "" },
      lead: { displayName: "Alice Johnson" },
      self: "",
    },
    {
      id: "10002",
      key: "MOBILE",
      name: "Mobile App",
      description: "iOS and Android applications",
      projectTypeKey: "software",
      avatarUrls: { "48x48": "" },
      lead: { displayName: "Bob Chen" },
      self: "",
    },
    {
      id: "10003",
      key: "API",
      name: "API Services",
      description: "REST and GraphQL API development",
      projectTypeKey: "software",
      avatarUrls: { "48x48": "" },
      lead: { displayName: "Carol Martinez" },
      self: "",
    },
    {
      id: "10004",
      key: "DATA",
      name: "Data Platform",
      description: "Analytics pipeline and data warehouse",
      projectTypeKey: "software",
      avatarUrls: { "48x48": "" },
      lead: { displayName: "David Kim" },
      self: "",
    },
  ];
}

function getMockIssues(projectId: string): JiraIssue[] {
  const statuses = ["To Do", "In Progress", "In Review", "Done"];
  const types = ["Story", "Bug", "Task", "Epic"];
  const priorities = ["High", "Medium", "Low"];
  const assignees = [
    { displayName: "Alice Johnson", accountId: "user-1" },
    { displayName: "Bob Chen", accountId: "user-2" },
    { displayName: "Carol Martinez", accountId: "user-3" },
    { displayName: "David Kim", accountId: "user-4" },
    { displayName: "Eve Wilson", accountId: "user-5" },
  ];

  const now = new Date();

  return Array.from({ length: 25 }, (_, i) => {
    const daysAgo = Math.floor(Math.random() * 80);
    const createdDate = new Date(now);
    createdDate.setDate(createdDate.getDate() - daysAgo);

    const status = statuses[Math.floor(Math.random() * statuses.length)]!;
    const resolvedDate =
      status === "Done"
        ? new Date(createdDate.getTime() + Math.random() * 7 * 24 * 60 * 60 * 1000)
        : undefined;

    return {
      id: `${10100 + i}`,
      key: `${getMockProjects().find((p) => p.id === projectId)?.key ?? "PROJ"}-${100 + i}`,
      fields: {
        summary: [
          "Implement user authentication flow",
          "Fix memory leak in background service",
          "Add dark mode support",
          "Optimize database queries",
          "Refactor API response handling",
          "Write unit tests for core module",
          "Set up CI/CD pipeline",
          "Update dependencies to latest versions",
          "Implement rate limiting",
          "Add error monitoring integration",
        ][i % 10]!,
        status: { name: status },
        issuetype: { name: types[i % types.length]! },
        priority: { name: priorities[i % priorities.length]! },
        assignee: assignees[i % assignees.length],
        customfield_10016: Math.random() > 0.3 ? Math.ceil(Math.random() * 8) : undefined,
        created: createdDate.toISOString(),
        resolutiondate: resolvedDate?.toISOString(),
        updated: createdDate.toISOString(),
      },
    };
  });
}
