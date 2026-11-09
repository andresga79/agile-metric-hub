import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { RefreshCw } from "lucide-react";
import { useListUserProjects, getListUserProjectsQueryKey } from "@workspace/api-client-react";
import { getAuthToken } from "@/lib/auth";

type SyncStatus = { lastSyncedAt: string | null; isSyncing: boolean };

function formatSync(iso: string | null): string {
  if (!iso) return "sin sincronizar";
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const pill = (active: boolean) =>
  ({
    padding: "8px 14px",
    borderRadius: 999,
    background: active ? "var(--nxt-primary-container)" : "transparent",
    color: active ? "var(--nxt-on-primary-container)" : "var(--nxt-on-surface-variant)",
    fontSize: 14,
    fontWeight: 500,
  }) as const;

export function V2Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const token = getAuthToken();
  const [sync, setSync] = useState<SyncStatus | null>(null);

  useEffect(() => {
    const t = localStorage.getItem("auth_token");
    if (!t) return;
    fetch("/api/sync/status", { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => r.json())
      .then(setSync)
      .catch(() => {});
  }, []);

  const { data: projects } = useListUserProjects({
    query: { queryKey: getListUserProjectsQueryKey(), enabled: !!token },
  });
  const visible = projects?.filter((p) => p.visible) ?? [];

  const teamMatch = /^\/v2\/projects\/([^/]+)/.exec(location);
  const currentTeam = teamMatch ? decodeURIComponent(teamMatch[1]) : "";
  const isPortfolio = location === "/v2" || location === "/v2/";

  return (
    <div className="v2-root">
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "16px 32px",
          padding: "16px 32px",
          borderBottom: "1px solid var(--nxt-glass-border-1)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            aria-hidden="true"
            style={{ width: 14, height: 14, background: "var(--nxt-primary)", transform: "rotate(45deg)", borderRadius: 2 }}
          />
          <span style={{ fontFamily: "var(--nxt-font-display)", fontWeight: 600, fontSize: 18, color: "#fff" }}>
            Agile Metric Hub
          </span>
        </div>
        <nav aria-label="Principal" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, flexGrow: 1 }}>
          <Link href="/v2" aria-current={isPortfolio ? "page" : undefined} style={pill(isPortfolio)}>
            Portafolio
          </Link>
          <label style={{ ...pill(!!currentTeam), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Equipos</span>
            <select
              aria-label="Equipos"
              value={currentTeam}
              onChange={(e) => e.target.value && setLocation(`/v2/projects/${encodeURIComponent(e.target.value)}`)}
              style={{
                background: "var(--nxt-bg-2)",
                color: "inherit",
                border: "1px solid var(--nxt-glass-border-2)",
                borderRadius: 8,
                padding: "2px 6px",
                fontSize: 13,
              }}
            >
              <option value="">Elegir equipo…</option>
              {visible.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 13, color: "var(--nxt-on-surface-variant)" }}>
          {sync && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={12} className={sync.isSyncing ? "animate-spin" : ""} aria-hidden="true" />
              Sincronizado {formatSync(sync.lastSyncedAt)}
            </span>
          )}
          <Link href="/" style={{ color: "var(--nxt-primary-soft)" }}>
            Versión actual
          </Link>
        </div>
      </header>
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 32px 64px" }}>{children}</main>
    </div>
  );
}
