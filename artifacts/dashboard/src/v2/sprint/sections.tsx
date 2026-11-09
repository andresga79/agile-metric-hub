import type { ReactNode } from "react";
import type { SprintSummaryKpis, SprintSummaryResponse } from "@workspace/api-client-react";
import { DeltaText, V2_GOOD, V2_WARN } from "../ui";
import { fmtNum, fmtPct } from "../format";
import { BIG, GREY, MiniCard, MINI_GRID, MUTED, SMALL, Scroll, Section, rateColor } from "../team/shared";

const sp = (n: number) => fmtNum(n, 0);
const dateOnly = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const TH = { textAlign: "right", padding: "8px 10px", fontSize: 13, fontWeight: 500, color: MUTED, whiteSpace: "nowrap" } as const;
const TD = { textAlign: "right", padding: "8px 10px", fontSize: 14, whiteSpace: "nowrap" } as const;
const ROW = { borderTop: "1px solid var(--nxt-glass-border-1)" } as const;

function Keys({ keys }: { keys: string[] }) {
  return <span style={{ fontSize: 12, color: MUTED }}>{keys.length ? keys.join(", ") : "—"}</span>;
}

export function Headline({ k, prev }: { k: SprintSummaryKpis; prev: SprintSummaryKpis | null }) {
  const unit = k.completionBasis === "issueCount" ? "issues" : "SP";
  return (
    <div style={MINI_GRID}>
      <MiniCard
        label="Hecho hoy (Rovo)"
        note={`${sp(k.doneTodayStoryPoints)} de ${sp(k.committedStoryPoints)} SP · estado actual`}
      >
        <span style={{ ...BIG, color: rateColor(k.doneTodayRate) }}>{fmtPct(k.doneTodayRate)}</span>
        {prev && <DeltaText value={k.doneTodayRate - prev.doneTodayRate} unit="pp" betterWhen="up" />}
      </MiniCard>
      <MiniCard label="Real cerrado" note={`${sp(k.deliveredStoryPoints)} de ${sp(k.committedStoryPoints)} SP · al cierre`}>
        <span style={{ ...BIG, color: rateColor(k.completionRate) }}>{fmtPct(k.completionRate)}</span>
        {prev && <DeltaText value={k.completionRate - prev.completionRate} unit="pp" betterWhen="up" />}
      </MiniCard>
      <MiniCard label="Issues completados" note={`${k.totalIssues} en el alcance · base ${unit}`}>
        <span style={BIG}>
          {k.completedIssues}/{k.totalIssues}
        </span>
        <span style={SMALL}>{fmtPct(k.issueCompletionRate)}</span>
      </MiniCard>
    </div>
  );
}

export function KpiTable({ k, prev }: { k: SprintSummaryKpis; prev: SprintSummaryKpis | null }) {
  const rows: { label: string; value: (s: SprintSummaryKpis) => string; delta?: [number, number, boolean?] }[] = [
    { label: "Comprometido", value: (s) => `${sp(s.committedStoryPoints)} SP`, delta: [k.committedStoryPoints, prev?.committedStoryPoints ?? 0] },
    { label: "Entregado real", value: (s) => `${sp(s.deliveredStoryPoints)} SP`, delta: [k.deliveredStoryPoints, prev?.deliveredStoryPoints ?? 0] },
    { label: "Hecho hoy", value: (s) => `${sp(s.doneTodayStoryPoints)} SP (${fmtPct(s.doneTodayRate)})`, delta: [k.doneTodayStoryPoints, prev?.doneTodayStoryPoints ?? 0] },
    { label: "Cumplimiento real", value: (s) => fmtPct(s.completionRate), delta: [k.completionRate, prev?.completionRate ?? 0] },
    { label: "Issues", value: (s) => `${s.totalIssues}${s.unestimatedIssues ? ` (${s.unestimatedIssues} sin estimar)` : ""}`, delta: [k.totalIssues, prev?.totalIssues ?? 0] },
    { label: "Issues completados", value: (s) => `${s.completedIssues} (${fmtPct(s.issueCompletionRate)})`, delta: [k.completedIssues, prev?.completedIssues ?? 0] },
    { label: "Incompletas", value: (s) => `${s.incompleteIssues} · ${sp(s.incompleteStoryPoints)} SP`, delta: [k.incompleteStoryPoints, prev?.incompleteStoryPoints ?? 0, true] },
    { label: "Bugs", value: (s) => (s.bugsTotal ? `${s.bugsCompleted}/${s.bugsTotal} (${fmtPct((s.bugsCompleted / s.bugsTotal) * 100, 0)})` : "—") },
  ];
  return (
    <Section id="sp-kpis" title="Frente al sprint anterior" subtitle={prev ? `Contra ${prev.sprintName}` : "Sin sprint anterior para comparar"}>
      <Scroll>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "left" }}>Métrica</th>
              <th style={TH}>{k.sprintName}</th>
              <th style={TH}>{prev?.sprintName ?? "Anterior"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={ROW}>
                <td style={{ ...TD, textAlign: "left" }}>{r.label}</td>
                <td style={{ ...TD, fontWeight: 600 }}>{r.value(k)}</td>
                <td style={{ ...TD, color: MUTED }}>
                  {prev ? (
                    <>
                      {r.value(prev)} {r.delta && <DeltaText value={r.delta[0] - r.delta[1]} betterWhen={r.delta[2] ? "down" : "up"} />}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
    </Section>
  );
}

export function MemberBars({ data }: { data: SprintSummaryResponse }) {
  const max = Math.max(1, ...data.members.map((m) => m.totalStoryPoints));
  return (
    <Section
      id="sp-members-chart"
      title="Story points por integrante"
      subtitle="Responsable actual de cada issue"
      legend={
        <div style={{ display: "flex", gap: 16, fontSize: 13, color: MUTED }}>
          <span style={{ color: V2_GOOD }}>■ Completados</span>
          <span style={{ color: GREY }}>■ Pendientes</span>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.members.map((m) => (
          <div key={m.accountId ?? "none"} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 160px) 1fr 56px", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name ?? "Sin asignar"}</span>
            <div style={{ display: "flex", height: 14, width: "100%" }} aria-hidden="true">
              <div style={{ width: `${(m.completedStoryPoints / max) * 100}%`, background: V2_GOOD, borderRadius: "4px 0 0 4px" }} />
              <div style={{ width: `${(m.incompleteStoryPoints / max) * 100}%`, background: GREY, opacity: 0.6, borderRadius: "0 4px 4px 0" }} />
            </div>
            <span style={{ fontSize: 13, color: MUTED, textAlign: "right" }}>
              {sp(m.completedStoryPoints)}/{sp(m.totalStoryPoints)}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function MemberTable({ data }: { data: SprintSummaryResponse }) {
  const k = data.kpis;
  const cell = (n: ReactNode) => <td style={TD}>{n}</td>;
  return (
    <Section id="sp-members" title="Rendimiento individual" subtitle="Cumplimiento por story points; pendientes por clave">
      <Scroll>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "left" }}>Integrante</th>
              <th style={TH}>Issues</th>
              <th style={TH}>Hechos</th>
              <th style={TH}>SP</th>
              <th style={TH}>SP hechos</th>
              <th style={TH}>Cumpl.</th>
              <th style={{ ...TH, textAlign: "left" }}>Pendientes</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.accountId ?? "none"} style={ROW}>
                <td style={{ ...TD, textAlign: "left" }}>{m.name ?? "Sin asignar"}</td>
                {cell(`${m.totalIssues}${m.unestimatedIssues ? ` (${m.unestimatedIssues} s/e)` : ""}`)}
                {cell(m.completedIssues)}
                {cell(sp(m.totalStoryPoints))}
                {cell(sp(m.completedStoryPoints))}
                <td style={{ ...TD, fontWeight: 600, color: rateColor(m.completionRate) }}>{fmtPct(m.completionRate)}</td>
                <td style={{ ...TD, textAlign: "left", whiteSpace: "normal", minWidth: 140 }}>
                  <Keys keys={m.incompleteKeys} />
                </td>
              </tr>
            ))}
            <tr style={{ ...ROW, fontWeight: 600 }}>
              <td style={{ ...TD, textAlign: "left" }}>Total</td>
              {cell(k.totalIssues)}
              {cell(k.completedIssues)}
              {cell(sp(k.committedStoryPoints))}
              {cell(sp(k.deliveredStoryPoints))}
              <td style={{ ...TD, color: rateColor(k.completionRate) }}>{fmtPct(k.completionRate)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Scroll>
    </Section>
  );
}

export function TypeTable({ data }: { data: SprintSummaryResponse }) {
  return (
    <Section id="sp-types" title="Distribución por tipo" subtitle="Con las claves que quedaron pendientes">
      <Scroll>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: "left" }}>Tipo</th>
              <th style={TH}>Total</th>
              <th style={TH}>Completados</th>
              <th style={TH}>Incompletos</th>
              <th style={{ ...TH, textAlign: "left" }}>Pendientes</th>
            </tr>
          </thead>
          <tbody>
            {data.types.map((t) => {
              const pend = t.totalIssues - t.completedIssues;
              return (
                <tr key={t.type} style={ROW}>
                  <td style={{ ...TD, textAlign: "left" }}>{t.type}</td>
                  <td style={TD}>
                    {t.totalIssues} · {sp(t.totalStoryPoints)} SP
                  </td>
                  <td style={{ ...TD, color: V2_GOOD }}>
                    {t.completedIssues} · {sp(t.completedStoryPoints)} SP
                  </td>
                  <td style={{ ...TD, color: pend > 0 ? V2_WARN : MUTED }}>
                    {pend} · {sp(t.incompleteStoryPoints)} SP
                  </td>
                  <td style={{ ...TD, textAlign: "left", whiteSpace: "normal", minWidth: 140 }}>
                    <Keys keys={t.incompleteKeys} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroll>
    </Section>
  );
}

export const periodText = (k: SprintSummaryKpis) => `${dateOnly(k.startDate)} – ${dateOnly(k.closeDate ?? k.endDate)}`;
