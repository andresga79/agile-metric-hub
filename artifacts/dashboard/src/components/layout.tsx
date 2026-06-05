import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useLogout, useGetCurrentUser, getGetCurrentUserQueryKey, ApiError } from "@workspace/api-client-react";
import { setAuthToken } from "@/lib/auth";
import { LogOut, LayoutDashboard, Settings as SettingsIcon, Menu, X, ShieldAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
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
      <Link
        href="/"
        onClick={() => setSidebarOpen(false)}
        className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
      >
        <LayoutDashboard size={18} />
        {t('nav.dashboard')}
      </Link>

      <Link
        href="/settings"
        onClick={() => setSidebarOpen(false)}
        className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
      >
        <SettingsIcon size={18} />
        {t('nav.settings')}
      </Link>

      {user?.role === "admin" && (
        <Link
          href="/admin"
          onClick={() => setSidebarOpen(false)}
          className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-sm font-medium"
        >
          <ShieldAlert size={18} />
          {t('nav.admin')}
        </Link>
      )}
    </nav>
  );

  const userFooter = (
    <div className="p-4 border-t border-border">
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
