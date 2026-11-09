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

type Option = { sprintId: number; name: string; state: string };

export default function V2Sprint() {
  const { projectId = "", sprintId = "" } = useParams<{ projectId?: string; sprintId?: string }>();
  const [, navigate] = useLocation();
  // The default 6-sprint window: the one the sync pre-builds, so it is a cache hit. It only feeds
  // the selector, the back link and the thresholds; the summary below never waits for it.
  const teamParams = { sprints: 6 } as const;
  const { data: team, isLoading: teamLoading } = useGetV2Team(projectId, teamParams, {
    query: { queryKey: getGetV2TeamQueryKey(projectId, teamParams) },
  });

  const scrum = team && team.boardType !== "kanban" ? team : null;
  // Newest first: the active sprint (if any) on top, then the closed ones.
  const windowOptions: Option[] = scrum ? [...(scrum.active ? [scrum.active] : []), ...[...scrum.sprints].reverse()] : [];
  const urlId = Number(sprintId);
  const hasUrlId = Number.isInteger(urlId) && urlId > 0;
  // Only without a usable id in the URL does the page need the team to pick one (last closed).
  const fallback = windowOptions.find((s) => s.state === "closed") ?? windowOptions[0] ?? null;
  const id = hasUrlId ? urlId : (fallback?.sprintId ?? 0);

  const summaryKey = getGetProjectSprintSummaryQueryKey(projectId, id);
  const { data, isLoading, isError, isFetching } = useGetProjectSprintSummary(projectId, id, {
    query: {
      enabled: !!projectId && id > 0,
      queryKey: summaryKey,
      // Keep the previous sprint on screen while the next one loads, but never another project's.
      placeholderData: (prev, prevQuery) => (prev && prevQuery && String(prevQuery.queryKey[0]).startsWith(`/api/projects/${projectId}/`) ? prev : undefined),
      retry: false,
    },
  });

  // A sprint older than the window (e.g. linked from a 12-sprint view) still loads and is listed,
  // by its name once its summary is here.
  const urlName = data && data.kpis.sprintId === urlId ? data.kpis.sprintName : `Sprint ${urlId}`;
  const options: Option[] =
    hasUrlId && scrum && !windowOptions.some((s) => s.sprintId === urlId)
      ? [...windowOptions, { sprintId: urlId, name: urlName, state: "closed" }]
      : windowOptions;

  const back = (
    <Link href={`/v2/projects/${projectId}`} style={{ fontSize: 14, color: MUTED }}>
      ← Equipo {team?.projectName ?? ""}
    </Link>
  );

  if ((isLoading || (!hasUrlId && teamLoading)) && !data) {
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
        <Headline k={k} prev={data.previous} thresholds={scrum?.thresholds} />
        <KpiTable k={k} prev={data.previous} />
        {data.members.length > 0 && <MemberBars data={data} />}
        <MemberTable data={data} thresholds={scrum?.thresholds} />
        <TypeTable data={data} />
      </div>
    </div>
  );
}
