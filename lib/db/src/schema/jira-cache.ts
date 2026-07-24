import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// NOTE: the actual table is also created at runtime via raw SQL in
// artifacts/api-server/src/lib/jira-cache.ts (ensureCacheTable), because it
// predates being modeled here. This Drizzle definition must stay in sync with
// that CREATE TABLE. Its purpose is to make drizzle-kit aware of the table so a
// `drizzle-kit push` for any OTHER table no longer proposes DROPPING jira_cache
// (which would wipe the entire Jira response cache).
export const jiraCacheTable = pgTable("jira_cache", {
  cacheKey: text("cache_key").primaryKey(),
  data: jsonb("data").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JiraCacheRow = typeof jiraCacheTable.$inferSelect;
