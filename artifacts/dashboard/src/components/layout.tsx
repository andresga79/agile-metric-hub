import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useLogout, useGetCurrentUser, getGetCurrentUserQueryKey, ApiError } from "@workspace/api-client-react";
import { setAuthToken } from "@/lib/auth";
import { LogOut, LayoutDashboard, Menu, X, ShieldAlert, RefreshCw, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ lastSyncedAt: string | null; isSyncing: boolean } | null>(null);
  const [syncStarting, setSyncStarting] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const fetchSyncStatus = useCallback(async (): Promise<{ lastSyncedAt: string | null; isSyncing: boolean } | null> => {
    const token = localStorage.getItem("auth_token");
    if (!token) return null;
    try {
      const r = await fetch("/api/sync/status", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const next = await r.json();
      setSyncStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  // Poll while a sync runs; when it ends every screen's data is stale, so refetch all queries.
  const pollUntilDone = useCallback(() => {
    pollRef.current = window.setTimeout(async () => {
      const next = await fetchSyncStatus();
      if (next?.isSyncing) return pollUntilDone();
      pollRef.current = null;
      void queryClient.invalidateQueries();
    }, 5000);
  }, [fetchSyncStatus, queryClient]);

  useEffect(() => {
    void fetchSyncStatus().then((s) => {
      if (s?.isSyncing) pollUntilDone();
    });
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [fetchSyncStatus, pollUntilDone]);
  useEffect(() => setMounted(true), []);

  // Admin-only manual Jira sync (POST /api/sync/run: 202 started, 409 one is already running).
  const runSync = async () => {
    const token = localStorage.getItem("auth_token");
    if (!token || syncStarting || syncStatus?.isSyncing) return;
    setSyncError(null);
    setSyncStarting(true);
    try {
      const r = await fetch("/api/sync/run", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok && r.status !== 409) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? `HTTP ${r.status}`);
      }
      const next = await fetchSyncStatus();
      if (next?.isSyncing) pollUntilDone();
      else void queryClient.invalidateQueries();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncStarting(false);
    }
  };
  const syncBusy = syncStarting || !!syncStatus?.isSyncing;
  const { data: user, isLoading, isError, error } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      retry: false
    }
  });

  useEffect(() => {
    if (isError && error instanceof ApiError && error.status === 401) {
      setAuthToken(null);
      queryClient.clear();
      setLocation("/login");
    }
  }, [isError, error, queryClient, setLocation]);

  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        setAuthToken(null);
        queryClient.clear();
        setLocation("/login");
      }
    });
  };

  if (isLoading || (isError && error instanceof ApiError && error.status === 401)) return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      {t('nav.loading')}
    </div>
  );

  if (isError) return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <p className="text-muted-foreground">{t('nav.connectionError')}</p>
    </div>
  );

  const navLinks = (
    <nav className="flex-1 p-4 space-y-1">
      <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {t('nav.primary')}
      </p>
      <Link
        href="/"
        onClick={() => setSidebarOpen(false)}
        className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
      >
        <LayoutDashboard size={18} />
        {t('nav.dashboard')}
      </Link>

      {user?.role === "admin" && (
        <>
        <hr className="my-3 border-border" />

        <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t('nav.configuration')}
        </p>
        <Link
          href="/admin"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
        >
          <ShieldAlert size={18} />
          {t('nav.admin')}
        </Link>
        </>
      )}
    </nav>
  );

  const formatLastSynced = (iso: string | null) => {
    if (!iso) return t('page.dashboard.never');
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('page.dashboard.now');
    if (diffMin < 60) return t('page.dashboard.minAgo', { count: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('page.dashboard.hAgo', { count: diffH });
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const userFooter = (
    <div className="p-4 border-t border-border">
      {user?.role === "admin" && (
        <div className="mb-3 px-2">
          <button
            type="button"
            onClick={runSync}
            disabled={syncBusy}
            className="w-full inline-flex items-center justify-center gap-2 text-xs font-medium rounded-md border border-border px-2 py-1.5 hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={12} className={syncBusy ? "animate-spin" : ""} />
            {syncBusy ? t('page.dashboard.syncing') : t('page.dashboard.syncNow')}
          </button>
          {syncError && <p className="mt-1 text-[11px] text-red-400">{t('page.dashboard.syncFailed', { error: syncError })}</p>}
        </div>
      )}
      <div className="flex items-center justify-between mb-3 px-2">
        {syncStatus && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw size={12} className={syncStatus?.isSyncing ? "animate-spin" : ""} />
            <span className="truncate">{t('page.dashboard.synced')} {formatLastSynced(syncStatus.lastSyncedAt)}</span>
          </div>
        )}
        {mounted && (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent transition-colors shrink-0"
            aria-label={t('nav.toggleTheme')}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {user?.username?.[0]?.toUpperCase()}
        </div>
        <div className="overflow-hidden">
          <p className="text-sm font-medium truncate">{user?.username}</p>
          <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
        </div>
      </div>
      <button
        onClick={handleLogout}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive w-full px-2 py-2 rounded-md hover:bg-destructive/10 transition-colors"
      >
        <LogOut size={16} />
        {t('nav.signOut')}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — desktop always visible, mobile slides in */}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-30 w-64 border-r border-border bg-card flex flex-col",
          "transition-transform duration-200 ease-in-out",
          "md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-primary">
            Agile<span className="text-foreground">Metrics</span>
          </h1>
          <Link href="/v2" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
            Probar v2
          </Link>
          <button
            className="md:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        {navLinks}
        {userFooter}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="h-14 border-b border-border bg-card/50 flex items-center px-4 gap-3 md:hidden shrink-0">
          <button
            className="text-muted-foreground hover:text-foreground p-1"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <Menu size={22} />
          </button>
          <h1 className="text-lg font-bold tracking-tight text-primary">
            Agile<span className="text-foreground">Metrics</span>
          </h1>
          <Link href="/v2" className="text-xs ml-auto text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
            Probar v2
          </Link>
        </header>

        <div className="flex-1 p-4 md:p-6 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
