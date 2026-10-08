import { pgTable, text, serial, integer, date, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Dated absences of a person in one sprint (a full day, a morning or an afternoon) and why, as
// entered by an admin in Capacity. Their total is also stored in sprint_capacity.absence_days, which
// is what the history uses; the dates let the current-sprint view tell past absences from upcoming ones.
export const capacityAbsenceTable = pgTable(
  "capacity_absence",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    sprintId: text("sprint_id").notNull(),
    accountId: text("account_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    portion: text("portion").notNull(),
    type: text("type").notNull(),
    note: text("note"),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique().on(t.projectId, t.sprintId, t.accountId, t.date, t.portion)]
);

export type CapacityAbsenceRow = typeof capacityAbsenceTable.$inferSelect;
