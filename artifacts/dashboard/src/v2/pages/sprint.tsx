import { keepPreviousData } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import {
  getGetProjectSprintSummaryQueryKey,
  getGetV2TeamQueryKey,
  useGetProjectSprintSummary,
  useGetV2Team,
} from "@workspace/api-client-react";
import { GlassCard } from "../ui";
import { MUTED, sprintLabel } from "../team/shared";
import { Headline, KpiTable, MemberBars, MemberTable, TypeTable, periodText } from "../sprint/sections";

export default function V2Sprint() {
  const { projectId = "", sprintId = "" } = useParams<{ projectId?: string; sprintId?: string }>();
  const [, navigate] = useLocation();
  const teamParams = { sprints: 12 } as const;
  const { data: team, isLoading: teamLoading } = useGetV2Team(projectId, teamParams, {
    query: { queryKey: getGetV2TeamQueryKey(projectId, teamParams), placeholderData: keepPreviousData },
  });

  const scrum = team && team.boardType !== "kanban" ? team : null;
  // Newest first: the active sprint (if any) on top, then the closed ones.
  const options = scrum ? [...(scrum.active ? [scrum.active] : []), ...[...scrum.sprints].reverse()] : [];
  const urlId = Number(sprintId);
  const chosen =
    options.find((s) => s.sprintId === urlId) ?? options.find((s) => s.state === "closed") ?? options[0] ?? null;
  const id = chosen?.sprintId ?? (Number.isFinite(urlId) ? urlId : 0);

  const { data, isLoading, isError, isFetching } = useGetProjectSprintSummary(projectId, id, {
    query: {
      enabled: !!projectId && (!!chosen || !teamLoading),
      queryKey: getGetProjectSprintSummaryQueryKey(projectId, id),
      placeholderData: keepPreviousData,
      retry: false,
    },
  });

  const back = (
    <Link href={`/v2/projects/${projectId}`} style={{ fontSize: 14, color: MUTED }}>
      ← Equipo {team?.projectName ?? ""}
    </Link>
  );

  if ((isLoading || teamLoading) && !data) {
    return (
      <GlassCard>
        {back}
        <p>Cargando…</p>
      </GlassCard>
    );
  }
  if (isError || !data) {
    return (
      <GlassCard>
        {back}
        <p>No se pudo cargar el sprint.</p>
      </GlassCard>
    );
  }
  const k = data.kpis;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {back}
          <h1>{sprintLabel(k.sprintName)}</h1>
          <p style={{ fontSize: 15, color: MUTED }}>
            {periodText(k)}
            {k.state !== "closed" && " · Sprint en curso: las cifras reales se fijan al cierre"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isFetching && (
            <span role="status" style={{ fontSize: 13, color: MUTED }}>
              Actualizando…
            </span>
          )}
          {options.length > 0 && (
            <select
              aria-label="Sprint"
              value={id}
              onChange={(e) => navigate(`/v2/projects/${projectId}/sprints/${e.target.value}`)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid var(--nxt-glass-border-1)",
                background: "var(--nxt-glass-1)",
                color: "inherit",
                fontSize: 14,
              }}
            >
              {options.map((s) => (
                <option key={s.sprintId} value={s.sprintId} style={{ color: "#111" }}>
                  {sprintLabel(s.name)}
                  {s.state === "active" ? " (en curso)" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>
      <div
        aria-busy={isFetching}
        style={{ display: "flex", flexDirection: "column", gap: 28, opacity: isFetching ? 0.6 : 1, transition: "opacity 150ms" }}
      >
        <Headline k={k} prev={data.previous} />
        <KpiTable k={k} prev={data.previous} />
        {data.members.length > 0 && <MemberBars data={data} />}
        <MemberTable data={data} />
        <TypeTable data={data} />
      </div>
    </div>
  );
}
