import { Check, Flag, Hourglass } from "lucide-react";
import type { ReactNode } from "react";
import { fmtDays, fmtDeltaPct, fmtNum, fmtPct, fmtPp } from "../format";
import { BandPill, DeltaText, GlassCard, SectionTitle } from "../ui";
import { ComplianceChart, CycleChart, DeliveredChart, StabilityChart } from "./scrum-charts";
import { TrendsTable, WaitingSection } from "./scrum-flow";
import { BIG, MUTED, SMALL, comparison, rateColor, sprintLabel, type ScrumView } from "./shared";

const dateFmt = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });
const closeDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)).replace(".", "") : null);

/** "Sprints 115 a 117 cerrados. Sprint 118 en curso, cierra el 13 nov." The active sprint opens the
 *  "Sprint actual" tab when `onShowActive` is given. */
export function TeamHeaderText({ v, onShowActive }: { v: ScrumView; onShowActive?: () => void }) {
  const first = v.sprints[0];
  const last = v.sprints[v.sprints.length - 1];
  const closed = last ? `Sprints ${sprintLabel(first.name).replace(/^Sprint\s+/i, "")} a ${sprintLabel(last.name).replace(/^Sprint\s+/i, "")} cerrados.` : "Sin sprints cerrados.";
  if (!v.active) return <>{closed} Sin sprint en curso.</>;
  const end = closeDate(v.active.endDate);
  const name = sprintLabel(v.active.name);
  return (
    <>
      {closed}{" "}
      {onShowActive ? (
        <button
          type="button"
          onClick={onShowActive}
          style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "var(--nxt-primary-soft)", cursor: "pointer", textDecoration: "underline" }}
        >
          {name} en curso
        </button>
      ) : (
        `${name} en curso`
      )}
      {end ? `, cierra el ${end}` : ""}.
    </>
  );
}

export function Answer({ q, big, unit, delta, note, extra }: { q: string; big: ReactNode; unit?: string; delta?: ReactNode; note: string; extra?: ReactNode }) {
  return (
    <GlassCard as="article" style={{ gap: 8, padding: 20 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>{q}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        {big}
        {unit && <span style={SMALL}>{unit}</span>}
      </div>
      {delta}
      <p style={{ fontSize: 14, color: MUTED }}>{note}</p>
      {extra}
    </GlassCard>
  );
}

export function QuickAnswers({ v }: { v: ScrumView }) {
  const h = comparison(v).recent.length;
  const { compliance: c, flow: f } = v;
  const last = v.sprints[v.sprints.length - 1];
  const waiting = [...f.timeInStatus].filter((r) => r.waiting).sort((a, b) => b.avgDays - a.avgDays)[0];
  const vsAvg = last?.realRate != null && c.avgRealRate != null ? last.realRate - c.avgRealRate : null;
  const tenth = c.avgRealRate == null ? null : Math.round(c.avgRealRate / 10);
  return (
    <section aria-label="Respuestas rápidas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      <Answer
        q="¿Cumplimos lo que comprometemos?"
        big={<span style={{ ...BIG, color: rateColor(c.avgRealRate, v.thresholds) }}>{fmtPct(c.avgRealRate)}</span>}
        unit="real cerrado"
        delta={<DeltaText value={c.deltaPp} betterWhen="up">{c.deltaPp == null ? "sin dato previo" : `${fmtPp(c.deltaPp)} en los últimos ${h} sprints`}</DeltaText>}
        note={tenth == null ? "Sin sprints cerrados todavía." : `De cada 10 SP comprometidos, se cierran ${tenth} dentro del sprint.`}
        extra={<BandPill band={c.band} min={c.minRate} max={c.maxRate} thresholds={v.thresholds} />}
      />
      <Answer
        q="¿Cuánto tarda de iniciado a entregado?"
        big={<span style={BIG}>{fmtDays(f.cycleMedian)}</span>}
        unit="mediana"
        delta={<DeltaText value={f.cycleMedianDeltaPct} betterWhen="down">{f.cycleMedianDeltaPct == null ? "sin dato previo" : `${fmtDeltaPct(f.cycleMedianDeltaPct).replace("▼ ", "−").replace("▲ ", "+")} en los últimos ${h} sprints`}</DeltaText>}
        note={f.cycleP85 == null ? "Sin datos de entrega." : `El 85% del trabajo se entrega en ${fmtDays(f.cycleP85)} o menos.`}
      />
      <Answer
        q="¿Dónde se acumula el trabajo?"
        big={<span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{waiting?.status ?? "—"}</span>}
        delta={waiting && <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>{fmtDays(waiting.avgDays)} promedio por issue</span>}
        note="Es el estado de espera donde más tiempo pasa el trabajo."
      />
      <Answer
        q="¿Cómo va el último sprint?"
        big={<span style={{ ...BIG, color: rateColor(last?.rovoRate ?? null, v.thresholds) }}>{last ? fmtPct(last.rovoRate) : "—"}</span>}
        unit={last ? `${sprintLabel(last.name)} · real cerrado ${fmtPct(last.realRate)}` : undefined}
        delta={last && vsAvg != null && <DeltaText value={vsAvg} betterWhen="up">{`${fmtNum(Math.abs(vsAvg))} pp ${vsAvg < 0 ? "bajo" : "sobre"} el promedio real`}</DeltaText>}
        note={
          last
            ? `${last.addedIssues} de ${last.committedIssues} issues entraron después de la planning.`
            : "Sin sprints cerrados todavía."
        }
      />
    </section>
  );
}

function Tip({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>{icon}{title}</span>
      <span style={{ fontSize: 14, color: MUTED, paddingLeft: 26 }}>{children}</span>
    </li>
  );
}

const IMPROVE: Record<string, string> = {
  realRate: "El cumplimiento real",
  closedSp: "Los SP cerrados por sprint",
  closedIssues: "Los issues cerrados por sprint",
  cycleMedian: "El tiempo de ciclo",
  leadMedian: "El lead time",
  addedRate: "El alcance no planificado",
  carryoverRate: "Lo arrastrado de sprints anteriores",
};

/** Capacity always comes from the last 3 closed sprints, whatever the window: "Sale de los sprints 115 a 117". */
const sprintNumber = (name: string) => sprintLabel(name).replace(/^Sprint\s+/i, "");
const basedOnText = (names: string[]) =>
  names.length === 0
    ? ""
    : `Sale de los sprints ${sprintNumber(names[0])} a ${sprintNumber(names[names.length - 1])}`;

export function PlanningSection({ v }: { v: ScrumView }) {
  const p = v.planning;
  if (!p) return null;
  const waiting = [...v.flow.timeInStatus].filter((r) => r.waiting).sort((a, b) => b.avgDays - a.avgDays)[0];
  const better = v.trends.find((t) => t.delta != null && t.delta !== 0 && (t.betterWhen === "up" ? t.delta > 0 : t.delta < 0));
  const sp = p.totalSp != null && p.plannedSp != null;
  const icon = { size: 18, "aria-hidden": true as const };
  return (
    <GlassCard aria-labelledby="t-planning">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SectionTitle id="t-planning">{`Para la planning de ${v.nextSprintName ? sprintLabel(v.nextSprintName) : "el próximo sprint"}`}</SectionTitle>
        <span style={{ fontSize: 13, color: MUTED }}>{basedOnText(p.basedOn)}</span>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <Tip icon={<Flag {...icon} />} title={sp ? `Planificar ~${fmtNum(p.plannedSp, 0)} SP (${p.plannedIssues} issues) y dejar ~${fmtNum(p.marginSp, 0)} SP de margen para lo que entra después` : `Planificar ~${p.plannedIssues} issues y dejar ~${p.marginIssues} de margen para lo que entra después`}>
          Basado en {p.basedOn.map(sprintLabel).join(", ")}: capacidad cercana a {sp ? `${fmtNum(p.totalSp, 0)} SP o ` : ""}{p.totalIssues} issues, con {fmtNum(p.unplannedPct, 0)}% entrando después de la planning.
        </Tip>
        {waiting && (
          <Tip icon={<Hourglass {...icon} />} title={`Acordar la aceptación en ${waiting.status}`}>
            {waiting.status} retiene {fmtDays(waiting.avgDays)} por issue. Una ventana fija de revisión lo acorta.
          </Tip>
        )}
        {better && (
          <Tip icon={<Check {...icon} />} title="Mantener lo que funciona">
            {IMPROVE[better.key] ?? better.key} mejoró: de {better.key === "cycleMedian" || better.key === "leadMedian" ? fmtDays(better.before) : better.key === "closedSp" || better.key === "closedIssues" ? fmtNum(better.before, 0) : fmtPct(better.before)} a {better.key === "cycleMedian" || better.key === "leadMedian" ? fmtDays(better.after) : better.key === "closedSp" || better.key === "closedIssues" ? fmtNum(better.after, 0) : fmtPct(better.after)}.
          </Tip>
        )}
      </ol>
    </GlassCard>
  );
}

export function ScrumSections({ v, jiraUrl }: { v: ScrumView; jiraUrl: string | null }) {
  return (
    <>
      <QuickAnswers v={v} />
      <PlanningSection v={v} />
      <ComplianceChart v={v} projectId={v.projectId} />
      <DeliveredChart v={v} />
      <StabilityChart v={v} />
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 20 }}>
        <CycleChart v={v} />
        <WaitingSection timeInStatus={v.flow.timeInStatus} wip={null} jiraUrl={jiraUrl} subtitle="Días promedio que pasa un issue en cada estado del flujo, en los sprints cerrados de la ventana." />
      </section>
      <TrendsTable v={v} />
    </>
  );
}
