import { Router, type IRouter } from "express";
import { requireAuth } from "../middleware/auth";
import { db, rolePermissionsTable } from "@workspace/db";

const router: IRouter = Router();

// Anyone authenticated can read permissions (frontend uses this to filter sections)
router.get("/role-permissions", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(rolePermissionsTable).orderBy(rolePermissionsTable.role, rolePermissionsTable.section);

  // Seed defaults if empty
  if (rows.length === 0) {
    const VALID_ROLES = ["admin", "member", "viewer"] as const;
    const SECTIONS = ["team", "health", "analytics", "flow", "forecast", "report", "qa-rejected", "sprints", "kanban", "targets"] as const;
    const defaults = VALID_ROLES.flatMap((role) =>
      SECTIONS.map((section) => ({
        role,
        section,
        canView: role === "admin" || role === "member",
        canEdit: false,
      }))
    );
    const inserted = await db.insert(rolePermissionsTable).values(defaults).returning();
    res.json(inserted);
    return;
  }

  res.json(rows);
});

export default router;
