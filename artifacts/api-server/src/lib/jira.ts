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
    created: string;
    resolutiondate?: string;
    timespent?: number;
    updated: string;
  };
  changelog?: {
    histories: {
      created: string;
      items: { field: string; fromString?: string | null; toString?: string | null }[];
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

let allStatusesCache: { name: string; statusCategory?: { key: string } }[] | null = null;

const QA_PATTERNS = [/qa/i, /test(ing)?/i, /quality/i, /qc/i, /verification/i];

export function isQaStatus(statusName: string): boolean {
  return QA_PATTERNS.some((p) => p.test(statusName.trim()));
}

async function fetchAllStatuses(): Promise<
  { name: string; statusCategory?: { key: string } }[]
> {
  if (!isJiraConfigured()) return [];
  if (allStatusesCache) return allStatusesCache;
  try {
    const statuses = await jiraFetch<
      { name: string; statusCategory?: { key: string } }[]
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

/** Statuses in "new" or "indeterminate" categories that ARE QA-related AND
 *  NOT in the blocklist are valid "return to dev" targets. */
export async function getDevReturnStatuses(): Promise<string[]> {
  const statuses = await fetchAllStatuses();
  return deduplicateCaseInsensitive(
    statuses
      .filter((s) => {
        const cat = s.statusCategory?.key;
        if (cat !== "new" && cat !== "indeterminate") return false;
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

export async function getDevReturnStatusSet(): Promise<Set<string>> {
  const names = await getDevReturnStatuses();
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
  return /^bug$/i.test(issue.fields.issuetype.name.trim());
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
      if (!/^bug$/i.test(linked.fields.issuetype.name.trim())) continue;

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

export interface JiraSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

const JIRA_URL = process.env["JIRA_URL"] ?? "";
const JIRA_TIMEOUT_MS = 10000;
const JIRA_EMAIL = process.env["JIRA_EMAIL"] ?? "";
const JIRA_API_TOKEN = process.env["JIRA_API_TOKEN"] ?? "";

export const isJiraConfigured = () =>
  JIRA_URL.trim() !== "" &&
  JIRA_EMAIL.trim() !== "" &&
  JIRA_API_TOKEN.trim() !== "";

function jiraHeaders(): Record<string, string> {
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function jiraFetch<T>(path: string): Promise<T> {
  const url = `${JIRA_URL}/rest/api/3${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { headers: jiraHeaders(), signal: controller.signal });

    if (!response.ok) {
      const text = await response.text();
      logger.error({ status: response.status, path, body: text }, "Jira API error");
      throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function jiraAgileFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, { headers: jiraHeaders(), signal: controller.signal });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ status: response.status, url, body: text }, "Jira Agile API error");
      throw new Error(`Jira Agile API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
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
  "10003": "scrum",  // OLP - Olimpo: board is "simple" but team uses Scrum
  "OLP": "scrum",
  "10013": "kanban",  // OLI - Olimpo Internacional: board 10 is Kanban
  "OLI": "kanban",
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
  if (override) return override;

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

      // Use the first owned board's type (Jira returns boards in creation order)
      const primaryType = owned[0]!.type;
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

export async function getJiraSprints(
  projectId: string,
  maxResults: number = 50,
  options?: { forceRefresh?: boolean }
): Promise<JiraSprint[]> {
  if (!isJiraConfigured()) return [];

  return withCache(sprintsCacheKey(projectId), async () => {
    try {
      const boardId = await getBoardId(projectId);
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
      logger.warn({ err, projectId }, "Failed to fetch sprints");
      return [];
    }
  }, options);
}

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
    let startAt = 0;
    for (let page = 0; page < 5; page++) {
      const jql = encodeURIComponent(`sprint = ${sprintId} ORDER BY created DESC`);
      const result = await jiraFetch<{ issues: JiraIssue[]; total: number }>(
        `/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}&expand=changelog`
      );
      const pageIssues = result.issues ?? [];
      allIssues.push(...pageIssues);
      if (pageIssues.length < maxResults) break;
      startAt += maxResults;
    }
    return allIssues;
  } catch (err) {
    logger.warn({ err, sprintId }, "Failed to fetch sprint issues");
    return [];
  }
}

const JIRA_MAX_LOOKBACK_DAYS = 90;

function capLookbackDays(periodDays: number): number {
  return Math.min(Math.max(1, periodDays), JIRA_MAX_LOOKBACK_DAYS);
}

export async function getJiraIssuesForProject(
  projectId: string,
  periodDays: number,
  options?: { includeChangelog?: boolean; forceRefresh?: boolean }
): Promise<JiraIssue[]> {
  if (!isJiraConfigured()) {
    return getMockIssues(projectId);
  }

  const includeChangelog = options?.includeChangelog === true;
  const effectivePeriodDays = capLookbackDays(periodDays);
  const canonicalProjectId = await getCanonicalProjectId(projectId);
  const cacheKey = includeChangelog
    ? `${issuesCacheKey(canonicalProjectId, effectivePeriodDays)}:changelog`
    : issuesCacheKey(canonicalProjectId, effectivePeriodDays);

  return withCache(cacheKey, async () => {
    const since = new Date();
    since.setDate(since.getDate() - effectivePeriodDays);
    const sinceStr = since.toISOString().split("T")[0];

    const fields =
      "summary,status,issuetype,priority,assignee,customfield_10016,customfield_10028,customfield_10072,created,resolutiondate,updated";

    const maxResults = 100;
    const MAX_PAGES = 50;

    const fetchPagedIssues = async (jqlRaw: string): Promise<JiraIssue[]> => {
      const issues: JiraIssue[] = [];
      let startAt = 0;
      let pageCount = 0;
      const jql = encodeURIComponent(jqlRaw);

      for (;;) {
        if (++pageCount > MAX_PAGES) {
          logger.warn({ projectId, jql: jqlRaw, total: issues.length }, "Too many pages, stopping pagination");
          break;
        }

        const expandParam = includeChangelog ? "&expand=changelog" : "";
        const result = await jiraFetch<{ issues: JiraIssue[]; total?: number; isLast?: boolean }>(
          `/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fields}${expandParam}`
        );
        const pageIssues = result.issues ?? [];
        issues.push(...pageIssues);
        if (pageIssues.length < maxResults) break;
        startAt += maxResults;
      }

      return issues;
    };

    // Fetch resolved and unresolved streams separately so large active backlogs don't hide resolved issues.
    const [resolvedIssues, unresolvedIssues] = await Promise.all([
      fetchPagedIssues(
        `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND resolutiondate >= "${sinceStr}" ORDER BY resolutiondate DESC, updated DESC`
      ),
      fetchPagedIssues(
        `project = "${canonicalProjectId}" AND issuetype not in subtaskIssueTypes() AND created >= "${sinceStr}" AND resolutiondate is EMPTY ORDER BY updated DESC`
      ),
    ]);

    const allIssues = [...resolvedIssues, ...unresolvedIssues];
    const deduped = Array.from(new Map(allIssues.map((issue) => [issue.id, issue])).values());

    return deduped;
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
        const tokenParam = pageToken ? `&pageToken=${pageToken}` : "";
        const result = await jiraFetch<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(
          `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=${fields}${tokenParam}`
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
        const tokenParam = pageToken ? `&pageToken=${pageToken}` : "";
        const result = await jiraFetch<{ issues: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>(
          `/search/jql?jql=${jql}&maxResults=${maxResults}&fields=status,issuetype${tokenParam}`
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
