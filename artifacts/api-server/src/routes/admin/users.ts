import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { type AuthRequest } from "../../middleware/auth";
import { VALID_ROLES } from "./constants";

const router: IRouter = Router();

router.get("/users", async (_req, res): Promise<void> => {
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

  res.json(
    users.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
    }))
  );
});

router.post("/users", async (req, res): Promise<void> => {
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

router.put("/users/:id", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.id, 10);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const { username, email, password, role } = req.body;

  const authReq = req as AuthRequest;
  if (authReq.user?.userId === userId && role && role !== authReq.user?.role) {
    res.status(400).json({ error: "Cannot change your own role" });
    return;
  }

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

router.delete("/users/:id", async (req, res): Promise<void> => {
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

export default router;
