import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { V2KanbanTeamView, V2WeekBucket } from "@workspace/api-client-react";
import { fmtDays, fmtDeltaPct, fmtNum, fmtPct } from "../format";
import { DeltaText, GlassCard, V2_BAD, V2_GOOD, V2_WARN } from "../ui";
import { TrendsCard, WaitingSection } from "./scrum-flow";
import { BIG, CHART_H, GREY, Legend, MUTED, PINK, SMALL, Scroll, Section } from "./shared";

export type KanbanView = V2KanbanTeamView;

const dateFmt = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short", timeZone: "UTC" });
/** "2026-11-02" -> "2 nov". */
const weekLabel = (iso: string) => dateFmt.format(new Date(iso)).replace(".", "");
const delta = (n: number | null) => fmtDeltaPct(n).replace("▼ ", "−").replace("▲ ", "+");
const COL = 44;

export function KanbanHeaderText({ v }: { v: KanbanView }) {
  return <>Flujo continuo, últimos {v.windowDays} días.</>;
}

function Answer({ q, big, unit, delta: d, note, extra }: { q: string; big: ReactNode; unit?: string; delta?: ReactNode; note: string; extra?: ReactNode }) {
  return (
    <GlassCard as="article" style={{ gap: 8, padding: 20 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>{q}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        {big}
        {unit && <span style={SMALL}>{unit}</span>}
      </div>
      {d}
      <p style={{ fontSize: 14, color: MUTED }}>{note}</p>
      {extra}
    </GlassCard>
  );
}

function JiraKey({ k, jiraUrl }: { k: string; jiraUrl: string | null }) {
  return jiraUrl ? (
    <a href={`${jiraUrl}/browse/${k}`} target="_blank" rel="noopener noreferrer" style={{ color: V2_WARN, fontWeight: 600 }}>
      {k}
    </a>
  ) : (
    <span style={{ fontWeight: 600 }}>{k}</span>
  );
}

export function KanbanQuickAnswers({ v, jiraUrl }: { v: KanbanView; jiraUrl: string | null }) {
  const f = v.flow;
  const waiting = [...f.timeInStatus].filter((r) => r.waiting).sort((a, b) => b.avgDays - a.avgDays)[0];
  const { total, aged } = f.wip;
  const shown = aged.slice(0, 3);
  const big = { ...BIG, fontSize: 28, lineHeight: "36px" };
  return (
    <section aria-label="Respuestas rápidas" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      <Answer
        q="¿Cuánto entregamos?"
        big={<span style={BIG}>{fmtNum(v.delivered, 0)}</span>}
        unit="issues entregados"
        delta={<DeltaText value={v.deliveredDeltaPct} betterWhen="up">{v.deliveredDeltaPct == null ? "sin dato previo" : `${delta(v.deliveredDeltaPct)} vs ${v.windowDays} días anteriores`}</DeltaText>}
        note={v.delivered === 0 ? "Sin issues entregados en el período." : `${fmtNum(v.deliveredPrevious, 0)} en los ${v.windowDays} días anteriores.`}
      />
      <Answer
        q="¿Cuánto tarda de iniciado a entregado?"
        big={<span style={BIG}>{fmtDays(f.cycleMedian)}</span>}
        unit="mediana"
        delta={<DeltaText value={f.cycleMedianDeltaPct} betterWhen="down">{f.cycleMedianDeltaPct == null ? "sin dato previo" : `${delta(f.cycleMedianDeltaPct)} vs ${v.windowDays} días anteriores`}</DeltaText>}
        note={f.cycleP85 == null ? "Sin datos de entrega." : `El 85% del trabajo se entrega en ${fmtDays(f.cycleP85)} o menos.`}
      />
      <Answer
        q="¿Dónde se acumula el trabajo?"
        big={<span style={big}>{waiting?.status ?? "—"}</span>}
        delta={waiting && <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>{fmtDays(waiting.avgDays)} promedio por issue</span>}
        note={waiting ? "Es el estado de espera donde más tiempo pasa el trabajo." : "Sin datos de tiempo por estado."}
      />
      <Answer
        q="¿Hay trabajo envejecido?"
        big={<span style={{ ...BIG, color: aged.length ? V2_WARN : undefined }}>{aged.length}</span>}
        unit={`de ${total} en curso`}
        note={aged.length === 0 ? (total === 0 ? "No hay trabajo en curso." : "Ninguno lleva más días de lo habitual.") : "Llevan más días de lo habitual en curso."}
        extra={
          shown.length > 0 && (
            <span style={{ fontSize: 14 }}>
              {shown.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <JiraKey k={a.key} jiraUrl={jiraUrl} />
                </span>
              ))}
              {aged.length > shown.length && <span style={{ color: MUTED }}> y {aged.length - shown.length} más</span>}
            </span>
          )
        }
      />
    </section>
  );
}

const sum = (w: V2WeekBucket) => w.historia + w.tecnico + w.bug;

export function KanbanDeliveredChart({ v }: { v: KanbanView }) {
  const weeks = v.byWeek;
  const max = Math.max(1, ...weeks.map(sum));
  const px = (n: number) => `${Math.round((n / max) * CHART_H)}px`;
  const total = weeks.reduce((a, w) => a + sum(w), 0);
  return (
    <Section
      id="t-entregados"
      title="Issues entregados por semana"
      subtitle={`Issues que llegaron a Done cada semana, por tipo de trabajo (últimos ${v.windowDays} días).`}
      legend={<Legend items={[{ color: V2_GOOD, label: "Historias" }, { color: PINK, label: "Técnico" }, { color: V2_BAD, label: "Bugs" }]} />}
    >
      {total === 0 ? (
        <p style={{ fontSize: 14, color: MUTED }}>Sin issues entregados en el período.</p>
      ) : (
        <Scroll>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", minWidth: "min-content" }}>
            {weeks.map((w) => (
              <div
                key={w.weekStart}
                role="img"
                aria-label={`Semana del ${weekLabel(w.weekStart)}: ${w.historia} historias, ${w.tecnico} técnicos, ${w.bug} bugs`}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: COL, flex: "0 0 auto" }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{sum(w)}</span>
                <div style={{ width: 28, height: CHART_H, display: "flex", flexDirection: "column-reverse" }}>
                  <div style={{ height: px(w.historia), background: V2_GOOD }} />
                  <div style={{ height: px(w.tecnico), background: PINK }} />
                  <div style={{ height: px(w.bug), background: V2_BAD }} />
                </div>
                <span style={{ fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{weekLabel(w.weekStart)}</span>
              </div>
            ))}
          </div>
        </Scroll>
      )}
    </Section>
  );
}

export function KanbanCycleChart({ v }: { v: KanbanView }) {
  const pts = v.byWeek.map((w, i) => ({ w, i, cycle: w.cycleAvg, lead: w.leadAvg }));
  const has = pts.some((p) => p.cycle != null || p.lead != null);
  const step = 56;
  const W = Math.max(560, 88 + (pts.length - 1) * step);
  const x = (i: number) => 44 + i * step;
  const cMax = Math.max(16, ...pts.map((p) => p.cycle ?? 0));
  const lMax = Math.max(40, ...pts.map((p) => p.lead ?? 0));
  const yC = (n: number) => Math.round(140 - (n / cMax) * 100);
  const yL = (n: number) => Math.round(140 - (n / lMax) * 100);
  const line = (key: "cycle" | "lead", y: (n: number) => number) =>
    pts.filter((p) => p[key] != null).map((p) => `${x(p.i)},${y(p[key] as number)}`).join(" ");
  const f = v.flow;
  return (
    <Section id="t-tiempos" title="Tiempo de ciclo" subtitle="Días promedio desde que se empieza hasta Done, por semana de entrega.">
      {has ? (
        <Scroll>
          <svg viewBox={`0 0 ${W} 170`} width={W} height={170} role="img" aria-label={`Tiempo de ciclo promedio por semana: ${pts.filter((p) => p.cycle != null).map((p) => `${weekLabel(p.w.weekStart)} ${fmtDays(p.cycle)}`).join(", ")}`}>
            <line x1="24" y1="140" x2={W - 20} y2="140" stroke="rgba(255,255,255,0.14)" />
            <line x1="24" y1="90" x2={W - 20} y2="90" stroke="rgba(255,255,255,0.08)" />
            <line x1="24" y1="40" x2={W - 20} y2="40" stroke="rgba(255,255,255,0.08)" />
            <polyline points={line("lead", yL)} fill="none" stroke={GREY} strokeWidth="2" strokeDasharray="5 4" />
            <polyline points={line("cycle", yC)} fill="none" stroke={PINK} strokeWidth="3" />
            {pts.map((p) => (
              <g key={p.w.weekStart}>
                {p.cycle != null && (
                  <>
                    <circle cx={x(p.i)} cy={yC(p.cycle)} r="4" fill={PINK} />
                    <text x={x(p.i)} y={yC(p.cycle) - 10} textAnchor="middle" fill="#fff" fontSize="13" fontFamily="Jost, sans-serif">
                      {fmtNum(p.cycle)} d
                    </text>
                  </>
                )}
                {p.lead != null && <circle cx={x(p.i)} cy={yL(p.lead)} r="3" fill={GREY} />}
                <text x={x(p.i)} y="164" textAnchor="middle" fill="rgba(255,255,255,0.70)" fontSize="12" fontFamily="Jost, sans-serif">
                  {weekLabel(p.w.weekStart)}
                </text>
              </g>
            ))}
          </svg>
        </Scroll>
      ) : (
        <p style={{ fontSize: 14, color: MUTED }}>Sin datos de tiempo de ciclo en el período.</p>
      )}
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

export function KanbanAttention({ v }: { v: KanbanView }) {
  if (v.attention.length === 0) return null;
  return (
    <div role="note" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 12, background: "rgba(255,179,102,0.10)", fontSize: 14 }}>
      <AlertTriangle size={18} color={V2_WARN} aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2 }} />
      <span>Atención: {v.attention.join("; ")}.</span>
    </div>
  );
}

export function KanbanTrends({ v }: { v: KanbanView }) {
  return (
    <TrendsCard
      trends={v.trends}
      subtitle={`Últimos ${v.windowDays} días contra los ${v.windowDays} días anteriores.`}
      labels={{ closedIssues: "Issues entregados" }}
    />
  );
}

export function KanbanSections({ v, jiraUrl }: { v: KanbanView; jiraUrl: string | null }) {
  return (
    <>
      <KanbanAttention v={v} />
      <KanbanQuickAnswers v={v} jiraUrl={jiraUrl} />
      <KanbanDeliveredChart v={v} />
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 20 }}>
        <KanbanCycleChart v={v} />
        <WaitingSection flow={v.flow} jiraUrl={jiraUrl} />
      </section>
      <KanbanTrends v={v} />
    </>
  );
}
