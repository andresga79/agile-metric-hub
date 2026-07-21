import { pgTable, text, serial, timestamp, numeric, integer, date, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const metricSnapshotsTable = pgTable(
  "metric_snapshots",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull(),
    weekStart: date("week_start").notNull(),
    leadTimeAvg: numeric("lead_time_avg"),
    cycleTimeAvg: numeric("cycle_time_avg"),
    throughput: integer("throughput").notNull().default(0),
    qaRejectionRate: numeric("qa_rejection_rate"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    projectWeekUnique: unique().on(table.projectId, table.weekStart),
  })
);

export const insertMetricSnapshotSchema = createInsertSchema(metricSnapshotsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMetricSnapshot = z.infer<typeof insertMetricSnapshotSchema>;
export type MetricSnapshot = typeof metricSnapshotsTable.$inferSelect;
