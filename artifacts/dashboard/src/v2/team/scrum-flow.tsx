import { AlertTriangle } from "lucide-react";
import { fmtDays, fmtNum, fmtPct, fmtPp } from "../format";
import { DeltaText, GlassCard, SectionTitle, V2_WARN } from "../ui";
import { GREY, MUTED, Scroll, Section, half, sprintLabel, type ScrumView } from "./shared";

export function WaitingSection({ v, jiraUrl }: { v: ScrumView; jiraUrl: string | null }) {
  const rows = [...v.flow.timeInStatus].sort((a, b) => b.avgDays - a.avgDays);
  const max = Math.max(0.1, ...rows.map((r) => r.avgDays));
  const { total, aged } = v.flow.wip;
  return (
    <Section id="t-acumula" title="Dónde espera el trabajo" subtitle="Días promedio que pasa un issue en cada estado del flujo.">
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r) => (
          <li key={r.status} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) 1fr 64px", gap: 12, alignItems: "center", fontSize: 14 }}>
            <span>{r.status}</span>
            <span style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${Math.round((r.avgDays / max) * 100)}%`, background: r.waiting ? V2_WARN : GREY }} />
            </span>
            <span style={{ textAlign: "right", color: MUTED }}>{fmtDays(r.avgDays)}</span>
          </li>
        ))}
        {rows.length === 0 && <li style={{ color: MUTED, fontSize: 14 }}>Sin datos de tiempo por estado.</li>}
      </ul>
      <div style={{ display: "flex", gap: 16, fontSize: 13, color: MUTED }}>
        <span><span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: V2_WARN, marginRight: 6 }} />Esperando</span>
        <span><span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: GREY, marginRight: 6 }} />Trabajando</span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 12, background: "rgba(255,179,102,0.10)", fontSize: 14 }}>
        <AlertTriangle size={18} color={V2_WARN} aria-hidden="true" style={{ flex: "0 0 auto", marginTop: 2 }} />
        <span>
          {total} issues en curso hoy.{" "}
          {aged.length === 0 ? (
            "Ninguno lleva más días de lo habitual."
          ) : (
            <>
              {aged.length} llevan más días de lo habitual:{" "}
              {aged.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  {jiraUrl ? (
                    <a href={`${jiraUrl}/browse/${a.key}`} target="_blank" rel="noopener noreferrer" style={{ color: V2_WARN, fontWeight: 600 }}>
                      {a.key}
                    </a>
                  ) : (
                    <span style={{ fontWeight: 600 }}>{a.key}</span>
                  )}
                </span>
              ))}
              .
            </>
          )}
        </span>
      </div>
    </Section>
  );
}

const LABEL: Record<string, string> = {
  realRate: "Cumplimiento real (SP al cierre)",
  closedSp: "SP cerrados por sprint",
  closedIssues: "Issues cerrados por sprint",
  cycleMedian: "Tiempo de ciclo (mediana)",
  leadMedian: "Lead time (mediana)",
  addedRate: "Alcance no planificado (SP)",
  carryoverRate: "Arrastrado de sprints anteriores (SP)",
};
const value = (key: string, n: number | null) =>
  key === "cycleMedian" || key === "leadMedian" ? fmtDays(n) : key === "closedSp" || key === "closedIssues" ? fmtNum(n, 0) : fmtPct(n);

export function TrendsTable({ v }: { v: ScrumView }) {
  const h = half(v);
  const after = v.sprints.slice(-h);
  const before = v.sprints.slice(-2 * h, -h);
  const range = (arr: typeof v.sprints) => (arr.length ? ` (${sprintLabel(arr[0].name)} a ${sprintLabel(arr[arr.length - 1].name).replace(/^Sprint\s+/i, "")})` : "");
  const cell = { padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.08)", textAlign: "left" as const };
  return (
    <GlassCard aria-labelledby="t-tend">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <SectionTitle id="t-tend">Tendencia del equipo</SectionTitle>
        <p style={{ fontSize: 14, color: MUTED }}>
          {v.sprints.length === 0 ? "Sin sprints cerrados." : `Últimos ${after.length} sprints${range(after)} contra los ${before.length} anteriores${range(before)}.`}
        </p>
      </div>
      <Scroll>
        <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: MUTED, fontSize: 13 }}>
              <th scope="col" style={cell}>Indicador</th>
              <th scope="col" style={cell}>Antes</th>
              <th scope="col" style={cell}>Ahora</th>
              <th scope="col" style={cell}>Cambio</th>
            </tr>
          </thead>
          <tbody>
            {v.trends.map((t) => (
              <tr key={t.key}>
                <th scope="row" style={{ ...cell, fontWeight: 500 }}>{LABEL[t.key] ?? t.key}</th>
                <td style={cell}>{value(t.key, t.before)}</td>
                <td style={cell}>{value(t.key, t.after)}</td>
                <td style={cell}>
                  <DeltaText value={t.delta} betterWhen={t.betterWhen}>
                    {t.delta == null ? "sin dato previo" : t.unit === "pp" ? fmtPp(t.delta) : `${t.delta > 0 ? "+" : t.delta < 0 ? "−" : ""}${fmtNum(Math.abs(t.delta), 0)}%`}
                  </DeltaText>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </GlassCard>
  );
}
