import { pgTable, text, serial, timestamp, numeric, index } from "drizzle-orm/pg-core";

// projectId = null means this row is the global default for the metric.
// A non-null projectId overrides the global default for that one project.
// Uniqueness of (metric, projectId) is enforced in application code (see routes/admin/health.ts)
// rather than a DB constraint, since Postgres treats NULL as distinct in unique indexes.
export const defaultMetricThresholdsTable = pgTable("default_metric_thresholds", {
  id: serial("id").primaryKey(),
  metric: text("metric").notNull(),
  projectId: text("project_id"),
  goodValue: numeric("good_value").notNull(),
  warningValue: numeric("warning_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("default_metric_thresholds_metric_project_idx").on(table.metric, table.projectId),
]);

export type DefaultMetricThreshold = typeof defaultMetricThresholdsTable.$inferSelect;
