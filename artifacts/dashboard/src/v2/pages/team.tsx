import { useState } from "react";
import { useParams } from "wouter";
import { getGetProjectQueryKey, getGetV2TeamQueryKey, useGetProject, useGetV2Team } from "@workspace/api-client-react";
import { GlassCard, WindowToggle } from "../ui";
import { KanbanHeaderText, KanbanSections } from "../team/kanban-sections";
import { ScrumSections, TeamHeaderText } from "../team/scrum-sections";
import { CurrentHeaderText, CurrentSprintSections } from "../team/current-sprint";

type Win = 3 | 6 | 12;
/** "current" = the sprint in progress; the 3/6/12 windows only hold closed sprints. */
type Tab = Win | "current";
type Days = 30 | 90 | 180;
const DAY_OPTIONS: { value: Days; label: string }[] = [
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
  { value: 180, label: "180 días" },
];
const CURRENT = { value: "current" as const, label: "Sprint actual" };
const OPTIONS: { value: Tab; label: string }[] = [
  { value: 3, label: "3 sprints" },
  { value: 6, label: "6 sprints" },
  { value: 12, label: "12 sprints" },
];
const MUTED = "rgba(255,255,255,0.70)";

export default function V2Team() {
  const { projectId = "" } = useParams<{ projectId?: string }>();
  // Keyed by project: switching teams in the header resets the window/board-type state, so the
  // next team starts at its default (warm) window instead of inheriting e.g. a cold 12.
  return <TeamPage key={projectId} projectId={projectId} />;
}

function TeamPage({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>(6);
  const [days, setDays] = useState<Days>(90);
  // The board type is only known from the response: ask with the sprint window first, then switch to `days`
  // once the project turns out to be Kanban.
  const [kanban, setKanban] = useState(false);
  // "Sprint actual" still reads the (warm) 6-sprint view: header, thresholds and the last-3 reference.
  const params = kanban ? { days } : { sprints: tab === "current" ? 6 : tab };
  const teamKey = getGetV2TeamQueryKey(projectId, params);
  const { data, isLoading, isError, isFetching } = useGetV2Team(projectId, params, {
    query: {
      queryKey: teamKey,
      // Keep the previous window on screen while another window of the same team loads; never
      // show another team's data while this one loads.
      placeholderData: (prev, prevQuery) => (prev && prevQuery && prevQuery.queryKey[0] === teamKey[0] ? prev : undefined),
    },
  });
  const isKanban = data?.boardType === "kanban";
  if (isKanban !== kanban && data) setKanban(isKanban);
  const hasActive = data?.boardType === "scrum" && data.active != null;
  // A team with no sprint in progress has no "Sprint actual" tab: fall back to the default window.
  if (tab === "current" && data && !isFetching && !hasActive) setTab(6);
  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } });

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
        <p>No se pudo cargar el equipo.</p>
      </GlassCard>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: MUTED, letterSpacing: 0.5 }}>Equipo · {data.boardType === "kanban" ? "Kanban" : "Scrum"} · {data.projectKey}</span>
          <h1>{data.projectName}</h1>
          <p style={{ fontSize: 15, color: MUTED }}>
            {data.boardType === "kanban" ? (
              <KanbanHeaderText v={data} />
            ) : tab === "current" ? (
              <CurrentHeaderText v={data} />
            ) : (
              <TeamHeaderText v={data} onShowActive={() => setTab("current")} />
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isFetching && (
            <span role="status" style={{ fontSize: 13, color: MUTED }}>
              Actualizando…
            </span>
          )}
          {data.boardType === "kanban" ? (
            <WindowToggle options={DAY_OPTIONS} value={days} onChange={setDays} label="Ventana de días" />
          ) : (
            <WindowToggle options={hasActive ? [CURRENT, ...OPTIONS] : OPTIONS} value={tab} onChange={setTab} label="Ventana de sprints" />
          )}
        </div>
      </section>
      <div
        aria-busy={isFetching}
        style={{ display: "flex", flexDirection: "column", gap: 28, opacity: isFetching ? 0.6 : 1, transition: "opacity 150ms" }}
      >
        {data.boardType === "kanban" ? (
          <KanbanSections v={data} jiraUrl={project?.url ?? null} />
        ) : tab === "current" ? (
          <CurrentSprintSections v={data} jiraUrl={project?.url ?? null} />
        ) : (
          <ScrumSections v={data} jiraUrl={project?.url ?? null} />
        )}
      </div>
    </div>
  );
}
