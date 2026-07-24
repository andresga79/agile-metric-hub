import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portfolioCacheTable = pgTable("portfolio_cache", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull().unique(),
  projectKey: text("project_key").notNull(),
  projectName: text("project_name").notNull(),
  issueCount: integer("issue_count").notNull().default(0),
  doneCount: integer("done_count").notNull().default(0),
  inProgressCount: integer("in_progress_count").notNull().default(0),
  throughput: integer("throughput").notNull().default(0),
  cycleTimeP50: numeric("cycle_time_p50"),
  leadTimeAvg: numeric("lead_time_avg"),
  healthScore: integer("health_score"),
  qaRejectionRate: numeric("qa_rejection_rate"),
  throughputPrevious: integer("throughput_previous"),
  cycleTimeP50Previous: numeric("cycle_time_p50_previous"),
  leadTimeAvgPrevious: numeric("lead_time_avg_previous"),
  healthScorePrevious: integer("health_score_previous"),
  qaRejectionRatePrevious: numeric("qa_rejection_rate_previous"),
  error: text("error"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPortfolioCacheSchema = createInsertSchema(portfolioCacheTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPortfolioCache = z.infer<typeof insertPortfolioCacheSchema>;
export type PortfolioCache = typeof portfolioCacheTable.$inferSelect;
