import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useParams } from "wouter";
import { getGetProjectQueryKey, getGetV2TeamQueryKey, useGetProject, useGetV2Team } from "@workspace/api-client-react";
import { GlassCard, WindowToggle } from "../ui";
import { ScrumSections, TeamHeaderText } from "../team/scrum-sections";

type Win = 3 | 6 | 12;
const OPTIONS: { value: Win; label: string }[] = [
  { value: 3, label: "3 sprints" },
  { value: 6, label: "6 sprints" },
  { value: 12, label: "12 sprints" },
];
const MUTED = "rgba(255,255,255,0.70)";

export default function V2Team() {
  const { projectId = "" } = useParams<{ projectId?: string }>();
  const [win, setWin] = useState<Win>(6);
  const params = { sprints: win };
  const { data, isLoading, isError, isFetching } = useGetV2Team(projectId, params, {
    query: { queryKey: getGetV2TeamQueryKey(projectId, params), placeholderData: keepPreviousData },
  });
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
  if (data.boardType === "kanban") {
    // Task 12 fills the Kanban view.
    return (
      <section>
        <h1>{data.projectName}</h1>
        <p style={{ color: MUTED }}>Vista Kanban en construcción</p>
      </section>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: MUTED, letterSpacing: 0.5 }}>Equipo · Scrum · {data.projectKey}</span>
          <h1>{data.projectName}</h1>
          <p style={{ fontSize: 15, color: MUTED }}>
            <TeamHeaderText v={data} />
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isFetching && (
            <span role="status" style={{ fontSize: 13, color: MUTED }}>
              Actualizando…
            </span>
          )}
          <WindowToggle options={OPTIONS} value={win} onChange={setWin} label="Ventana de sprints" />
        </div>
      </section>
      <div
        aria-busy={isFetching}
        style={{ display: "flex", flexDirection: "column", gap: 28, opacity: isFetching ? 0.6 : 1, transition: "opacity 150ms" }}
      >
        <ScrumSections v={data} jiraUrl={project?.url ?? null} />
      </div>
    </div>
  );
}
