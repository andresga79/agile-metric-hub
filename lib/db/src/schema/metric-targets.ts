import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const metricTargetsTable = pgTable("metric_targets", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull(),
  metric: text("metric").notNull(),
  targetValue: numeric("target_value").notNull(),
  period: text("period").notNull().default("1m"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMetricTargetSchema = createInsertSchema(metricTargetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMetricTarget = z.infer<typeof insertMetricTargetSchema>;
export type MetricTarget = typeof metricTargetsTable.$inferSelect;
