import {
  getCycleTimeDays,
  getEffectiveIssueType,
  getFutureJiraSprintsOrThrow,
  getBoardStatusNames,
  getJiraProject,
  getJiraSprintsOrThrow,
  getLeadTimeDays,
  getOpenIssuesForProject,
  getProjectBoardTypeOrThrow,
  getResolutionDate,
  getResolvedJiraIssuesInRange,
  getSprintIssuesOrThrow,
  getStatusCategoryMap,
  isIssueDone,
  isIssueInProgress,
  isJiraConfigured,
  isNonDeliveryClosure,
  listJiraProjects,
  type JiraIssue,
  type JiraSprint,
} from "../jira";
import { withCache } from "../jira-cache";
import { getEffectiveThresholds } from "../health-thresholds";
import { getPortfolioAllowedIssueTypes, KANBAN_EXCLUDED_ISSUE_TYPES } from "../portfolio-metric-settings";
import { filterVisibleProjects } from "../project-visibility";
import { computeTimeInStatus, computeWipAging } from "../flow-insights";
import { logger } from "../logger";
import { sprintScopeIssues } from "../../routes/sprint-metrics";
import { selectSprintWindow, type SprintWindowSize } from "./window";
import { computeSprintFacts } from "./sprint-facts";
import { buildScrumTeamView } from "./team-scrum";
import { buildKanbanTeamView } from "./team-kanban";
import { buildPortfolioView, errorRow, toPortfolioRow } from "./portfolio";
import type {
  DeliveredIssue,
  KanbanTeamView,
  PortfolioRow,
  PortfolioView,
  ScrumTeamView,
  SprintFacts,
  TeamView,
} from "./types";

// Wires the pure v2 builders to Jira. Everything runs one project at a time and, inside a Scrum
// project, one sprint fetch at a time: each sprint's issues come with full changelogs, and holding
// several projects' (or sprints') worth at once is what OOM-crashed the API before (CLAUDE.md,
// "Sync serializado").
//
// Jira reads use the *OrThrow helpers: the plain ones turn a failed call into [] / "simple", and a
// view built on that (a sprint read as empty -> real rate 0, no sprints -> "Sin sprint en curso",
// a Scrum team rendered as Kanban) would be cached for 6 h. Rejecting instead caches nothing and
// the portfolio shows the project as an error row.

type ProjectRef = { id: string; key: string; name: string };
type DayWindow = 30 | 90 | 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const KANBAN_EXCLUDED: Set<string> = new Set(KANBAN_EXCLUDED_ISSUE_TYPES);

export class ProjectNotFoundError extends Error {
  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = "ProjectNotFoundError";
  }
}

export function teamCacheKey(projectId: string, isScrum: boolean, sprints: SprintWindowSize, days: DayWindow): string {
  return `v2:team:${projectId}:${isScrum ? `s${sprints}` : `d${days}`}`;
}

async function resolveProject(projectId: string): Promise<ProjectRef> {
  const p = await getJiraProject(projectId);
  if (!p) throw new ProjectNotFoundError(projectId);
  return { id: p.id, key: p.key, name: p.name };
}

async function buildScrum(project: ProjectRef, windowSprints: SprintWindowSize): Promise<ScrumTeamView> {
  const [allSprints, future, allowedIssueTypes, categoryMap, thresholds] = await Promise.all([
    getJiraSprintsOrThrow(project.id, 50),
    getFutureJiraSprintsOrThrow(project.id),
    getPortfolioAllowedIssueTypes(),
    getStatusCategoryMap(),
    getEffectiveThresholds(project.id),
  ]);
  const window = selectSprintWindow(allSprints, windowSprints);
  const active = window.active;

  // display ∪ previous (window 3 compares against the 3 closed before it) ∪ active, each once.
  const toCompute = new Map<number, JiraSprint>();
  for (const s of [...window.previous, ...window.display, ...(active ? [active] : [])]) toCompute.set(s.id, s);
  const flowSprintIds = new Set([...window.display.map((s) => s.id), ...(active ? [active.id] : [])]);

  const facts = new Map<number, SprintFacts>();
  const timeInStatusIssues = new Map<string, JiraIssue>();
  let wipIssues: JiraIssue[] = [];
  for (const sprint of toCompute.values()) {
    // Sequential on purpose (memory): never Promise.all across sprints.
    const issues = await getSprintIssuesOrThrow(sprint.id);
    facts.set(sprint.id, await computeSprintFacts(sprint, issues, allowedIssueTypes, allSprints, categoryMap));
    if (flowSprintIds.has(sprint.id)) {
      const scope = await sprintScopeIssues(issues, allowedIssueTypes);
      for (const i of scope) timeInStatusIssues.set(i.key, i);
      if (sprint.id === active?.id) wipIssues = scope.filter(isIssueInProgress);
    }
  }

  const pick = (sprints: JiraSprint[]): SprintFacts[] =>
    sprints.map((s) => facts.get(s.id)).filter((f): f is SprintFacts => f !== undefined);
  const timeInStatus = await computeTimeInStatus([...timeInStatusIssues.values()], await getBoardStatusNames(project.id));
  const wipAging = await computeWipAging(wipIssues, thresholds.wipAging);

  // A sprint started since getJiraSprints was cached must not still read as "next" (capacity.ts).
  const knownIds = new Set(allSprints.map((s) => s.id));
  const nextSprint = future.find((s) => !knownIds.has(s.id)) ?? null;

  return buildScrumTeamView({
    project,
    windowSprints,
    display: pick(window.display),
    recent: pick(window.recent),
    previous: pick(window.previous),
    active: active ? (facts.get(active.id) ?? null) : null,
    nextSprintName: nextSprint?.name ?? null,
    timeInStatus,
    wipAging,
    thresholds,
  });
}

function deliveredType(issue: JiraIssue): DeliveredIssue["type"] {
  const t = getEffectiveIssueType(issue);
  return t === "Story" ? "historia" : t === "Bug" ? "bug" : "tecnico";
}

async function buildKanban(project: ProjectRef, windowDays: DayWindow, forceRefresh: boolean): Promise<KanbanTeamView> {
  const [allowedIssueTypes, thresholds] = await Promise.all([
    getPortfolioAllowedIssueTypes(),
    getEffectiveThresholds(project.id),
  ]);
  const allowed = (i: JiraIssue): boolean => {
    const t = getEffectiveIssueType(i);
    return allowedIssueTypes.includes(t) && !KANBAN_EXCLUDED.has(t);
  };

  const now = new Date();
  const currentFrom = now.getTime() - windowDays * DAY_MS;
  const previousFrom = now.getTime() - 2 * windowDays * DAY_MS;

  const resolved = (
    await getResolvedJiraIssuesInRange(project.id, 2 * windowDays, 0, { includeChangelog: true, forceRefresh })
  ).filter(allowed);
  const current: DeliveredIssue[] = [];
  const previous: DeliveredIssue[] = [];
  const currentIssues: JiraIssue[] = [];
  for (const issue of resolved) {
    if (!isIssueDone(issue) || (await isNonDeliveryClosure(issue))) continue;
    const resolvedAt = await getResolutionDate(issue);
    if (!resolvedAt) continue;
    const t = resolvedAt.getTime();
    if (t < previousFrom || t >= now.getTime()) continue;
    const delivered: DeliveredIssue = {
      key: issue.key,
      resolvedAt: resolvedAt.toISOString(),
      type: deliveredType(issue),
      cycleDays: await getCycleTimeDays(issue),
      leadDays: await getLeadTimeDays(issue),
    };
    if (t >= currentFrom) {
      current.push(delivered);
      currentIssues.push(issue);
    } else {
      previous.push(delivered);
    }
  }

  const open = (await getOpenIssuesForProject(project.id, { includeChangelog: true, forceRefresh })).filter(allowed);
  const timeInStatusIssues = new Map<string, JiraIssue>();
  for (const i of [...currentIssues, ...open]) timeInStatusIssues.set(i.key, i);
  const timeInStatus = await computeTimeInStatus([...timeInStatusIssues.values()], await getBoardStatusNames(project.id));
  const wipAging = await computeWipAging(open.filter(isIssueInProgress), thresholds.wipAging);

  return buildKanbanTeamView({ project, windowDays, current, previous, timeInStatus, wipAging, thresholds, now });
}

export interface TeamViewOptions {
  sprints?: SprintWindowSize;
  days?: DayWindow;
  forceRefresh?: boolean;
  /** Already-resolved project (portfolio, warm), so a cache miss doesn't look it up again. */
  project?: ProjectRef;
}

/** The team view for `projectId`: Scrum (by sprints, default 6) or Kanban/simple (by days,
 *  default 90), cached under `v2:team:<projectId>:<s6|d90…>`. Throws ProjectNotFoundError. */
export async function getTeamView(projectId: string, opts: TeamViewOptions = {}): Promise<TeamView> {
  const sprints = opts.sprints ?? 6;
  const days = opts.days ?? 90;
  const forceRefresh = opts.forceRefresh === true;
  // Outside the cache on purpose: a failed detection rejects here, before anything is cached.
  const isScrum = (await getProjectBoardTypeOrThrow(projectId)) === "scrum";
  return withCache<TeamView>(
    teamCacheKey(projectId, isScrum, sprints, days),
    async () => {
      const project = opts.project ?? (await resolveProject(projectId));
      return isScrum ? buildScrum(project, sprints) : buildKanban(project, days, forceRefresh);
    },
    { forceRefresh },
  );
}

/** Portfolio over the visible projects, one project at a time. Kanban rows always use 90 days. */
export async function getPortfolioView(windowSprints: SprintWindowSize): Promise<PortfolioView> {
  const projects = await filterVisibleProjects(await listJiraProjects());
  const rows: PortfolioRow[] = [];
  for (const p of projects) {
    const ref: ProjectRef = { id: p.id, key: p.key, name: p.name };
    let boardType: "scrum" | "kanban";
    try {
      boardType = (await getProjectBoardTypeOrThrow(p.id)) === "scrum" ? "scrum" : "kanban";
    } catch (err) {
      logger.warn({ err, projectId: p.id }, "v2 portfolio: board type detection failed");
      rows.push(errorRow({ ...ref, boardType: "scrum" }, err));
      continue;
    }
    try {
      const view = await getTeamView(
        p.id,
        boardType === "scrum" ? { sprints: windowSprints, project: ref } : { days: 90, project: ref },
      );
      rows.push(toPortfolioRow(view));
    } catch (err) {
      logger.warn({ err, projectId: p.id }, "v2 portfolio: team view failed");
      rows.push(errorRow({ ...ref, boardType }, err));
    }
  }
  return buildPortfolioView(rows, windowSprints);
}

/** Pre-builds the default team views (Scrum 6 sprints, Kanban 90 days) after a sync, serially.
 *  Never throws: a failing project is logged and skipped. */
export async function warmV2Cache(forceRefresh: boolean): Promise<void> {
  if (!isJiraConfigured()) return;
  try {
    const projects = await filterVisibleProjects(await listJiraProjects());
    let failed = 0;
    for (const p of projects) {
      try {
        await getTeamView(p.id, { forceRefresh, project: { id: p.id, key: p.key, name: p.name } });
      } catch (err) {
        failed += 1;
        logger.warn({ err, projectId: p.id }, "v2 warm: team view failed");
      }
    }
    logger.info({ projects: projects.length, failed, forceRefresh }, "v2 team views warmed");
  } catch (err) {
    logger.error({ err }, "v2 warm failed");
  }
}
