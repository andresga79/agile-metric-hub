import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { ArrowLeft } from "lucide-react";
import { DetailSkeleton } from "@/components/page-skeleton";
import { ProjectTabs, ProjectSubNav } from "@/components/project-tabs";
import { TimeWindowFilter, type TimeWindow } from "@/components/time-window-filter";
import { useTimeWindow } from "@/hooks/use-time-window";
import { SlaSection } from "@/components/sla-section";

/** Calidad → SLA: compliance by priority (moved from Analytics). */
export default function ProjectSla() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const token = localStorage.getItem("auth_token");
  const { data: project, isLoading } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const [selectedPeriod, setPeriod] = useTimeWindow(project?.boardType);
  const period: TimeWindow = selectedPeriod ?? "1m";

  if (isLoading || selectedPeriod === null) return <DetailSkeleton />;
  if (!project) return <div className="p-6">{t("page.metrics.notFound")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1">
            <ArrowLeft size={14} />
            {project.name}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{t("page.analytics.slaTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.analytics.slaDesc")}</p>
        </div>
        <TimeWindowFilter boardType={project.boardType ?? "kanban"} value={period} onChange={setPeriod} />
      </div>
      <ProjectTabs projectId={projectId!} active="qa-rejected" />
      <ProjectSubNav projectId={projectId!} group="quality" active="sla" />
      <SlaSection projectId={projectId!} period={period} />
    </div>
  );
}
