import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portfolioMetricSettingsTable = pgTable("portfolio_metric_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique().default("default"),
  allowedIssueTypes: text("allowed_issue_types").array().notNull(),
  updatedBy: integer("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPortfolioMetricSettingsSchema = createInsertSchema(portfolioMetricSettingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updatePortfolioMetricSettingsSchema = z.object({
  allowedIssueTypes: z.array(z.string().min(1)).min(1),
});

export type InsertPortfolioMetricSettings = z.infer<typeof insertPortfolioMetricSettingsSchema>;
export type PortfolioMetricSettings = typeof portfolioMetricSettingsTable.$inferSelect;