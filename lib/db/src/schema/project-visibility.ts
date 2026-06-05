import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const projectVisibilityTable = pgTable("project_visibility", {
  projectKey: text("project_key").primaryKey(),
  visible: boolean("visible").notNull().default(true),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type ProjectVisibility = typeof projectVisibilityTable.$inferSelect;
