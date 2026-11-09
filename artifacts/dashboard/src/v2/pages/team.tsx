import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useParams } from "wouter";
import { getGetProjectQueryKey, getGetV2TeamQueryKey, useGetProject, useGetV2Team } from "@workspace/api-client-react";
import { GlassCard, WindowToggle } from "../ui";
import { KanbanHeaderText, KanbanSections } from "../team/kanban-sections";
import { ScrumSections, TeamHeaderText } from "../team/scrum-sections";

type Win = 3 | 6 | 12;
type Days = 30 | 90 | 180;
const DAY_OPTIONS: { value: Days; label: string }[] = [
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
  { value: 180, label: "180 días" },
];
const OPTIONS: { value: Win; label: string }[] = [
  { value: 3, label: "3 sprints" },
  { value: 6, label: "6 sprints" },
  { value: 12, label: "12 sprints" },
];
const MUTED = "rgba(255,255,255,0.70)";

export default function V2Team() {
  const { projectId = "" } = useParams<{ projectId?: string }>();
  const [win, setWin] = useState<Win>(6);
  const [days, setDays] = useState<Days>(90);
  // The board type is only known from the response: ask with the sprint window first, then switch to `days`
  // once the project turns out to be Kanban.
  const [kanban, setKanban] = useState(false);
  const params = kanban ? { days } : { sprints: win };
  const { data, isLoading, isError, isFetching } = useGetV2Team(projectId, params, {
    query: { queryKey: getGetV2TeamQueryKey(projectId, params), placeholderData: keepPreviousData },
  });
  const isKanban = data?.boardType === "kanban";
  if (isKanban !== kanban && data) setKanban(isKanban);
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
            {data.boardType === "kanban" ? <KanbanHeaderText v={data} /> : <TeamHeaderText v={data} />}
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
            <WindowToggle options={OPTIONS} value={win} onChange={setWin} label="Ventana de sprints" />
          )}
        </div>
      </section>
      <div
        aria-busy={isFetching}
        style={{ display: "flex", flexDirection: "column", gap: 28, opacity: isFetching ? 0.6 : 1, transition: "opacity 150ms" }}
      >
        {data.boardType === "kanban" ? (
          <KanbanSections v={data} jiraUrl={project?.url ?? null} />
        ) : (
          <ScrumSections v={data} jiraUrl={project?.url ?? null} />
        )}
      </div>
    </div>
  );
}
