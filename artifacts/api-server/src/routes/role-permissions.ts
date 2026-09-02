import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { db, rolePermissionsTable } from "@workspace/db";

const router: IRouter = Router();

const VALID_ROLES = ["admin", "member", "viewer"] as const;
const SECTIONS = [
  "team", "health", "analytics", "flow", "forecast", "report",
  "qa-rejected", "qa-work", "sprints", "kanban", "targets",
] as const;

// Anyone authenticated can read permissions (frontend uses this to filter sections)
router.get("/role-permissions", requireAuth, async (_req, res): Promise<void> => {
  // Backfill any (role, section) pair missing a row — not just on a fully empty table, so a
  // newly added section (e.g. "qa-work") gets seeded on an already-provisioned DB too, without
  // touching rows an admin has already customized for existing sections.
  const defaults = VALID_ROLES.flatMap((role) =>
    SECTIONS.map((section) => ({
      role,
      section,
      canView: role === "admin" || role === "member",
      canEdit: false,
    }))
  );
  await db
    .insert(rolePermissionsTable)
    .values(defaults)
    .onConflictDoNothing({ target: [rolePermissionsTable.role, rolePermissionsTable.section] });

  const rows = await db.select().from(rolePermissionsTable).orderBy(rolePermissionsTable.role, rolePermissionsTable.section);
  res.json(rows);
});

export default router;
