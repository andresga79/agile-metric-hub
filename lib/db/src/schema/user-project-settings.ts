import { pgTable, text, serial, integer, boolean, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userProjectSettingsTable = pgTable(
  "user_project_settings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    visible: boolean("visible").notNull().default(true),
  },
  (t) => [unique().on(t.userId, t.projectId)]
);

export const insertUserProjectSettingsSchema = createInsertSchema(
  userProjectSettingsTable
).omit({ id: true });

export const updateUserProjectSettingsSchema = z.object({
  projectId: z.string(),
  visible: z.boolean(),
});

export type InsertUserProjectSettings = z.infer<
  typeof insertUserProjectSettingsSchema
>;
export type UserProjectSettings = typeof userProjectSettingsTable.$inferSelect;
