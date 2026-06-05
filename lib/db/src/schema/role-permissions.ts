import { pgTable, serial, text, boolean, unique } from "drizzle-orm/pg-core";

export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  section: text("section").notNull(),
  canView: boolean("can_view").notNull().default(true),
  canEdit: boolean("can_edit").notNull().default(false),
}, (t) => [unique().on(t.role, t.section)]);

export type RolePermission = typeof rolePermissionsTable.$inferSelect;
export type InsertRolePermission = typeof rolePermissionsTable.$inferInsert;
