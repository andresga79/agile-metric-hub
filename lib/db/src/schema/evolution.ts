import { pgTable, text, serial, timestamp, integer, doublePrecision, unique } from "drizzle-orm/pg-core";

/** One closed sprint, summarized with the rules in lib/evolution.ts (formula_version says which). */
export const evolutionSprintsTable = pgTable(
  "evolution_sprints",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    sprintId: integer("sprint_id").notNull(),
    sprintName: text("sprint_name").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    scopeIssues: integer("scope_issues").notNull(),
    scopeSp: doublePrecision("scope_sp").notNull(),
    plannedIssues: integer("planned_issues").notNull(),
    addedIssues: integer("added_issues").notNull(),
    carryoverIssues: integer("carryover_issues").notNull(),
    closedAtEndIssues: integer("closed_at_end_issues").notNull(),
    closedAtEndSp: doublePrecision("closed_at_end_sp").notNull(),
    realClosedPct: doublePrecision("real_closed_pct"),
    rovoPct: doublePrecision("rovo_pct").notNull(),
    delivered: integer("delivered").notNull(),
    deliveredSp: doublePrecision("delivered_sp").notNull(),
    people: integer("people").notNull(),
    ctN: integer("ct_n").notNull(),
    ctP50: doublePrecision("ct_p50"),
    ctP85: doublePrecision("ct_p85"),
    ctAvg: doublePrecision("ct_avg"),
    ltN: integer("lt_n").notNull(),
    ltP50: doublePrecision("lt_p50"),
    ltP85: doublePrecision("lt_p85"),
    ltAvg: doublePrecision("lt_avg"),
    formulaVersion: integer("formula_version").notNull(),
    source: text("source").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => ({
    projectSprintUnique: unique().on(table.projectId, table.sprintId),
  }),
);

/** One delivered issue; the unit behind the per-sprint and per-period time summaries. */
export const evolutionDeliveriesTable = pgTable(
  "evolution_deliveries",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    issueKey: text("issue_key").notNull(),
    issueType: text("issue_type").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
    leadDays: doublePrecision("lead_days"),
    cycleDays: doublePrecision("cycle_days"),
    storyPoints: doublePrecision("story_points").notNull().default(0),
    assigneeId: text("assignee_id"),
    sprintId: integer("sprint_id"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => ({
    projectIssueUnique: unique().on(table.projectId, table.issueKey),
  }),
);

/** Team-defined reference points ("desde el hito"); sprintId null = a date-only milestone. */
export const projectMilestonesTable = pgTable("project_milestones", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(),
  sprintId: integer("sprint_id"),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  note: text("note"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type EvolutionSprint = typeof evolutionSprintsTable.$inferSelect;
export type NewEvolutionSprint = typeof evolutionSprintsTable.$inferInsert;
export type Milestone = typeof projectMilestonesTable.$inferSelect;
export type NewMilestone = typeof projectMilestonesTable.$inferInsert;
