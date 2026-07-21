import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache } from "@tanstack/react-query";
import { ApiError, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import ProjectDetail from "@/pages/project-detail";
import ProjectTeam from "@/pages/project-team";
import ProjectHealth from "@/pages/project-health";
import ProjectForecast from "@/pages/project-forecast";
import ProjectAnalytics from "@/pages/project-analytics";
import ProjectFlow from "@/pages/project-flow";
import ProjectEvolution from "@/pages/project-evolution";
import ProjectReport from "@/pages/project-report";
import ProjectQaRejected from "@/pages/project-qa-rejected";
import ProjectSprints from "@/pages/project-sprints";
import ProjectKanban from "@/pages/project-kanban";
import Admin from "@/pages/admin";

import "@/lib/auth"; // init auth token getter
import { getAuthToken, setAuthToken } from "@/lib/auth";
import { canAccessSection, useRolePermissions, type ProjectSection } from "@/lib/project-section-permissions";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        setAuthToken(null);
        queryClient.clear();
        window.location.href = "/login";
      }
    },
  }),
});

function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const [, setLocation] = useLocation();
  const token = getAuthToken();
  
  if (!token) {
    setLocation("/login");
    return null;
  }
  
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function AdminRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const user = useRoleGuard();
  if (!user) return null;
  if (user.role !== "admin") return <RedirectToDashboard />;
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function SectionRoute({ component: Component, section }: { component: React.ComponentType<any>; section: ProjectSection }) {
  const user = useRoleGuard();
  const { data: permissions } = useRolePermissions();
  if (!user || !permissions) return null;
  if (!canAccessSection(user.role, section, permissions)) return <RedirectToDashboard />;
  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function useRoleGuard() {
  const token = getAuthToken();
  const [, setLocation] = useLocation();
  const { data: user, isLoading } = useGetCurrentUser({
    query: {
      enabled: !!token,
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
    },
  });

  if (!token) {
    setLocation("/login");
    return null;
  }

  if (isLoading) return null;

  return user ?? null;
}

function RedirectToDashboard() {
  const [, setLocation] = useLocation();
  setLocation("/");
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => <ProtectedRoute component={Dashboard} />}
      </Route>
      <Route path="/projects/:projectId">
        {() => <ProtectedRoute component={ProjectDetail} />}
      </Route>
      <Route path="/projects/:projectId/team">
        {() => <SectionRoute section="team" component={ProjectTeam} />}
      </Route>
      <Route path="/projects/:projectId/health">
        {() => <SectionRoute section="health" component={ProjectHealth} />}
      </Route>
      <Route path="/projects/:projectId/forecast">
        {() => <SectionRoute section="forecast" component={ProjectForecast} />}
      </Route>
      <Route path="/projects/:projectId/analytics">
        {() => <SectionRoute section="analytics" component={ProjectAnalytics} />}
      </Route>
      <Route path="/projects/:projectId/flow">
        {() => <SectionRoute section="flow" component={ProjectFlow} />}
      </Route>
      <Route path="/projects/:projectId/evolution">
        {() => <SectionRoute section="evolution" component={ProjectEvolution} />}
      </Route>
      <Route path="/projects/:projectId/report">
        {() => <SectionRoute section="report" component={ProjectReport} />}
      </Route>
      <Route path="/projects/:projectId/qa-rejected">
        {() => <SectionRoute section="qa-rejected" component={ProjectQaRejected} />}
      </Route>
      <Route path="/projects/:projectId/sprints">
        {() => <SectionRoute section="sprints" component={ProjectSprints} />}
      </Route>
      <Route path="/projects/:projectId/kanban">
        {() => <SectionRoute section="kanban" component={ProjectKanban} />}
      </Route>

      <Route path="/settings">
        {() => <AdminRoute component={Admin} />}
      </Route>
      <Route path="/admin">
        {() => <AdminRoute component={Admin} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
