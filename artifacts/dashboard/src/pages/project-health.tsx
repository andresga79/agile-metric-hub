import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, AlertTriangle, AlertCircle, CheckCircle, ChevronDown, ChevronUp, Lightbulb, HeartPulse } from "lucide-react";
import { useHealthSuggestions, type Suggestion } from "@/hooks/use-health-suggestions";
import { ProjectTabs } from "@/components/project-tabs";
import { EmptyState } from "@/components/empty-state";

type Period = "1m" | "3m";

const STATUS_CONFIG = {
  critical: {
    icon: AlertCircle,
    bg: "bg-red-500/10 border-red-500/30",
    badge: "bg-red-500/20 text-red-400",
    label: "page.health.critical",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-500/10 border-amber-500/30",
    badge: "bg-amber-500/20 text-amber-400",
    label: "page.health.warning",
  },
  good: {
    icon: CheckCircle,
    bg: "bg-green-500/10 border-green-500/30",
    badge: "bg-green-500/20 text-green-400",
    label: "page.health.good",
  },
};

function SuggestionCard({ suggestion, index }: { suggestion: Suggestion; index: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[suggestion.status];
  const Icon = config.icon;

  if (suggestion.actions.length === 0 && suggestion.status === "good") return null;

  return (
    <Card className={`${config.bg} transition-colors`}>
      <CardHeader className="pb-3 cursor-pointer" onClick={() => suggestion.actions.length > 0 && setExpanded(!expanded)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Icon size={20} className="shrink-0 mt-0.5 text-foreground" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${config.badge}`}>
                  {t(config.label)}
                </span>
                <CardTitle>{suggestion.label}</CardTitle>
              </div>
              <CardDescription className="mt-1">{suggestion.diagnosis}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-2xl font-bold tabular-nums">{suggestion.value}</span>
            {suggestion.actions.length > 0 && (
              <button
                aria-label={expanded ? t('page.health.collapseActions') : t('page.health.expandActions')}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      {expanded && suggestion.actions.length > 0 && (
        <CardContent className="pt-0 pb-4">
          <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
            <Lightbulb size={16} className="shrink-0 mt-0.5 text-primary" />
            <span className="font-medium text-foreground">{t('page.health.suggestedActions')}</span>
          </div>
          <ul className="space-y-1.5 ml-5">
            {suggestion.actions.map((action, i) => (
              <li key={i} className="text-sm text-muted-foreground list-disc">{action}</li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

export default function ProjectHealth() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const token = localStorage.getItem("auth_token");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { suggestions, loading: loadingHealth } = useHealthSuggestions(projectId, period);

  if (loadingProject) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-1">
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-36" />
          {[1, 2, 3].map((i) => (
            <Card key={i} className="bg-card/40">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <Skeleton className="h-5 w-5 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-16 rounded" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                      <Skeleton className="h-4 w-full max-w-md" />
                    </div>
                  </div>
                  <Skeleton className="h-7 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!project) return <div className="p-6">{t('page.health.notFound')}</div>;

  const critical = suggestions.filter((s) => s.status === "critical");
  const warning = suggestions.filter((s) => s.status === "warning");
  const good = suggestions.filter((s) => s.status === "good" && s.actions.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft size={14} />
              {project.name}
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.health.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('page.health.subtitle')}</p>
        </div>
        <div className="flex bg-background border border-border rounded-md p-1">
          {(["1m", "3m"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${period === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ProjectTabs projectId={projectId!} active="health" />

      {suggestions.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          title={t('page.health.noDataTitle')}
          description={t('page.health.noData')}
        />
      ) : (
        <>
          {critical.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-red-400 flex items-center gap-2">
                <AlertCircle size={18} />
                {t('page.health.needsAttention')}
              </h2>
              {critical.map((s, i) => (
                <SuggestionCard key={s.area} suggestion={s} index={i} />
              ))}
            </div>
          )}

          {warning.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-amber-400 flex items-center gap-2">
                <AlertTriangle size={18} />
                {t('page.health.monitor')}
              </h2>
              {warning.map((s, i) => (
                <SuggestionCard key={s.area} suggestion={s} index={i} />
              ))}
            </div>
          )}

          {good.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-green-400 flex items-center gap-2">
                <CheckCircle size={18} />
                {t('page.health.onTrack')}
              </h2>
              {good.map((s, i) => (
                <SuggestionCard key={s.area} suggestion={s} index={i} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
