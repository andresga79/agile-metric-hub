import { Router, type IRouter } from "express";
import { db, metricTargetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSectionView } from "../middleware/auth";
import { getJiraProject, getProjectBoardType, getJiraSprints, getSprintIssues } from "../lib/jira";
import { getProjectSnapshots, computeSprintSnapshot } from "../lib/metric-snapshots";
import { getEffectiveThresholds, type EffectiveThreshold } from "../lib/health-thresholds";

interface EvolutionPeriod {
  label: string;
  rangeLabel: string | null;
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
        rangeLabel: null,
        start: sprint.startDate!,
        isActive: sprint.state === "active",
        ...metrics,
      };
    })
  );
}

// How many recent weeks the evolution chart shows, for Kanban projects only. Mirrors
// MAX_EVOLUTION_SPRINTS: metric_snapshots accumulates indefinitely, so this keeps the chart to a
// short, consistent recent window instead of growing unbounded as the daily sync piles up weeks.
const MAX_EVOLUTION_WEEKS = 8;

// ISO 8601 week number (1-53) for the Monday `weekStart` falls on. Short and collision-free on
// the X axis - unlike "May 25"-style date labels, which Recharts starts silently dropping once a
// chart has to fit more than ~8 of them, making the spacing look broken.
function isoWeekNumber(weekStart: string): number {
  const date = new Date(weekStart);
  date.setHours(0, 0, 0, 0);
  // Thursday of this week determines the ISO year/week per the standard.
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const firstThursday = new Date(date.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

// "Ago 10 - Ago 16": mirrors kanban-metrics.ts's formatWeekLabel so the tooltip here reads with
// the exact same phrasing as the Kanban Semanal breakdown table - the "S25" tick is compact, but
// hovering it should say the same thing that page already calls that week.
function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${months[start.getMonth()]} ${start.getDate()} - ${months[end.getMonth()]} ${end.getDate()}`;
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
      : (await getProjectSnapshots(projectId)).slice(-MAX_EVOLUTION_WEEKS).map((s) => ({
          label: `S${isoWeekNumber(s.weekStart)}`,
          rangeLabel: formatWeekRange(s.weekStart),
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
        // No global admin threshold exists for this metric (it's distinct from "cfr" - QA
        // rejections vs. bug ratio) so this only resolves when a project has set a manual
        // target for it; otherwise pickTarget's thresholds fallback correctly returns null.
        qaRejectionRate: pickTarget(targets, thresholds, "qaRejectionRate"),
      },
    });
  }
);

export default router;
