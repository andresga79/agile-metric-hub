import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";

export const defaultMetricThresholdsTable = pgTable("default_metric_thresholds", {
  id: serial("id").primaryKey(),
  metric: text("metric").notNull().unique(),
  goodValue: numeric("good_value").notNull(),
  warningValue: numeric("warning_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DefaultMetricThreshold = typeof defaultMetricThresholdsTable.$inferSelect;
