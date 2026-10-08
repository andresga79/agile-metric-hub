import { pgTable, text, serial, integer, numeric, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Availability of each person for one sprint, as entered by an admin in the Capacity section.
// Doubles as history: a closed sprint that was planned here uses these rows (instead of
// "every assignee full-time") when computing the team's delivery rate per person-day.
export const sprintCapacityTable = pgTable(
  "sprint_capacity",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    sprintId: text("sprint_id").notNull(),
    accountId: text("account_id").notNull(),
    displayName: text("display_name").notNull(),
    absenceDays: numeric("absence_days").notNull().default("0"),
    dedicationPct: integer("dedication_pct").notNull().default(100),
    included: boolean("included").notNull().default(true),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique().on(t.projectId, t.sprintId, t.accountId)]
);

export type SprintCapacityRow = typeof sprintCapacityTable.$inferSelect;
