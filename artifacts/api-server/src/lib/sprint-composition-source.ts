import {
  getSprintIssuesOrThrow,
  getEffectiveIssueType,
  getStoryPoints,
  isIssueDone,
  isNonDeliveryClosure,
  wasIssueDoneAt,
  sprintCloseTime,
  isAddedAfterPlanning,
  type JiraIssue,
  type JiraSprint,
} from "./jira";
import type { CompositionSprintInput } from "./sprint-composition";

/** One closed sprint's input for buildSprintComposition. Rejects when Jira fails (getSprintIssuesOrThrow):
 *  a sprint it could not read must not count as an empty one. Scope = the Sprints table's (allowed
 *  types, minus closed non-delivery) plus Capacity's project-key filter. */
export async function loadCompositionSprint(
  sprint: JiraSprint,
  projectKey: string,
  allowedIssueTypes: string[],
  categoryMap: Map<string, string>
): Promise<CompositionSprintInput> {
  const typed = (await getSprintIssuesOrThrow(sprint.id)).filter(
    (i: JiraIssue) => i.key.startsWith(`${projectKey}-`) && allowedIssueTypes.includes(getEffectiveIssueType(i))
  );
  const nonDelivery = await Promise.all(typed.map((i) => isNonDeliveryClosure(i)));
  const scope = typed.filter((i, idx) => !(nonDelivery[idx] && isIssueDone(i)));
  const closeTime = sprintCloseTime(sprint);
  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    issues: scope.map((i) => ({
      key: i.key,
      category: getEffectiveIssueType(i),
      storyPoints: getStoryPoints(i),
      doneAtClose: closeTime ? wasIssueDoneAt(i, closeTime, categoryMap) : isIssueDone(i),
      addedAfterPlanning: isAddedAfterPlanning(i, sprint),
    })),
  };
}
