import { useParams } from "wouter";

export default function V2Team() {
  const params = useParams<{ projectId?: string; sprintId?: string }>();
  return <section><h1>Equipo {params.projectId}</h1></section>;
}
