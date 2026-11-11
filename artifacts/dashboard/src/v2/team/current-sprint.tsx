import { Link } from "wouter";
import {
  getGetProjectSprintSummaryQueryKey,
  getGetV2CurrentSprintQueryKey,
  useGetProjectSprintSummary,
  useGetV2CurrentSprint,
  type V2CurrentSprintView,
  type V2SprintFacts,
} from "@workspace/api-client-react";
import { fmtNum, fmtPct, fmtPp } from "../format";
import { DeltaText, GlassCard, V2_WARN } from "../ui";
import { MemberBars, TypeTable } from "../sprint/sections";
import { JiraKey } from "./kanban-sections";
import { Answer } from "./scrum-sections";
import { WaitingSection } from "./scrum-flow";
import { BIG, GREY, Legend, MINI_GRID, MUTED, MiniCard, Section, sprintLabel, type ScrumView } from "./shared";

const sp = (n: number) => fmtNum(n, 0);
const dateFmt = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "short" });
const day = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)).replace(".", "") : "—");

/** Header line of the tab: "Sprint 118 en curso · 2 nov – 13 nov." */
export function CurrentHeaderText({ v }: { v: ScrumView }) {
  const a = v.active;
  if (!a) return <>Sin sprint en curso.</>;
  return <>{`${sprintLabel(a.name)} en curso · ${day(a.startDate)} – ${day(a.endDate)}.`}</>;
}
const NEW = "var(--nxt-primary)";

/**
 * "Sprint actual" tab: the sprint in progress, from /v2/projects/:id/current-sprint (facts, business
 * days, its own time in status and WIP) plus the sprint summary (per member, per type). `v` is the
 * team's 6-sprint view, only for the comparison against the last 3 closed sprints.
 */
export function CurrentSprintSections({ v, jiraUrl }: { v: ScrumView; jiraUrl: string | null }) {
  const { data, isLoading, isError } = useGetV2CurrentSprint(v.projectId, {
    query: { queryKey: getGetV2CurrentSprintQueryKey(v.projectId) },
  });
  const sprintId = data?.sprint?.sprintId ?? 0;
  const { data: summary } = useGetProjectSprintSummary(v.projectId, sprintId, {
    query: { enabled: sprintId > 0, queryKey: getGetProjectSprintSummaryQueryKey(v.projectId, sprintId), retry: false },
  });

  if (isLoading && !data) {
    return (
      <GlassCard>
        <p>Cargando el sprint en curso…</p>
      </GlassCard>
    );
  }
  if (isError || !data) {
    return (
      <GlassCard>
        <p>No se pudo cargar el sprint en curso.</p>
      </GlassCard>
    );
  }
  const s = data.sprint;
  if (!s) {
    return (
      <GlassCard>
        <p>Sin sprint en curso.</p>
      </GlassCard>
    );
  }
  return (
    <>
      <CurrentAnswers cur={data} s={s} v={v} jiraUrl={jiraUrl} />
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 20 }}>
        <Composition s={s} />
        <WaitingSection
          timeInStatus={data.timeInStatus}
          wip={data.wip}
          jiraUrl={jiraUrl}
          subtitle="Días promedio que pasan los issues de este sprint en cada estado del flujo, hasta hoy."
        />
      </section>
      {summary && summary.members.length > 0 && <MemberBars data={summary} />}
      {summary && <TypeTable data={summary} />}
      <Link href={`/v2/projects/${v.projectId}/sprints/${s.sprintId}`} style={{ alignSelf: "flex-end", fontSize: 14, color: "var(--nxt-primary-soft)" }}>
        Ver detalle de {sprintLabel(s.name)} →
      </Link>
    </>
  );
}

function CurrentAnswers({ cur, s, v, jiraUrl }: { cur: V2CurrentSprintView; s: V2SprintFacts; v: ScrumView; jiraUrl: string | null }) {
  const byIssues = s.basis === "issueCount";
  const unit = byIssues ? "issues" : "SP";
  const done = byIssues ? s.rovoDoneIssues : s.rovoDoneSp;
  const total = byIssues ? s.committedIssues : s.committedSp;
  const pendingSp = Math.max(0, s.committedSp - s.rovoDoneSp);
  const pendingIssues = Math.max(0, s.committedIssues - s.rovoDoneIssues);
  const days = cur.businessDays;
  const remaining = days ? days.total - days.elapsed : null;
  const pace = cur.expectedRate == null ? null : s.rovoRate - cur.expectedRate;
  // Same reference the planning card uses: mean "no planificado" of the last 3 closed sprints.
  const ref = v.planning?.unplannedPct ?? null;
  const addedVsRef = ref == null ? null : s.addedRate - ref;
  const { total: inProgress, aged } = cur.wip;
  const big = { ...BIG, fontSize: 28, lineHeight: "36px" };
  return (
    <section aria-label="Respuestas rápidas del sprint en curso" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
      <Answer
        q="¿Cómo va el sprint?"
        big={<span style={BIG}>{fmtPct(s.rovoRate)}</span>}
        unit="avance"
        delta={
          pace != null && (
            <DeltaText value={pace} betterWhen="up">{`${fmtPp(pace)} vs el ${fmtPct(cur.expectedRate, 0)} esperado a esta altura`}</DeltaText>
          )
        }
        note={`${sp(done)} de ${sp(total)} ${unit} en Done${days ? ` · día ${days.current} de ${days.total} hábiles` : ""}.`}
      />
      <Answer
        q="¿Qué queda?"
        big={<span style={BIG}>{byIssues ? pendingIssues : sp(pendingSp)}</span>}
        unit={byIssues ? "issues pendientes" : `SP pendientes · ${pendingIssues} issues`}
        note={
          remaining == null
            ? "Sin fechas del sprint en Jira."
            : remaining === 0
              ? "El sprint ya pasó su fecha de cierre."
              : `${remaining === 1 ? "Queda 1 día hábil" : `Quedan ${remaining} días hábiles`}, contando hoy.`
        }
      />
      <Answer
        q="¿Cuánto cambió el alcance?"
        big={<span style={BIG}>{fmtPct(s.addedRate)}</span>}
        unit="no planificado"
        delta={
          addedVsRef != null && (
            <DeltaText value={addedVsRef} betterWhen="down">{`${fmtPp(addedVsRef)} vs el ${fmtPct(ref, 0)} de los últimos 3 sprints`}</DeltaText>
          )
        }
        note={`${s.addedIssues} issues${byIssues ? "" : ` (${sp(s.addedSp)} SP)`} entraron después de la planning.`}
      />
      <Answer
        q="¿Qué está trabado?"
        big={<span style={{ ...big, color: aged.length ? V2_WARN : undefined }}>{aged.length}</span>}
        unit={aged.length === 1 ? "issue envejecido" : "issues envejecidos"}
        note={`${inProgress} issues en curso hoy${aged.length ? "; estos llevan más días de lo habitual en su estado." : ", ninguno lleva más días de lo habitual."}`}
        extra={
          aged.length > 0 && (
            <span style={{ fontSize: 14, color: MUTED }}>
              {aged.slice(0, 3).map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <JiraKey k={a.key} jiraUrl={jiraUrl} />
                </span>
              ))}
              {aged.length > 3 && ` y ${aged.length - 3} más`}
            </span>
          )
        }
      />
    </section>
  );
}

/** How the sprint's scope was put together: planned new work, carried over, entered after planning. */
function Composition({ s }: { s: V2SprintFacts }) {
  const byIssues = s.basis === "issueCount";
  const plannedIssues = Math.max(0, s.committedIssues - s.addedIssues);
  if (byIssues) {
    return (
      <Section id="t-composicion" title="Composición del sprint" subtitle="Cómo se armó el alcance, en issues (el equipo no estima en SP).">
        <div style={MINI_GRID}>
          <MiniCard label="En la planning" note={`de ${s.committedIssues} issues en el sprint`}>
            <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{plannedIssues}</span>
          </MiniCard>
          <MiniCard label="Entró después" note={`${fmtPct(s.addedRate, 0)} del sprint`}>
            <span style={{ ...BIG, fontSize: 28, lineHeight: "36px", color: V2_WARN }}>{s.addedIssues}</span>
          </MiniCard>
        </div>
        <p style={{ fontSize: 14, color: MUTED }}>{fmtPct(s.carryoverRate, 0)} del sprint viene arrastrado de sprints anteriores.</p>
      </Section>
    );
  }
  const total = Math.max(s.committedSp, 0.0001);
  // Carried-over work enters with the sprint's start, so it is part of what was planned; whatever
  // overlap there is with "added" is clamped away from the new planned work.
  const newPlanned = Math.max(0, s.committedSp - s.addedSp - s.carryoverSp);
  const parts = [
    { label: "Nuevo planificado", value: newPlanned, color: NEW },
    { label: "Arrastrado", value: s.carryoverSp, color: GREY },
    { label: "Entró después de la planning", value: s.addedSp, color: V2_WARN },
  ];
  return (
    <Section
      id="t-composicion"
      title="Composición del sprint"
      subtitle={`Cómo se armaron los ${sp(s.committedSp)} SP del sprint.`}
      legend={<Legend items={parts.map((p) => ({ color: p.color, label: p.label }))} />}
    >
      <div
        role="img"
        aria-label={parts.map((p) => `${p.label}: ${sp(p.value)} SP`).join(", ")}
        style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: "rgba(255,255,255,0.08)" }}
      >
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div style={MINI_GRID}>
        <MiniCard label="En la planning" note={`${plannedIssues} issues · ${sp(s.carryoverSp)} SP arrastrados de sprints anteriores`}>
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px" }}>{sp(s.committedSp - s.addedSp)}</span>
          <span style={{ fontSize: 13, color: MUTED }}>SP</span>
        </MiniCard>
        <MiniCard label="Entró después de la planning" note={`${s.addedIssues} issues · ${fmtPct(s.addedRate, 0)} del sprint`}>
          <span style={{ ...BIG, fontSize: 28, lineHeight: "36px", color: V2_WARN }}>{sp(s.addedSp)}</span>
          <span style={{ fontSize: 13, color: MUTED }}>SP</span>
        </MiniCard>
      </div>
    </Section>
  );
}
