import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Cache of Jira project RC (Release Coordination) epics, shared across all 5 células
// (Orvix Chile/OLP, Orvix Int. I, Orvix Int. II, Xtrider, Docuvex). Synced once per full
// sync cycle (not once per project) and filtered per-project at read time using
// project_release_keywords - see release-sync.ts.
export const releaseEpicsTable = pgTable("release_epics", {
  id: serial("id").primaryKey(),
  issueKey: text("issue_key").notNull().unique(),
  summary: text("summary").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  statusCategory: text("status_category").notNull(),
  assignee: text("assignee"),
  jiraUpdatedAt: timestamp("jira_updated_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReleaseEpicSchema = createInsertSchema(releaseEpicsTable).omit({
  id: true,
  syncedAt: true,
});

export type InsertReleaseEpic = z.infer<typeof insertReleaseEpicSchema>;
export type ReleaseEpic = typeof releaseEpicsTable.$inferSelect;
