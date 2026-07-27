import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt";
import type { UserRole } from "@workspace/db";
import { db, rolePermissionsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    username: string;
    email: string;
    role: string;
  };
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden: admin role required" });
    return;
  }
  next();
}

/**
 * Server-side RBAC for read access (SEC-3). Before this, section visibility
 * (`role_permissions.can_view`) was enforced *only* in the frontend to hide
 * tabs — so any authenticated user could read a gated section's data by
 * calling its endpoint directly. This closes that hole on the server.
 *
 * Must run AFTER `requireAuth` (it reads `req.user`). Grants access if the
 * user's role has `can_view = true` for AT LEAST ONE of the given sections —
 * because some endpoints legitimately feed more than one section (e.g. the
 * Report page reuses the Health/QA data), so a user who can view any consumer
 * of that endpoint must be able to read it. `admin` always passes. A role with
 * no matching row (or all rows false) is denied with 403.
 */
export function requireSectionView(...sections: string[]) {
  return async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const role = req.user?.role;
    if (!role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (role === "admin") {
      next();
      return;
    }
    try {
      const rows = await db
        .select({ canView: rolePermissionsTable.canView })
        .from(rolePermissionsTable)
        .where(
          and(
            eq(rolePermissionsTable.role, role),
            inArray(rolePermissionsTable.section, sections)
          )
        );
      if (!rows.some((r) => r.canView)) {
        res
          .status(403)
          .json({ error: "Forbidden: insufficient permissions for this section" });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
