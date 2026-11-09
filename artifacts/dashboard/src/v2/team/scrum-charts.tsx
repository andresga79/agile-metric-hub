import { Link } from "wouter";
import type { V2SprintFacts, V2TrendRow } from "@workspace/api-client-react";
import { fmtDays, fmtNum, fmtPct, fmtPp, fmtDeltaPct } from "../format";
import { DeltaText, V2_BAD, V2_GOOD, V2_WARN } from "../ui";
import {
  CHART_H, COL_W, GREY, Legend, MINI_GRID, MUTED, MiniCard, PINK, BIG, Scroll, Section, SMALL,
  half, mean, rateColor, shortName, sprintLabel, type ScrumView,
} from "./shared";

const trend = (v: ScrumView, key: string): V2TrendRow | undefined => v.trends.find((t) => t.key === key);
const col = { display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 6, width: COL_W, flex: "0 0 auto" };
const unitLabel = (s: V2SprintFacts) => (s.basis === "issueCount" ? "issues" : "SP");

export function ComplianceChart({ v, projectId }: { v: ScrumView; projectId: string }) {
  const rows = v.sprints.map((s) => ({
    s,
    committed: s.basis === "issueCount" ? s.committedIssues : s.committedSp,
    real: s.basis === "issueCount" ? s.realDoneIssues : s.realDoneSp,
  }));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.committed, r.real ?? 0)));
  const px = (n: number) => `${Math.round((n / max) * CHART_H)}px`;
  return (
    <Section
      id="t-cumple"
      title="Cumplimiento por sprint"
      subtitle="SP comprometidos contra SP que ya estaban en Done al cerrar el sprint."
      legend={<Legend items={[{ color: "rgba(255,255,255,0.28)", label: "Comprometido" }, { color: V2_WARN, label: "Cerrado al cierre" }]} />}
    >
      <Scroll>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", minWidth: "min-content" }}>
          {rows.map(({ s, committed, real }) => (
            <Link
              key={s.sprintId}
              href={`/v2/projects/${projectId}/sprints/${s.sprintId}`}
              aria-label={`Ver ${sprintLabel(s.name)}`}
              style={{ ...col, color: "#fff", textDecoration: "none" }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: rateColor(s.realRate) }}>{fmtPct(s.realRate)}</span>
              <span style={{ fontSize: 12, color: MUTED }}>Rovo {fmtPct(s.rovoRate, 0)}</span>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: CHART_H }}>
                <div style={{ width: 22, height: px(committed), background: "rgba(255,255,255,0.28)", borderRadius: "4px 4px 0 0" }} />
                <div style={{ width: 22, height: px(real ?? 0), background: rateColor(s.realRate), borderRadius: "4px 4px 0 0" }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{shortName(s)}</span>
              <span style={{ fontSize: 12, color: MUTED, textAlign: "center" }}>
                {real == null ? "—" : fmtNum(real, 0)} de {fmtNum(committed, 0)} {unitLabel(s)}
              </span>
            </Link>
          ))}
        </div>
      </Scroll>
    </Section>
  );
}

export function DeliveredChart({ v }: { v: ScrumView }) {
  const h = half(v);
  const rows = v.sprints.map((s) => {
    const t = s.deliveredByType;
    return { s, t, done: t.historia + t.tecnico + t.bug };
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(r.s.committedIssues, r.done)));
  const px = (n: number) => `${Math.round((n / max) * CHART_H)}px`;
  const total = rows.reduce((a, r) => a + r.done, 0);
  const hist = rows.reduce((a, r) => a + r.t.historia, 0);
  const bugs = rows.reduce((a, r) => a + r.t.bug, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : null);
  const closed = trend(v, "closedIssues");
  const avgPlanned = mean(v.sprints.slice(-h).map((s) => s.committedIssues));
  return (
    <Section
      id="t-issues"
      title="Issues entregados por sprint"
      subtitle="Issues en Done al cerrar cada sprint, por tipo de trabajo."
      legend={
        <Legend
          items={[
            { color: V2_GOOD, label: "Historias" },
            { color: PINK, label: "Técnico" },
            { color: V2_BAD, label: "Bugs" },
            { color: "rgba(255,255,255,0.5)", label: "Alcance del sprint", outline: true },
          ]}
        />
      }
    >
      <div style={MINI_GRID}>
        <MiniCard label={`Entregados por sprint · últimos ${h}`} note={avgPlanned == null ? "" : `De ${fmtNum(avgPlanned, 0)} en el alcance en promedio.`}>
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{fmtNum(closed?.after ?? null, 0)}</span>
          <DeltaText value={closed?.delta} betterWhen="up">{`${fmtDeltaPct(closed?.delta)}${closed?.delta == null ? "" : ` vs ${h} anteriores`}`}</DeltaText>
        </MiniCard>
        <MiniCard label={`Historias de usuario · ${v.windowSprints} sprints`} note="Parte del trabajo entregado que es funcionalidad nueva.">
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{fmtPct(pct(hist), 0)}</span>
          <span style={SMALL}>{hist} de {total}</span>
        </MiniCard>
        <MiniCard label={`Bugs · ${v.windowSprints} sprints`} note="Parte del trabajo entregado que es corrección.">
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{fmtPct(pct(bugs), 0)}</span>
          <span style={SMALL}>{bugs} de {total}</span>
        </MiniCard>
      </div>
      <Scroll>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", minWidth: "min-content" }}>
          {rows.map(({ s, t, done }) => (
            <div key={s.sprintId} style={col}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{done} de {s.committedIssues}</span>
              <div style={{ position: "relative", width: 48, height: CHART_H, display: "flex", alignItems: "flex-end" }}>
                <div
                  aria-hidden="true"
                  style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: px(s.committedIssues), border: "1px solid rgba(255,255,255,0.4)", borderRadius: 4 }}
                />
                <div style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column-reverse" }}>
                  <div style={{ height: px(t.historia), background: V2_GOOD }} />
                  <div style={{ height: px(t.tecnico), background: PINK }} />
                  <div style={{ height: px(t.bug), background: V2_BAD }} />
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{shortName(s)}</span>
              <span style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{t.historia} H · {t.tecnico} T · {t.bug} B</span>
            </div>
          ))}
        </div>
      </Scroll>
    </Section>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: MUTED }}>
        <span>{label}</span>
        <span style={{ color: "#fff" }}>{fmtPct(value, 0)}</span>
      </span>
      <span style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
      </span>
    </div>
  );
}

export function StabilityChart({ v }: { v: ScrumView }) {
  const h = half(v);
  const added = trend(v, "addedRate");
  const carry = trend(v, "carryoverRate");
  return (
    <Section
      id="t-estab"
      title="Estabilidad del sprint"
      subtitle="Qué parte de cada sprint no estaba en la planning o venía arrastrada de sprints anteriores, en SP."
      legend={<Legend items={[{ color: V2_WARN, label: "Entró después de la planning" }, { color: GREY, label: "Arrastrado" }]} />}
    >
      <div style={MINI_GRID}>
        <MiniCard label={`No planificado · últimos ${h} sprints`} note="Parte del sprint que llegó con el sprint ya andando.">
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{fmtPct(added?.after ?? null, 0)}</span>
          <DeltaText value={added?.delta} betterWhen="down">{`${fmtPp(added?.delta)}${added?.delta == null ? "" : ` vs ${h} anteriores`}`}</DeltaText>
        </MiniCard>
        <MiniCard label={`Arrastrado · últimos ${h} sprints`} note="Parte del sprint que es trabajo que no se terminó antes.">
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{fmtPct(carry?.after ?? null, 0)}</span>
          <DeltaText value={carry?.delta} betterWhen="down">{`${fmtPp(carry?.delta)}${carry?.delta == null ? "" : ` vs ${h} anteriores`}`}</DeltaText>
        </MiniCard>
      </div>
      <Scroll>
        <div style={{ display: "flex", gap: 16, minWidth: "min-content" }}>
          {v.sprints.map((s) => (
            <div key={s.sprintId} style={{ display: "flex", flexDirection: "column", gap: 8, width: 120, flex: "0 0 auto" }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{shortName(s)}</span>
              <Meter label="No planificado" value={s.addedRate} color={V2_WARN} />
              <Meter label="Arrastrado" value={s.carryoverRate} color={GREY} />
            </div>
          ))}
        </div>
      </Scroll>
    </Section>
  );
}

export function CycleChart({ v }: { v: ScrumView }) {
  const pts = v.sprints.map((s, i) => ({ s, i, cycle: mean(s.cycleTimes), lead: mean(s.leadTimes) }));
  const W = Math.max(560, 88 + (pts.length - 1) * 94);
  const x = (i: number) => 44 + i * 94;
  const cMax = Math.max(16, ...pts.map((p) => p.cycle ?? 0));
  const lMax = Math.max(40, ...pts.map((p) => p.lead ?? 0));
  const yC = (n: number) => Math.round(140 - (n / cMax) * 100);
  const yL = (n: number) => Math.round(140 - (n / lMax) * 100);
  const line = (key: "cycle" | "lead", y: (n: number) => number) =>
    pts.filter((p) => p[key] != null).map((p) => `${x(p.i)},${y(p[key] as number)}`).join(" ");
  const f = v.flow;
  return (
    <Section id="t-tiempos" title="Tiempo de ciclo" subtitle="Días promedio desde que se empieza hasta Done, por sprint.">
      <Scroll>
        <svg viewBox={`0 0 ${W} 170`} width={W} height={170} role="img" aria-label={`Tiempo de ciclo promedio por sprint: ${pts.map((p) => `${shortName(p.s)} ${fmtDays(p.cycle)}`).join(", ")}`}>
          <line x1="24" y1="140" x2={W - 20} y2="140" stroke="rgba(255,255,255,0.14)" />
          <line x1="24" y1="90" x2={W - 20} y2="90" stroke="rgba(255,255,255,0.08)" />
          <line x1="24" y1="40" x2={W - 20} y2="40" stroke="rgba(255,255,255,0.08)" />
          <polyline points={line("lead", yL)} fill="none" stroke={GREY} strokeWidth="2" strokeDasharray="5 4" />
          <polyline points={line("cycle", yC)} fill="none" stroke={PINK} strokeWidth="3" />
          {pts.map((p) => (
            <g key={p.s.sprintId}>
              {p.cycle != null && (
                <>
                  <circle cx={x(p.i)} cy={yC(p.cycle)} r="4" fill={PINK} />
                  <text x={x(p.i)} y={yC(p.cycle) - 10} textAnchor="middle" fill="#fff" fontSize="13" fontFamily="Jost, sans-serif">
                    {fmtNum(p.cycle)} d
                  </text>
                </>
              )}
              <text x={x(p.i)} y="164" textAnchor="middle" fill="rgba(255,255,255,0.70)" fontSize="12" fontFamily="Jost, sans-serif">
                {shortName(p.s)}
              </text>
            </g>
          ))}
        </svg>
      </Scroll>
      <Legend items={[{ color: PINK, label: "Tiempo de ciclo (de iniciado a Done)" }, { color: GREY, label: "Lead time (de creado a Done)" }]} />
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: 0 }}>
        {[
          ["Mitad del trabajo", f.cycleMedian == null ? "—" : `≤ ${fmtDays(f.cycleMedian)}`],
          ["85% del trabajo", f.cycleP85 == null ? "—" : `≤ ${fmtDays(f.cycleP85)}`],
          ["Tiempo trabajando", fmtPct(f.flowEfficiencyPct, 0)],
        ].map(([k, val]) => (
          <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <dt style={SMALL}>{k}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{val}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

