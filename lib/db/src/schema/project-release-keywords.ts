import { pgTable, text, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-configured mapping from a dashboard project to keyword(s) that identify its
// epics inside the shared Jira RC (Release Coordination) project - RC has no
// structured link back to individual projects, so this is text matched against each
// release_epics row's summary/description at read time (see release-readiness.ts).
export const projectReleaseKeywordsTable = pgTable(
  "project_release_keywords",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    keyword: text("keyword").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.keyword)]
);

export const insertReleaseKeywordSchema = createInsertSchema(projectReleaseKeywordsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertReleaseKeyword = z.infer<typeof insertReleaseKeywordSchema>;
export type ReleaseKeyword = typeof projectReleaseKeywordsTable.$inferSelect;
