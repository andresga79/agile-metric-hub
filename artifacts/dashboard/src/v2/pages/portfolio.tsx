import { useState, type CSSProperties, type ReactNode } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import { getGetV2PortfolioQueryKey, useGetV2Portfolio, type V2PortfolioRow } from "@workspace/api-client-react";
import { fmtDays, fmtNum, fmtPct } from "../format";
import { BandPill, DeltaText, GlassCard, SectionTitle, V2_GOOD, V2_WARN, WindowToggle, predictabilityText } from "../ui";
import { comparisonSides } from "../team/shared";

type Win = 3 | 6 | 12;
const OPTIONS: { value: Win; label: string }[] = [
  { value: 3, label: "3 sprints" },
  { value: 6, label: "6 sprints" },
  { value: 12, label: "12 sprints" },
];

const MUTED = "rgba(255,255,255,0.70)";
const CELL: CSSProperties = { padding: "14px 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", verticalAlign: "top" };
const HEAD: CSSProperties = {
  padding: "10px 12px",
  fontWeight: 500,
  borderBottom: "1px solid rgba(255,255,255,0.14)",
  textAlign: "left",
};
const STRONG: CSSProperties = { fontWeight: 600, color: "#fff" };

function StatCard({ label, value, color, children }: { label: string; value: ReactNode; color?: string; children: ReactNode }) {
  return (
    <GlassCard as="article" style={{ gap: 8, padding: 20 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: MUTED }}>{label}</span>
      <span
        style={{
          fontFamily: "'MuseoModerno', sans-serif",
          fontWeight: 600,
          fontSize: 36,
          lineHeight: "44px",
          color: color ?? "#fff",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 13, color: MUTED }}>{children}</span>
    </GlassCard>
  );
}

function Row({ r }: { r: V2PortfolioRow }) {
  const kanban = r.boardType === "kanban";
  const name = (
    <th scope="row" style={{ ...CELL, fontWeight: 500 }}>
      <Link href={`/v2/projects/${r.projectId}`} style={{ display: "flex", flexDirection: "column", gap: 2, color: "#fff" }}>
        <span style={{ fontWeight: 600 }}>{r.projectName}</span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {kanban ? "Kanban" : "Scrum"} · {r.projectKey}
        </span>
      </Link>
    </th>
  );
  if (r.error) {
    return (
      <tr>
        {name}
        <td colSpan={5} style={{ ...CELL, color: MUTED }}>
          Sin datos: {r.error}
        </td>
      </tr>
    );
  }
  return (
    <tr>
      {name}
      <td style={CELL}>
        {kanban ? (
          <span style={{ color: MUTED }}>No aplica</span>
        ) : (
          <>
            <span style={STRONG}>{fmtPct(r.avgRealRate, 0)}</span>{" "}
            <span style={{ marginLeft: 6 }}>
              <DeltaText value={r.realDeltaPp} unit="pp" betterWhen="up" />
            </span>
            <div style={{ marginTop: 4 }}>
              <BandPill band={r.band} min={r.minRate} max={r.maxRate} thresholds={r.thresholds} />
            </div>
          </>
        )}
      </td>
      <td style={CELL}>
        <span style={STRONG}>{fmtDays(r.cycleMedian)}</span>{" "}
        <span style={{ marginLeft: 6 }}>
          <DeltaText value={r.cycleMedianDeltaPct} unit="%" betterWhen="down" />
        </span>
      </td>
      <td style={CELL}>
        <span style={STRONG}>{fmtNum(r.delivered, 0)}</span>{" "}
        <span style={{ marginLeft: 6 }}>
          <DeltaText value={r.deliveredDeltaPct} unit="%" betterWhen="up" />
        </span>
      </td>
      <td style={{ ...CELL, fontSize: 13, whiteSpace: "nowrap" }}>
        {kanban ? (
          <span style={{ color: MUTED }}>No aplica</span>
        ) : (
          <>
            <span style={{ display: "block" }}>{fmtPct(r.addedRate, 0)} no planificado</span>
            <span style={{ display: "block", color: MUTED }}>{fmtPct(r.carryoverRate, 0)} arrastrado</span>
          </>
        )}
      </td>
      <td style={{ ...CELL, fontSize: 13, maxWidth: 320 }}>{r.reading}</td>
    </tr>
  );
}

export default function V2Portfolio() {
  const [win, setWin] = useState<Win>(6);
  const { data, isLoading, isError, isFetching } = useGetV2Portfolio(
    { sprints: win },
    { query: { queryKey: getGetV2PortfolioQueryKey({ sprints: win }), placeholderData: keepPreviousData } },
  );

  const toggle = <WindowToggle options={OPTIONS} value={win} onChange={setWin} label="Ventana de sprints" />;

  if (isLoading && !data) {
    return (
      <GlassCard>
        <p>Cargando…</p>
      </GlassCard>
    );
  }
  if (isError || !data) {
    return (
      <GlassCard>
        <p>No se pudo cargar el portafolio.</p>
      </GlassCard>
    );
  }

  const { rows, summary, headline } = data;
  // Same split as the backend trends: 3 -> the 3 shown vs the 3 before them; 6/12 -> halves.
  const sides = comparisonSides(data.windowSprints);
  const attention = summary.attention;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 13, color: MUTED, letterSpacing: 0.5 }}>Gerencia · {rows.length} equipos activos</span>
        <h1>Cómo están entregando los equipos</h1>
        <p style={{ fontSize: 15, color: MUTED, maxWidth: "72ch" }}>{headline}</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 6 }}>
          {toggle}
          {isFetching && (
            <span role="status" style={{ fontSize: 13, color: MUTED }}>
              Actualizando…
            </span>
          )}
          <span style={{ fontSize: 13, color: MUTED }}>Últimos {data.windowSprints} sprints · Kanban: últimos 90 días</span>
        </div>
      </section>

      <div
        aria-busy={isFetching}
        style={{ display: "flex", flexDirection: "column", gap: 28, opacity: isFetching ? 0.6 : 1, transition: "opacity 150ms" }}
      >
      <section
        aria-label="Resumen del portafolio"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}
      >
        <StatCard
          label="Cumplimiento real promedio · Scrum"
          value={summary.scrumAvgRealRate == null ? "—" : fmtPct(summary.scrumAvgRealRate, 0)}
        >
          {summary.scrumRates.length === 0
            ? "Sin equipos Scrum con datos"
            : summary.scrumRates.map((s) => `${s.projectName} ${fmtPct(s.rate, 0)}`).join(" · ")}
        </StatCard>
        <StatCard label="Equipos que mejoran" value={`${summary.improving} de ${summary.scrumTeams}`} color={V2_GOOD}>
          Scrum: últimos {sides.recent} sprints mejor que los {sides.previous} anteriores
        </StatCard>
        <StatCard label="Requiere atención" value={attention.length} color={attention.length > 0 ? V2_WARN : V2_GOOD}>
          {attention.length === 0
            ? "Ningún equipo en alerta"
            : attention.map((a) => `${a.projectName} (${a.reasons.join(", ")})`).join(" · ")}
        </StatCard>
      </section>

      <GlassCard aria-labelledby="t-equipos">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <SectionTitle id="t-equipos">Equipos</SectionTitle>
          <p style={{ fontSize: 14, color: MUTED }}>
            Cada fila lleva al detalle del equipo. Flechas: cambio contra el período anterior.
          </p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1040, borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: MUTED, fontSize: 13 }}>
                <th scope="col" style={HEAD}>Equipo</th>
                <th scope="col" style={HEAD}>¿Cumple lo comprometido?</th>
                <th scope="col" style={HEAD}>Tiempo de ciclo (mediana)</th>
                <th scope="col" style={HEAD}>Issues entregados</th>
                <th scope="col" style={HEAD}>Estabilidad del sprint</th>
                <th scope="col" style={HEAD}>Lectura</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.projectId} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <p style={{ fontSize: 12, color: MUTED }}>
        Cumplimiento = SP en Done al cierre de cada sprint sobre los comprometidos. No aplica a equipos Kanban, que se miden
        por volumen y tiempo. Predictibilidad, según la variación del cumplimiento entre sprints:{" "}
        {predictabilityText(data.thresholds)}. Estabilidad: promedio de {data.windowSprints} sprints, en SP.
      </p>
      </div>
    </div>
  );
}
