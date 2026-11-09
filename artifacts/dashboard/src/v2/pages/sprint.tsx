import { useParams } from "wouter";

export default function V2Sprint() {
  const params = useParams<{ projectId?: string; sprintId?: string }>();
  return <section><h1>Sprint {params.sprintId} · equipo {params.projectId}</h1></section>;
}
