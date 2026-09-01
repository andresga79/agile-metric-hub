import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getAuthToken } from "@/lib/auth";
import { Rocket, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AdminProjectVisibilityRow {
  projectId: string;
  projectKey: string;
  name: string;
  visible: boolean;
}

interface ReleaseKeywordRow {
  id: number;
  projectId: string;
  keyword: string;
}

// Same "manual fetch + bearer token" pattern as use-report-data.ts (Task 10) and the
// existing Admin sections (thresholds, project visibility) in admin.tsx — no dedicated
// generated hook exists for this resource yet, so this page follows that pattern rather
// than inventing a new one.
export default function AdminReleaseKeywords() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<AdminProjectVisibilityRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [keywords, setKeywords] = useState<ReleaseKeywordRow[]>([]);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Project list reuses the same source as the Health "overrides por proyecto" picker
  // in admin.tsx (/api/admin/project-visibility) — it already returns the full project
  // roster with id/key/name, which is all a project picker needs here.
  useEffect(() => {
    const token = getAuthToken();
    fetch("/api/admin/project-visibility", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.projects)) {
          setProjects(data.projects);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setKeywords([]);
      return;
    }

    const token = getAuthToken();
    const controller = new AbortController();
    setLoadingKeywords(true);
    setError(null);

    fetch(`/api/admin/projects/${selectedProjectId}/release-keywords`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Release keywords request failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setKeywords(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setKeywords([]);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingKeywords(false));

    return () => controller.abort();
  }, [selectedProjectId]);

  const addKeyword = async () => {
    const trimmed = newKeyword.trim();
    if (!trimmed || !selectedProjectId) return;

    const exists = keywords.some((k) => k.keyword.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      setError("Esa palabra clave ya esta agregada para este proyecto");
      return;
    }

    const token = getAuthToken();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/projects/${selectedProjectId}/release-keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ keyword: trimmed }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error ?? "No se pudo guardar la palabra clave";
        setError(message);
        toast({ title: "No se pudo guardar", description: message, variant: "destructive" });
        return;
      }
      const saved = await response.json();
      if (saved) {
        setKeywords((prev) => [...prev, saved]);
      }
      setNewKeyword("");
    } catch {
      setError("No se pudo guardar la palabra clave");
      toast({ title: "Error de red", description: "No se pudo guardar la palabra clave.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const removeKeyword = async (keywordId: number) => {
    const token = getAuthToken();
    const previous = keywords;
    setKeywords((prev) => prev.filter((k) => k.id !== keywordId));
    try {
      const response = await fetch(
        `/api/admin/projects/${selectedProjectId}/release-keywords/${keywordId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!response.ok) {
        setKeywords(previous);
        toast({
          title: "No se pudo eliminar",
          description: "Error al eliminar la palabra clave.",
          variant: "destructive",
        });
      }
    } catch {
      setKeywords(previous);
      toast({
        title: "Error de red",
        description: "No se pudo eliminar la palabra clave.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Releases</h1>
        <p className="text-sm text-muted-foreground">
          Palabras clave usadas para asociar epics de Jira con el reporte de RC production readiness de cada proyecto.
        </p>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Rocket size={18} className="text-primary" />
            Palabras Clave De Release Por Proyecto
          </CardTitle>
          <CardDescription>
            Cada palabra clave se busca (case-insensitive) contra el titulo y la descripcion de los epics de release
            en Jira para determinar que epic corresponde a este proyecto.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="bg-background border border-border rounded px-2 py-1.5 text-sm min-w-[240px]"
            >
              <option value="">Seleccionar proyecto…</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name} ({p.projectKey})
                </option>
              ))}
            </select>
          </div>

          {selectedProjectId && (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addKeyword();
                  }}
                  placeholder="Agregar palabra clave (ej: CxC)"
                  className="w-full sm:max-w-xs bg-background border border-border rounded px-2 py-1.5 text-sm"
                />
                <button
                  onClick={addKeyword}
                  disabled={saving || !newKeyword.trim()}
                  className="flex items-center gap-1.5 bg-secondary text-secondary-foreground px-3 py-1.5 rounded text-sm hover:bg-secondary/80 disabled:opacity-50"
                >
                  <Plus size={14} />
                  Agregar
                </button>
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}

              <div className="flex flex-wrap gap-2">
                {loadingKeywords && (
                  <span className="text-xs text-muted-foreground">Cargando…</span>
                )}
                {!loadingKeywords && keywords.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Sin palabras clave configuradas para este proyecto todavia.
                  </span>
                )}
                {keywords.map((k) => (
                  <span
                    key={k.id}
                    className="inline-flex items-center gap-1 rounded bg-accent/50 px-2 py-1 text-xs"
                  >
                    {k.keyword}
                    <button
                      onClick={() => removeKeyword(k.id)}
                      className="text-muted-foreground hover:text-destructive"
                      title="Quitar palabra clave"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
