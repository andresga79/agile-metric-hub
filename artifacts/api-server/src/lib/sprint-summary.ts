import { getEffectiveIssueType, getStoryPoints, isIssueDone, type JiraIssue, type JiraSprint } from "./jira";

// Per-sprint executive summary (Resumen tab): the Rovo-style report the team used to ask Rovo for,
// built from the same scope as the Sprints table. "Completed" is whatever `isDone` says - the
// route passes "done at sprint close" (wasIssueDoneAt) for a closed sprint, so a ticket finished
// in the next sprint is incomplete here, same as the "% real cerrado" column. The doneToday* KPIs
// are Rovo's own number (current status, isIssueDone) over the same scope and basis, so both can
// be shown side by side; for a sprint still open they equal the completed ones.

export interface SprintSummaryKpis {
  sprintId: number;
  sprintName: string;
  state: string;
  startDate: string | null;
  endDate: string | null;
  closeDate: string | null;
  committedStoryPoints: number;
  deliveredStoryPoints: number;
  // SP basis when the sprint has story points, issue count otherwise (same rule as the Sprints tab).
  completionRate: number;
  completionBasis: "storyPoints" | "issueCount";
  totalIssues: number;
  completedIssues: number;
  issueCompletionRate: number;
  incompleteIssues: number;
  incompleteStoryPoints: number;
  bugsTotal: number;
  bugsCompleted: number;
  unestimatedIssues: number;
  // "Done hoy": done by current status (isIssueDone), same scope and basis as completionRate.
  doneTodayStoryPoints: number;
  doneTodayIssues: number;
  doneTodayRate: number;
}

export interface SprintSummaryGroup {
  totalIssues: number;
  completedIssues: number;
  totalStoryPoints: number;
  completedStoryPoints: number;
  incompleteStoryPoints: number;
  // SP basis; null when the group has no story points at all (nothing to compare against).
  completionRate: number | null;
  unestimatedIssues: number;
  incompleteKeys: string[];
}

export interface SprintSummaryMember extends SprintSummaryGroup {
  accountId: string | null;
  name: string | null; // null = unassigned
}

export interface SprintSummaryType extends SprintSummaryGroup {
  type: string; // Jira's own issue type name (Historia, Tarea Técnica, Deuda Técnica, ...)
}

export interface SprintSummaryDetail {
  kpis: SprintSummaryKpis;
  members: SprintSummaryMember[];
  types: SprintSummaryType[];
}

/** No story points in any of the fields getStoryPoints reads (0 is an estimate, null isn't). */
export function isUnestimated(issue: JiraIssue): boolean {
  const f = issue.fields;
  return f.customfield_10016 == null && f.customfield_10028 == null && f.customfield_10072 == null;
}

function emptyGroup(): SprintSummaryGroup {
  return {
    totalIssues: 0, completedIssues: 0, totalStoryPoints: 0, completedStoryPoints: 0,
    incompleteStoryPoints: 0, completionRate: null, unestimatedIssues: 0, incompleteKeys: [],
  };
}

function addToGroup(g: SprintSummaryGroup, issue: JiraIssue, done: boolean): void {
  const sp = getStoryPoints(issue);
  g.totalIssues++;
  g.totalStoryPoints += sp;
  if (isUnestimated(issue)) g.unestimatedIssues++;
  if (done) {
    g.completedIssues++;
    g.completedStoryPoints += sp;
  } else {
    g.incompleteStoryPoints += sp;
    g.incompleteKeys.push(issue.key);
  }
}

function finishGroup<T extends SprintSummaryGroup>(g: T): T {
  g.completionRate = g.totalStoryPoints > 0 ? (g.completedStoryPoints / g.totalStoryPoints) * 100 : null;
  g.incompleteKeys.sort();
  return g;
}

export function buildSprintSummaryKpis(
  sprint: JiraSprint,
  scope: JiraIssue[],
  isDone: (issue: JiraIssue) => boolean
): SprintSummaryKpis {
  const done = scope.filter(isDone);
  const committed = scope.reduce((sum, i) => sum + getStoryPoints(i), 0);
  const delivered = done.reduce((sum, i) => sum + getStoryPoints(i), 0);
  const bugs = scope.filter((i) => getEffectiveIssueType(i) === "Bug");
  const basis: SprintSummaryKpis["completionBasis"] = committed > 0 ? "storyPoints" : "issueCount";
  const issueRate = scope.length > 0 ? (done.length / scope.length) * 100 : 0;
  const doneToday = scope.filter(isIssueDone);
  const doneTodaySp = doneToday.reduce((sum, i) => sum + getStoryPoints(i), 0);
  const doneTodayIssueRate = scope.length > 0 ? (doneToday.length / scope.length) * 100 : 0;
  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    state: sprint.state,
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    closeDate: sprint.completeDate ?? null,
    committedStoryPoints: committed,
    deliveredStoryPoints: delivered,
    completionRate: basis === "storyPoints" ? (delivered / committed) * 100 : issueRate,
    completionBasis: basis,
    totalIssues: scope.length,
    completedIssues: done.length,
    issueCompletionRate: issueRate,
    incompleteIssues: scope.length - done.length,
    incompleteStoryPoints: committed - delivered,
    bugsTotal: bugs.length,
    bugsCompleted: bugs.filter(isDone).length,
    unestimatedIssues: scope.filter(isUnestimated).length,
    doneTodayStoryPoints: doneTodaySp,
    doneTodayIssues: doneToday.length,
    doneTodayRate: basis === "storyPoints" ? (doneTodaySp / committed) * 100 : doneTodayIssueRate,
  };
}

export function buildSprintSummary(
  sprint: JiraSprint,
  scope: JiraIssue[],
  isDone: (issue: JiraIssue) => boolean
): SprintSummaryDetail {
  const members = new Map<string, SprintSummaryMember>();
  const types = new Map<string, SprintSummaryType>();

  for (const issue of scope) {
    const done = isDone(issue);
    // Current assignee, like Rovo's report (who held it at close would need the changelog).
    const assignee = issue.fields.assignee ?? null;
    const memberKey = assignee?.accountId ?? "__unassigned__";
    let m = members.get(memberKey);
    if (!m) {
      m = { ...emptyGroup(), accountId: assignee?.accountId ?? null, name: assignee?.displayName ?? null };
      members.set(memberKey, m);
    }
    addToGroup(m, issue, done);

    const typeName = issue.fields.issuetype?.name?.trim() || "—";
    let t = types.get(typeName);
    if (!t) {
      t = { ...emptyGroup(), type: typeName };
      types.set(typeName, t);
    }
    addToGroup(t, issue, done);
  }

  // Most story points first; unassigned always last.
  const memberList = [...members.values()].map(finishGroup).sort((a, b) => {
    if ((a.accountId === null) !== (b.accountId === null)) return a.accountId === null ? 1 : -1;
    return b.totalStoryPoints - a.totalStoryPoints || b.totalIssues - a.totalIssues;
  });
  const typeList = [...types.values()].map(finishGroup).sort(
    (a, b) => b.totalIssues - a.totalIssues || b.totalStoryPoints - a.totalStoryPoints
  );

  return { kpis: buildSprintSummaryKpis(sprint, scope, isDone), members: memberList, types: typeList };
}

/** The closed sprint that closed right before `sprint` (by close time), or null. */
export function previousClosedSprint(sprint: JiraSprint, allSprints: JiraSprint[]): JiraSprint | null {
  const closeMs = (s: JiraSprint): number => {
    const raw = s.completeDate ?? s.endDate ?? s.startDate;
    return raw ? new Date(raw).getTime() : 0;
  };
  // Not compared against an active sprint's start: the previous one is often closed minutes
  // after the next one starts (Tablero 117 closed the day 118 started).
  const ref = sprint.state === "closed" ? closeMs(sprint) : Date.now();
  const candidates = allSprints.filter((s) => s.id !== sprint.id && s.state === "closed" && closeMs(s) <= ref);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, s) => (closeMs(s) > closeMs(best) ? s : best));
}
