import {
  getCycleTimeDays,
  getEffectiveIssueType,
  getLeadTimeDays,
  getStoryPoints,
  isAddedAfterPlanning,
  isCarryoverIssue,
  isIssueDone,
  sprintCloseTime,
  wasIssueDoneAt,
  type JiraIssue,
  type JiraSprint,
} from "../jira";
import { sprintScopeIssues } from "../../routes/sprint-metrics";
import type { SprintFacts } from "./types";

const sumSp = (issues: JiraIssue[]): number => issues.reduce((s, i) => s + getStoryPoints(i), 0);

export async function computeSprintFacts(
  sprint: JiraSprint,
  sprintIssues: JiraIssue[],
  allowedIssueTypes: string[],
  allSprints: JiraSprint[],
  categoryMap: Map<string, string>,
): Promise<SprintFacts> {
  const scope = await sprintScopeIssues(sprintIssues, allowedIssueTypes);
  const committedSp = sumSp(scope);
  const committedIssues = scope.length;
  const basis = committedSp > 0 ? "storyPoints" : "issueCount";
  const rate = (sp: number, count: number): number =>
    basis === "storyPoints" ? (sp / committedSp) * 100 : committedIssues > 0 ? (count / committedIssues) * 100 : 0;

  const rovoDone = scope.filter(isIssueDone);
  const rovoDoneSp = sumSp(rovoDone);

  const closeTime = sprintCloseTime(sprint);
  const isClosed = sprint.state === "closed" && closeTime !== null;
  const realDone = isClosed ? scope.filter((i) => wasIssueDoneAt(i, closeTime, categoryMap)) : null;
  const realDoneSp = realDone ? sumSp(realDone) : null;

  const added = scope.filter((i) => isAddedAfterPlanning(i, sprint));
  const addedSp = sumSp(added);
  const carryover = scope.filter((i) => isCarryoverIssue(i, allSprints, sprint));
  const carryoverSp = sumSp(carryover);

  const delivered = realDone ?? rovoDone;
  const deliveredByType = { historia: 0, tecnico: 0, bug: 0 };
  for (const i of delivered) {
    const t = getEffectiveIssueType(i);
    if (t === "Story") deliveredByType.historia++;
    else if (t === "Bug") deliveredByType.bug++;
    else deliveredByType.tecnico++;
  }

  const nonNull = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
  const [cycleTimes, leadTimes] = await Promise.all([
    Promise.all(delivered.map((i) => getCycleTimeDays(i))).then(nonNull),
    Promise.all(delivered.map((i) => getLeadTimeDays(i))).then(nonNull),
  ]);

  return {
    sprintId: sprint.id,
    name: sprint.name,
    state: sprint.state === "closed" ? "closed" : "active",
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    closeDate: closeTime ? closeTime.toISOString() : null,
    basis,
    committedSp,
    committedIssues,
    rovoDoneSp,
    rovoDoneIssues: rovoDone.length,
    rovoRate: rate(rovoDoneSp, rovoDone.length),
    realDoneSp,
    realDoneIssues: realDone ? realDone.length : null,
    realRate: realDone && realDoneSp !== null ? rate(realDoneSp, realDone.length) : null,
    addedSp,
    addedIssues: added.length,
    addedRate: rate(addedSp, added.length),
    carryoverSp,
    carryoverRate: rate(carryoverSp, carryover.length),
    deliveredByType,
    cycleTimes,
    leadTimes,
  };
}
