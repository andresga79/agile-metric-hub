import { db, projectVisibilityTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface ProjectWithKey {
  key: string;
}

const normalizeKey = (key: string): string => key.trim().toUpperCase();

export async function getProjectVisibilityMap(): Promise<Map<string, boolean>> {
  const rows = await db.select().from(projectVisibilityTable);
  return new Map(rows.map((row) => [normalizeKey(row.projectKey), row.visible]));
}

export async function filterVisibleProjects<T extends ProjectWithKey>(
  projects: T[],
): Promise<T[]> {
  const visibility = await getProjectVisibilityMap();
  return projects.filter((project) => visibility.get(normalizeKey(project.key)) !== false);
}

export async function isProjectKeyVisible(projectKey: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(projectVisibilityTable)
    .where(eq(projectVisibilityTable.projectKey, normalizeKey(projectKey)))
    .limit(1);

  if (!row) {
    return true;
  }

  return row.visible;
}

export async function upsertProjectVisibility(
  entries: { projectKey: string; visible: boolean }[],
  updatedBy: number,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const now = new Date();
  for (const entry of entries) {
    const projectKey = normalizeKey(entry.projectKey);
    await db
      .insert(projectVisibilityTable)
      .values({
        projectKey,
        visible: entry.visible,
        updatedBy,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: projectVisibilityTable.projectKey,
        set: {
          visible: entry.visible,
          updatedBy,
          updatedAt: now,
        },
      });
  }
}
