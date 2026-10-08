import { pgTable, text, serial, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Who counts for capacity in each project — only devs do (QA, PO, leads and departed accounts are
// marked counts = false once, by an admin). Applies to every sprint, history included. Also holds
// people added by hand in Capacity (manual = true, synthetic "manual:" accountId) until they show
// up in Jira under their real account.
export const capacityRosterTable = pgTable(
  "capacity_roster",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    accountId: text("account_id").notNull(),
    displayName: text("display_name").notNull(),
    counts: boolean("counts").notNull().default(true),
    manual: boolean("manual").notNull().default(false),
    updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique().on(t.projectId, t.accountId)]
);

export type CapacityRosterRow = typeof capacityRosterTable.$inferSelect;
