import { Router, type IRouter } from "express";
import { db, metricTargetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getJiraProject, getProjectBoardType, getJiraSprints, getSprintIssues } from "../lib/jira";
import { getProjectSnapshots, computeSprintSnapshot } from "../lib/metric-snapshots";
import { getEffectiveThresholds, type EffectiveThreshold } from "../lib/health-thresholds";

interface EvolutionPeriod {
  label: string;
  start: string;
  isActive: boolean;
  leadTimeAvg: number | null;
  cycleTimeAvg: number | null;
  throughput: number;
  qaRejectionRate: number | null;
}

// How many recent sprints the evolution chart shows, for Scrum projects only. getJiraSprints
// returns the project's entire sprint history (100+ sprints on older projects); this keeps the
// chart to a short, consistent recent window instead of overloading a 220px card with old data.
const MAX_EVOLUTION_SPRINTS = 6;

// "Tablero Sprint 105" -> "SP105": the full board-prefixed name is too wide for an axis that
// needs to fit ~20 ticks in one chart card. Falls back to the untouched name for sprints that
// don't end in a number (custom-named sprints).
function shortSprintLabel(name: string): string {
  const match = name.match(/(\d+)\s*$/);
  return match ? `SP${match[1]}` : name;
}

async function buildSprintPeriods(projectId: string): Promise<EvolutionPeriod[]> {
  const sprints = await getJiraSprints(projectId, 50);
  // getJiraSprints sorts newest-first; take the most recent N, then flip to oldest-first for the chart.
  const ordered = [...sprints]
    .filter((s) => s.startDate)
    .sort((a, b) => new Date(b.startDate!).getTime() - new Date(a.startDate!).getTime())
    .slice(0, MAX_EVOLUTION_SPRINTS)
    .reverse();

  return Promise.all(
    ordered.map(async (sprint) => {
      const issues = await getSprintIssues(sprint.id);
      const metrics = await computeSprintSnapshot(projectId, issues);
      return {
        label: shortSprintLabel(sprint.name),
        start: sprint.startDate!,
        isActive: sprint.state === "active",
        ...metrics,
      };
    })
  );
}

function formatWeekLabel(weekStart: string): string {
  const start = new Date(weekStart);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${months[start.getMonth()]} ${start.getDate()}`;
}

const router: IRouter = Router();

function pickTarget(
  targets: { metric: string; period: string; targetValue: string }[],
  thresholds: Record<string, EffectiveThreshold>,
  metric: string
): number | null {
  const preferred = targets.find((t) => t.metric === metric && t.period === "3m");
  const fallback = targets.find((t) => t.metric === metric);
  const match = preferred ?? fallback;
  if (match) return Number(match.targetValue);

  // No project-specific target configured - fall back to the same admin-configured "good" value
  // (global default, or this project's override if one exists) the project detail page labels "Meta".
  return thresholds[metric]?.goodValue ?? null;
}

router.get(
  "/projects/:projectId/evolution",
  requireAuth,
  requireSectionView("evolution"),
  async (req, res): Promise<void> => {
    const projectId = Array.isArray(req.params.projectId)
      ? req.params.projectId[0]
      : (req.params.projectId ?? "");

    const project = await getJiraProject(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [boardType, targets, thresholds] = await Promise.all([
      getProjectBoardType(projectId),
      db.select().from(metricTargetsTable).where(eq(metricTargetsTable.projectId, projectId)),
      getEffectiveThresholds(projectId),
    ]);

    const isScrum = boardType === "scrum";
    const periods: EvolutionPeriod[] = isScrum
      ? await buildSprintPeriods(projectId)
      : (await getProjectSnapshots(projectId)).map((s) => ({
          label: formatWeekLabel(s.weekStart),
          start: s.weekStart,
          isActive: false,
          leadTimeAvg: s.leadTimeAvg !== null ? Number(s.leadTimeAvg) : null,
          cycleTimeAvg: s.cycleTimeAvg !== null ? Number(s.cycleTimeAvg) : null,
          throughput: s.throughput,
          qaRejectionRate: s.qaRejectionRate !== null ? Number(s.qaRejectionRate) : null,
        }));

    res.json({
      projectId,
      granularity: isScrum ? "sprint" : "week",
      periods,
      targets: {
        leadTime: pickTarget(targets, thresholds, "leadTime"),
        cycleTime: pickTarget(targets, thresholds, "cycleTime"),
        throughput: pickTarget(targets, thresholds, "throughput"),
      },
    });
  }
);

export default router;
