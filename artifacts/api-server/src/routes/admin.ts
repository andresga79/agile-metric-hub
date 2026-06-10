import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, rolePermissionsTable, defaultMetricThresholdsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";

const VALID_ROLES = ["admin", "member", "viewer"] as const;
const SECTIONS = ["team", "health", "analytics", "flow", "forecast", "report", "qa-rejected", "sprints", "kanban", "targets"] as const;
const DEFAULT_PERMISSIONS: { role: string; section: string; canView: boolean; canEdit: boolean }[] = [
  ...VALID_ROLES.flatMap((role) =>
    SECTIONS.map((section) => ({
      role,
      section,
      canView: role === "admin" || role === "member",
      canEdit: false,
    }))
  ),
];

const router: IRouter = Router();

// All admin routes require auth + admin role
router.use(requireAuth, requireAdmin);

// GET /admin/users - list all users
router.get("/admin/users", async (_req, res): Promise<void> => {
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(usersTable.createdAt);

  res.json(users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
  })));
});

// POST /admin/users - create a new user
router.post("/admin/users", async (req, res): Promise<void> => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password) {
    res.status(400).json({ error: "username, email, and password are required" });
    return;
  }

  const normalizedRole = VALID_ROLES.includes(role) ? role : "member";

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({
        username,
        email,
        passwordHash,
        role: normalizedRole,
      })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      });

    res.status(201).json({
      ...user,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Username or email already exists" });
      return;
    }
    throw err;
  }
});

// PUT /admin/users/:id - update a user
router.put("/admin/users/:id", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const { username, email, password, role } = req.body;

  // Cannot change own role to prevent accidental self-demotion
  const authReq = req as AuthRequest;
  if (authReq.user?.userId === userId && role && role !== authReq.user?.role) {
    res.status(400).json({ error: "Cannot change your own role" });
    return;
  }

  // Cannot change another admin's role
  if (role) {
    const [targetUser] = await db
      .select({ role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (targetUser && targetUser.role === "admin" && authReq.user?.userId !== userId) {
      res.status(403).json({ error: "Cannot change another admin's role" });
      return;
    }
  }

  const updateData: Record<string, string> = {};
  if (username) updateData.username = username;
  if (email) updateData.email = email;
  if (password) updateData.passwordHash = await bcrypt.hash(password, 10);
  if (role) updateData.role = VALID_ROLES.includes(role) ? role : "member";

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  try {
    const [updated] = await db
      .update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, userId))
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      });

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err: any) {
    if (err?.code === "23505") {
      res.status(409).json({ error: "Username or email already exists" });
      return;
    }
    throw err;
  }
});

// DELETE /admin/users/:id - delete a user
router.delete("/admin/users/:id", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const authReq = req as AuthRequest;
  if (authReq.user?.userId === userId) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  const [targetUser] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (targetUser.role === "admin") {
    res.status(403).json({ error: "Cannot delete another admin" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.json({ message: "User deleted successfully" });
});

// GET /admin/role-permissions - list all permissions
router.get("/admin/role-permissions", async (_req, res): Promise<void> => {
  const rows = await db.select().from(rolePermissionsTable).orderBy(rolePermissionsTable.role, rolePermissionsTable.section);

  // If no permissions configured, seed defaults
  if (rows.length === 0) {
    const inserted = await db.insert(rolePermissionsTable).values(DEFAULT_PERMISSIONS).returning();
    res.json(inserted);
    return;
  }

  res.json(rows);
});

// PUT /admin/role-permissions — update a single permission
router.put("/admin/role-permissions", async (req, res): Promise<void> => {
  const { id, canView, canEdit } = req.body as { id: number; canView: boolean; canEdit: boolean };

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

const DEFAULT_HEALTH_THRESHOLDS: { metric: string; goodValue: number; warningValue: number }[] = [
  { metric: "cycleTime", goodValue: 15, warningValue: 25 },
  { metric: "leadTime", goodValue: 20, warningValue: 35 },
  { metric: "throughput", goodValue: 10, warningValue: 5 },
  { metric: "wipRatio", goodValue: 30, warningValue: 50 },
  { metric: "cfr", goodValue: 10, warningValue: 25 },
  { metric: "predictability", goodValue: 70, warningValue: 40 },
  { metric: "flowEfficiency", goodValue: 40, warningValue: 20 },
  { metric: "blocked", goodValue: 0, warningValue: 3 },
];

// GET /admin/metric-thresholds — list all default health thresholds
router.get("/admin/metric-thresholds", async (_req, res): Promise<void> => {
  let rows = await db.select().from(defaultMetricThresholdsTable).orderBy(defaultMetricThresholdsTable.metric);

  if (rows.length === 0) {
    const inserted = await db
      .insert(defaultMetricThresholdsTable)
      .values(DEFAULT_HEALTH_THRESHOLDS)
      .returning();
    res.json(inserted);
    return;
  }

  res.json(rows);
});

// PUT /admin/metric-thresholds/:metric — upsert a threshold
router.put("/admin/metric-thresholds/:metric", async (req, res): Promise<void> => {
  const metric = req.params.metric;
  const { goodValue, warningValue } = req.body;

  if (goodValue === undefined || warningValue === undefined) {
    res.status(400).json({ error: "goodValue and warningValue are required" });
    return;
  }

  const gv = Number(goodValue);
  const wv = Number(warningValue);
  if (isNaN(gv) || isNaN(wv)) {
    res.status(400).json({ error: "goodValue and warningValue must be valid numbers" });
    return;
  }

  const existing = await db
    .select()
    .from(defaultMetricThresholdsTable)
    .where(eq(defaultMetricThresholdsTable.metric, metric))
    .limit(1);

  let result;
  if (existing.length > 0) {
    [result] = await db
      .update(defaultMetricThresholdsTable)
      .set({ goodValue: String(gv), warningValue: String(wv) })
      .where(eq(defaultMetricThresholdsTable.id, existing[0].id))
      .returning();
  } else {
    [result] = await db
      .insert(defaultMetricThresholdsTable)
      .values({ metric, goodValue: String(gv), warningValue: String(wv) })
      .returning();
  }

  res.json(result);
});

export default router;
