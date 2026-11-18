import { Router, type IRouter } from "express";
import { RunEvolutionBackfillBody, FreezeEvolutionBody } from "@workspace/api-zod";
import { backfillProject, type BackfillResult } from "../../lib/evolution-service";
import { freezeUntil } from "../../lib/evolution-store";
import { isRealDay, startOfSantiagoDay } from "../evolution";

const router: IRouter = Router();

export interface BackfillStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  result: BackfillResult | null;
  error: string | null;
}

type RunBackfill = (projectId: string, from: Date) => Promise<BackfillResult>;

/**
 * Backfill jobs run in the background (a full year can outlast the proxy's 300 s read timeout), one at a
 * time across all projects. Status is the last run per project, in memory: it resets on restart.
 */
export function createBackfillJobs(run: RunBackfill) {
  const statuses = new Map<string, BackfillStatus>();
  let runningProject: string | null = null;

  return {
    start(projectId: string, from: Date): { started: true } | { started: false; reason: string } {
      if (runningProject !== null) {
        return { started: false, reason: `Backfill already running for project ${runningProject}` };
      }
      runningProject = projectId;
      const status: BackfillStatus = {
        running: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        result: null,
        error: null,
      };
      statuses.set(projectId, status);
      void (async () => {
        try {
          status.result = await run(projectId, from);
        } catch (err) {
          status.error = err instanceof Error ? err.message : String(err);
        } finally {
          status.running = false;
          status.finishedAt = new Date().toISOString();
          runningProject = null;
        }
      })();
      return { started: true };
    },
    status(projectId: string): BackfillStatus {
      return (
        statuses.get(projectId) ?? { running: false, startedAt: null, finishedAt: null, result: null, error: null }
      );
    },
  };
}

const jobs = createBackfillJobs(backfillProject);

router.post("/evolution/backfill", (req, res): void => {
  const parsed = RunEvolutionBackfillBody.safeParse(req.body);
  const from = typeof req.body?.from === "string" ? req.body.from.slice(0, 10) : "";
  if (!parsed.success || !isRealDay(from)) {
    res.status(400).json({ error: "projectId y from (YYYY-MM-DD) son obligatorios" });
    return;
  }
  const result = jobs.start(parsed.data.projectId, startOfSantiagoDay(from));
  res.status(result.started ? 202 : 409).json(result);
});

router.get("/evolution/backfill/status", (req, res): void => {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!projectId) {
    res.status(400).json({ error: "projectId es obligatorio" });
    return;
  }
  res.json(jobs.status(projectId));
});

router.post("/evolution/freeze", async (req, res): Promise<void> => {
  const parsed = FreezeEvolutionBody.safeParse(req.body);
  const until = typeof req.body?.until === "string" ? req.body.until.slice(0, 10) : "";
  if (!parsed.success || !isRealDay(until)) {
    res.status(400).json({ error: "projectId y until (YYYY-MM-DD) son obligatorios" });
    return;
  }
  try {
    res.json(await freezeUntil(parsed.data.projectId, until));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
