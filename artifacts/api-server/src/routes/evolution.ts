import { Router, type IRouter } from "express";
import { CreateProjectMilestoneBody } from "@workspace/api-zod";
import { getJiraProject, getProjectBoardType } from "../lib/jira";
import { requireAuth, requireAdmin, requireSectionView, type AuthRequest } from "../middleware/auth";
import { aggregateByPeriod, compareAroundMilestone, FORMULA_VERSION } from "../lib/evolution";
import {
  addMilestone,
  deleteMilestone,
  freezeBoundary,
  listMilestones,
  readEvolution,
} from "../lib/evolution-store";

const router: IRouter = Router();

export type EvolutionBy = "sprint" | "month" | "quarter";

export interface EvolutionQuery {
  /** Inclusive Santiago calendar days, "YYYY-MM-DD". */
  from: string;
  to: string;
  by: EvolutionBy;
  compare: number | null;
}

export class EvolutionQueryError extends Error {}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(s: string): boolean {
  if (!DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function one(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Validates the evolution query string; throws EvolutionQueryError naming the offending parameter. */
export function parseEvolutionQuery(query: Record<string, unknown>): EvolutionQuery {
  const from = one(query.from) ?? "2026-01-01";
  const to = one(query.to) ?? "2026-12-31";
  const by = one(query.by) ?? "sprint";
  const compareRaw = one(query.compare);

  if (by !== "sprint" && by !== "month" && by !== "quarter") {
    throw new EvolutionQueryError("by debe ser 'sprint', 'month' o 'quarter'");
  }
  if (!isRealDay(from)) throw new EvolutionQueryError("from debe ser una fecha YYYY-MM-DD válida");
  if (!isRealDay(to)) throw new EvolutionQueryError("to debe ser una fecha YYYY-MM-DD válida");
  if (from > to) throw new EvolutionQueryError("from no puede ser posterior a to");
  let compare: number | null = null;
  if (compareRaw !== undefined) {
    if (!/^\d+$/.test(compareRaw)) throw new EvolutionQueryError("compare debe ser el id numérico de un hito");
    compare = Number(compareRaw);
  }
  return { from, to, by, compare };
}

/** Instant that starts the Santiago calendar day `day` ("YYYY-MM-DD"). */
export function startOfSantiagoDay(day: string): Date {
  const prev = new Date(`${day}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return freezeBoundary(prev.toISOString().slice(0, 10));
}

export { isRealDay };

router.get(
  "/projects/:projectId/evolution",
  requireAuth,
  requireSectionView("sprints"),
  async (req, res): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      let q: EvolutionQuery;
      try {
        q = parseEvolutionQuery(req.query);
      } catch (err) {
        if (err instanceof EvolutionQueryError) {
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      const project = await getJiraProject(projectId);
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      if ((await getProjectBoardType(projectId)) !== "scrum") {
        res.status(400).json({ error: "Evolution is only available for Scrum projects" });
        return;
      }

      const milestones = await listMilestones(projectId);
      const milestone = q.compare === null ? null : (milestones.find((m) => m.id === q.compare) ?? null);
      if (q.compare !== null && !milestone) {
        res.status(404).json({ error: "Milestone not found" });
        return;
      }

      const stored = await readEvolution(projectId, startOfSantiagoDay(q.from), freezeBoundary(q.to));

      let comparison: {
        milestoneId: number;
        before: ReturnType<typeof compareAroundMilestone>["before"];
        after: ReturnType<typeof compareAroundMilestone>["after"];
      } | null = null;
      if (milestone && milestone.sprintId !== null) {
        const anchor = stored.rows.find((r) => r.sprintId === milestone.sprintId);
        if (anchor) {
          comparison = {
            milestoneId: milestone.id,
            ...compareAroundMilestone(stored.rows, stored.deliveries, anchor.startAt),
          };
        }
      }

      res.json({
        by: q.by,
        rows: q.by === "sprint" ? stored.rows : aggregateByPeriod(stored.rows, stored.deliveries, q.by),
        milestones,
        comparison,
        meta: {
          formulaVersion: FORMULA_VERSION,
          reconstructedAt: stored.reconstructedAt,
          frozenUntil: stored.frozenUntil,
        },
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

router.get(
  "/projects/:projectId/milestones",
  requireAuth,
  requireSectionView("sprints"),
  async (req, res): Promise<void> => {
    try {
      res.json(await listMilestones(String(req.params.projectId)));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

router.post(
  "/projects/:projectId/milestones",
  requireAuth,
  requireAdmin,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const parsed = CreateProjectMilestoneBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
        return;
      }
      const projectId = String(req.params.projectId);
      if (!(await getJiraProject(projectId))) {
        res.status(404).json({ error: "Project not found" });
        return;
      }
      const created = await addMilestone({
        projectId,
        sprintId: parsed.data.sprintId,
        label: parsed.data.label,
        kind: parsed.data.kind,
        note: parsed.data.note ?? null,
        createdBy: req.user?.username ?? null,
      });
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

router.delete(
  "/projects/:projectId/milestones/:milestoneId",
  requireAuth,
  requireAdmin,
  async (req, res): Promise<void> => {
    try {
      const id = Number(req.params.milestoneId);
      if (!Number.isInteger(id)) {
        res.status(404).json({ error: "Milestone not found" });
        return;
      }
      const removed = await deleteMilestone(String(req.params.projectId), id);
      if (!removed) {
        res.status(404).json({ error: "Milestone not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  },
);

export default router;
