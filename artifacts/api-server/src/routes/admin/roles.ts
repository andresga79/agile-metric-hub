import { Router, type IRouter } from "express";
import { db, rolePermissionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEFAULT_PERMISSIONS } from "./constants";

const router: IRouter = Router();

router.get("/role-permissions", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(rolePermissionsTable)
    .orderBy(rolePermissionsTable.role, rolePermissionsTable.section);

  if (rows.length === 0) {
    const inserted = await db.insert(rolePermissionsTable).values(DEFAULT_PERMISSIONS).returning();
    res.json(inserted);
    return;
  }

  res.json(rows);
});

router.put("/role-permissions", async (req, res): Promise<void> => {
  const { id, canView, canEdit } = req.body as {
    id: number;
    canView: boolean;
    canEdit: boolean;
  };

  if (!id || typeof canView !== "boolean" || typeof canEdit !== "boolean") {
    res.status(400).json({ error: "id, canView, and canEdit are required" });
    return;
  }

  const [updated] = await db
    .update(rolePermissionsTable)
    .set({ canView, canEdit })
    .where(eq(rolePermissionsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Permission not found" });
    return;
  }

  res.json(updated);
});

export default router;
