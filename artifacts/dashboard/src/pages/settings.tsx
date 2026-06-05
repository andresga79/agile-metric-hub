import { useTranslation } from "react-i18next";
import { useState, useMemo, useCallback } from "react";
import {
  useListUserProjects,
  getListUserProjectsQueryKey,
  useUpdateProjectVisibility,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useListUserProjects({
    query: { queryKey: getListUserProjectsQueryKey() },
  });

  const updateMutation = useUpdateProjectVisibility();

  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = search.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)
    );
  }, [projects, search]);

  const toggleProject = useCallback(
    (projectId: string, currentVisible: boolean) => {
      updateMutation.mutate(
        { data: [{ projectId, visible: !currentVisible }] },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: getListUserProjectsQueryKey(),
            });
          },
        }
      );
    },
    [updateMutation, queryClient]
  );

  const visibleCount = projects?.filter((p) => p.visible).length ?? 0;
  const totalCount = projects?.length ?? 0;

  if (isLoading) return <div>{t('page.settings.loading')}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('page.settings.title')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('page.settings.subtitle')}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder={t('page.settings.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {visibleCount} {t('page.settings.of')} {totalCount} {t('page.settings.visible')}
        </span>
      </div>

      <Card className="bg-card/40">
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-4 px-6 py-4 hover:bg-accent/30 transition-colors"
              >
                <button
                  onClick={() => toggleProject(project.id, project.visible)}
                  className={`flex items-center justify-center w-10 h-10 rounded-lg border transition-colors shrink-0 ${
                    project.visible
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                  title={project.visible ? t('page.settings.hide') : t('page.settings.show')}
                >
                  {project.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                      {project.key}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-secondary/50 text-secondary-foreground">
                      {project.methodology}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate mt-1">
                    {project.name}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <div>{project.issueCount} {t('page.settings.issues')}</div>
                  <div>{project.doneCount} {t('page.settings.done')}</div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="px-6 py-8 text-center text-muted-foreground text-sm">
                {t('page.settings.noResults')}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

