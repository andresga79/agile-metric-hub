import { db, portfolioMetricSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SETTINGS_KEY = "default";
export const DEFAULT_PORTFOLIO_ISSUE_TYPES = ["Story", "Task", "Bug"] as const;

const ISSUE_TYPE_ALIASES: Record<string, string> = {
  hu: "Story",
  historia: "Story",
  "user story": "Story",
  story: "Story",
  bug: "Bug",
  problema: "Bug",
  error: "Bug",
  defect: "Bug",
  task: "Task",
  tarea: "Task",
  "tarea tecnica": "Task",
  epic: "Epic",
  epica: "Epic",
};

function normalizeIssueTypeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const alias = ISSUE_TYPE_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

function sanitizeIssueTypes(values: string[]): string[] {
  const normalized = values
    .map((value) => normalizeIssueTypeName(value))
    .filter((value) => value.length > 0);

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const value of normalized) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }
  return deduped;
}

export async function getPortfolioAllowedIssueTypes(): Promise<string[]> {
  const [settings] = await db
    .select({ allowedIssueTypes: portfolioMetricSettingsTable.allowedIssueTypes })
    .from(portfolioMetricSettingsTable)
    .where(eq(portfolioMetricSettingsTable.key, SETTINGS_KEY))
    .limit(1);

  if (settings?.allowedIssueTypes?.length) {
    return sanitizeIssueTypes(settings.allowedIssueTypes);
  }

  return [...DEFAULT_PORTFOLIO_ISSUE_TYPES];
}

export async function updatePortfolioAllowedIssueTypes(issueTypes: string[], updatedBy?: number): Promise<string[]> {
  const sanitized = sanitizeIssueTypes(issueTypes);
  if (sanitized.length === 0) {
    throw new Error("At least one issue type must be configured");
  }

  await db
    .insert(portfolioMetricSettingsTable)
    .values({
      key: SETTINGS_KEY,
      allowedIssueTypes: sanitized,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: portfolioMetricSettingsTable.key,
      set: {
        allowedIssueTypes: sanitized,
        updatedBy,
        updatedAt: new Date(),
      },
    });

  return sanitized;
}