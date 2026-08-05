import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin, type AuthRequest } from "../middleware/auth";
import { db, blockedReasonsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// Manual override/fallback for the "flag reason" column in Blocked Time Analysis -
// used when no Jira comment was found near the flag transition. See analytics.ts.
router.put(
  "/projects/:projectId/blocked-reasons/:issueKey",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const authReq = req as AuthRequest;
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : (req.params.projectId ?? "");
    const issueKey = Array.isArray(req.params.issueKey) ? req.params.issueKey[0] : (req.params.issueKey ?? "");
    const { reason } = req.body as { reason?: string };

    if (!issueKey || !projectId) {
      res.status(400).json({ error: "projectId and issueKey are required" });
      return;
    }
    if (typeof reason !== "string" || reason.length > 500) {
      res.status(400).json({ error: "reason must be a string up to 500 characters" });
      return;
    }

    const trimmed = reason.trim();
    if (trimmed === "") {
      await db.delete(blockedReasonsTable).where(eq(blockedReasonsTable.issueKey, issueKey));
      res.status(204).end();
      return;
    }

    const existing = await db
      .select()
      .from(blockedReasonsTable)
      .where(eq(blockedReasonsTable.issueKey, issueKey));

    const saved =
      existing.length > 0
        ? await db
            .update(blockedReasonsTable)
            .set({ reason: trimmed, projectId, updatedBy: authReq.user!.userId })
            .where(eq(blockedReasonsTable.issueKey, issueKey))
            .returning()
        : await db
            .insert(blockedReasonsTable)
            .values({ projectId, issueKey, reason: trimmed, updatedBy: authReq.user!.userId })
            .returning();

    res.json(saved[0]);
  }
);

export default router;
