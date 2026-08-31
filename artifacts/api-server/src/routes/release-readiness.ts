import { Router, type IRouter } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { db, releaseEpicsTable, projectReleaseKeywordsTable } from "@workspace/db";
import { eq, or, ilike, desc } from "drizzle-orm";

const router: IRouter = Router();

// Pulls the real issue keys an RC (Release Coordination) epic's description already lists
// as "what this release deploys" (see NXT-REG-RRC-style PAP docs, e.g. RC-22's "Historias de
// Usuario: OLP-3592, ..." section). This is Jira's own release documentation, not a guess -
// free-text matching against the sprint goal was tried and rejected (see this task's design
// note in the plan: "CxC" does not text-match "Custodia" issues via Jira search).
export function extractLinkedIssueKeys(description: string | null): string[] {
  if (!description) return [];
  const matches = description.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
  const unique = Array.from(new Set(matches));
  return unique.filter((key) => !key.startsWith("RC-"));
}

router.get(
  "/projects/:projectId/release-readiness",
  requireAuth,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;

    const keywords = await db
      .select({ keyword: projectReleaseKeywordsTable.keyword })
      .from(projectReleaseKeywordsTable)
      .where(eq(projectReleaseKeywordsTable.projectId, projectId));

    if (keywords.length === 0) {
      res.json({ configured: false });
      return;
    }

    const matchConditions = keywords.flatMap((k) => [
      ilike(releaseEpicsTable.summary, `%${k.keyword}%`),
      ilike(releaseEpicsTable.description, `%${k.keyword}%`),
    ]);

    const epics = await db
      .select()
      .from(releaseEpicsTable)
      .where(or(...matchConditions))
      .orderBy(desc(releaseEpicsTable.jiraUpdatedAt))
      .limit(5);

    res.json({
      configured: true,
      epics: epics.map((e) => ({
        issueKey: e.issueKey,
        summary: e.summary,
        description: e.description,
        status: e.status,
        statusCategory: e.statusCategory,
        assignee: e.assignee,
        jiraUpdatedAt: e.jiraUpdatedAt.toISOString(),
        linkedIssueKeys: extractLinkedIssueKeys(e.description),
      })),
    });
  }
);

router.get(
  "/admin/projects/:projectId/release-keywords",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const rows = await db
      .select()
      .from(projectReleaseKeywordsTable)
      .where(eq(projectReleaseKeywordsTable.projectId, projectId));
    res.json(rows);
  }
);

router.post(
  "/admin/projects/:projectId/release-keywords",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId) ? req.params.projectId[0]! : req.params.projectId!;
    const { keyword } = req.body as { keyword?: string };
    if (typeof keyword !== "string" || keyword.trim() === "" || keyword.length > 100) {
      res.status(400).json({ error: "keyword must be a non-empty string up to 100 characters" });
      return;
    }
    const saved = await db
      .insert(projectReleaseKeywordsTable)
      .values({ projectId, keyword: keyword.trim() })
      .onConflictDoNothing()
      .returning();
    res.status(201).json(saved[0] ?? null);
  }
);

router.delete(
  "/admin/projects/:projectId/release-keywords/:keywordId",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    const keywordId = Array.isArray(req.params.keywordId) ? req.params.keywordId[0]! : req.params.keywordId!;
    await db.delete(projectReleaseKeywordsTable).where(eq(projectReleaseKeywordsTable.id, Number(keywordId)));
    res.status(204).end();
  }
);

export default router;
