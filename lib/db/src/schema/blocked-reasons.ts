import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Manual note explaining why an issue was flagged - Jira's Flagged field is a bare
// boolean with no reason text of its own (see project-flow "Análisis de Tiempo
// Bloqueado"). One row per issueKey; a Jira comment written near the flag transition
// is tried first, this is the fallback/override when no such comment exists.
export const blockedReasonsTable = pgTable(
  "blocked_reasons",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    issueKey: text("issue_key").notNull(),
    reason: text("reason").notNull(),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique().on(t.issueKey)]
);

export const insertBlockedReasonSchema = createInsertSchema(blockedReasonsTable).omit({
  id: true,
  updatedAt: true,
});

export const updateBlockedReasonSchema = z.object({
  issueKey: z.string().min(1),
  projectId: z.string().min(1),
  reason: z.string().max(500),
});

export type InsertBlockedReason = z.infer<typeof insertBlockedReasonSchema>;
export type BlockedReason = typeof blockedReasonsTable.$inferSelect;
