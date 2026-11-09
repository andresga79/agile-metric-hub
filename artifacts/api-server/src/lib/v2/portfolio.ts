import { mean } from "./stats";
import type { PortfolioRow, PortfolioView, TeamView } from "./types";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function readingFor(row: PortfolioRow): string {
  if (row.attention.length > 0) return `${cap(row.attention.join("; "))}.`;
  const { realDeltaPp: pp, deliveredDeltaPct: dd, cycleMedianDeltaPct: cd } = row;
  if (pp !== null && pp > 0) return `Mejora su cumplimiento real en ${Math.round(Math.abs(pp))} pp.`;
  if (dd !== null && dd > 0 && cd !== null && cd < 0) return "Entrega más y más rápido que el período anterior.";
  if (dd !== null && dd > 0) return `Entrega ${Math.round(Math.abs(dd))}% más que el período anterior.`;
  if (cd !== null && cd < 0) return `El tiempo de ciclo bajó ${Math.round(Math.abs(cd))}%.`;
  return "Sin cambios relevantes contra el período anterior.";
}

export function toPortfolioRow(view: TeamView): PortfolioRow {
  const common = {
    projectId: view.projectId, projectKey: view.projectKey, projectName: view.projectName,
    cycleMedian: view.flow.cycleMedian, cycleMedianDeltaPct: view.flow.cycleMedianDeltaPct,
    attention: [...view.attention], reading: "", error: null,
  };
  let row: PortfolioRow;
  if (view.boardType === "scrum") {
    const counts = view.sprints.map((s) => s.realDoneIssues as number | null).filter((n): n is number => n != null);
    const trend = view.trends.find((t) => t.key === "closedIssues");
    row = {
      ...common, boardType: "scrum",
      avgRealRate: view.compliance.avgRealRate, realDeltaPp: view.compliance.deltaPp,
      band: view.compliance.band, minRate: view.compliance.minRate, maxRate: view.compliance.maxRate,
      delivered: counts.reduce((a, b) => a + b, 0), deliveredDeltaPct: trend ? trend.delta : null,
      addedRate: mean(view.sprints.map((s) => s.addedRate).filter((n): n is number => n != null)),
      carryoverRate: mean(view.sprints.map((s) => s.carryoverRate).filter((n): n is number => n != null)),
    };
  } else {
    row = {
      ...common, boardType: "kanban",
      avgRealRate: null, realDeltaPp: null, band: null, minRate: null, maxRate: null,
      delivered: view.delivered, deliveredDeltaPct: view.deliveredDeltaPct,
      addedRate: null, carryoverRate: null,
    };
  }
  row.reading = readingFor(row);
  return row;
}

export function errorRow(
  project: { id: string; key: string; name: string; boardType: "scrum" | "kanban" },
  err: unknown,
): PortfolioRow {
  return {
    projectId: project.id, projectKey: project.key, projectName: project.name, boardType: project.boardType,
    avgRealRate: null, realDeltaPp: null, band: null, minRate: null, maxRate: null,
    cycleMedian: null, cycleMedianDeltaPct: null, delivered: null, deliveredDeltaPct: null,
    addedRate: null, carryoverRate: null, attention: [], reading: "",
    error: err instanceof Error ? err.message : String(err),
  };
}

export function buildPortfolioView(rows: PortfolioRow[], windowSprints: 3 | 6 | 12): PortfolioView {
  const scrum = rows.filter((r) => r.boardType === "scrum" && !r.error && r.avgRealRate !== null);
  const scrumRates = scrum.map((r) => ({ projectName: r.projectName, rate: r.avgRealRate as number }));
  const improving = scrum.filter((r) => r.realDeltaPp !== null && r.realDeltaPp > 0).length;
  const attention = rows
    .filter((r) => !r.error && r.attention.length > 0)
    .map((r) => ({ projectName: r.projectName, reasons: r.attention }));
  let headline =
    improving === 0 ? "Ningún equipo mejora su cumplimiento."
    : improving === 1 ? "1 equipo mejora su cumplimiento."
    : `${improving} equipos mejoran su cumplimiento.`;
  if (attention.length > 0) headline += ` ${attention[0].projectName}: ${attention[0].reasons[0]}.`;
  return {
    windowSprints, rows,
    summary: {
      scrumAvgRealRate: mean(scrumRates.map((r) => r.rate)),
      scrumRates, improving, scrumTeams: scrum.length, attention,
    },
    headline, generatedAt: new Date().toISOString(),
  };
}
