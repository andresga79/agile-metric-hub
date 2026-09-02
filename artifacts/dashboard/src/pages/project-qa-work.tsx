import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FlaskConical, Clock, AlertTriangle } from "lucide-react";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";
import { EmptyState } from "@/components/empty-state";

type Period = "1m" | "3m";

interface QaWorkItem {
  key: string;
  summary: string;
  issueType: string;
  assignee: string | null;
  status: string;
  isInProgress: boolean;
  daysSinceUpdate: number;
}

interface QaWorkData {
  totalOpen: number;
  inProgressCount: number;
  staleCount: number;
  staleThresholdDays: number;
  resolvedInPeriod: number;
  items: QaWorkItem[];
}

export default function ProjectQaWork() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [data, setData] = useState<QaWorkData | null>(null);
  const [loading, setLoading] = useState(true);
  const token = getAuthToken();

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  useEffect(() => {
    if (!projectId || !token) return;
    setLoading(true);
    fetch(`/api/projects/${projectId}/qa-work/${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId, period, token]);

  if (!token) return <div>{t("page.qaWork.notFound")}</div>;
  if (loadingProject || loading) return <div>{t("page.qaWork.loading")}</div>;
  if (!project) return <div>{t("page.qaWork.notFound")}</div>;

  const items = data?.items ?? [];

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
          <h1 className="text-2xl font-bold tracking-tight">{t("page.qaWork.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.qaWork.subtitle")}</p>
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

      <ProjectTabs projectId={projectId!} active="qa-work" />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("page.qaWork.open")}</CardTitle>
            <FlaskConical size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data?.totalOpen ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.inProgressCount ?? 0} {t("page.qaWork.inProgress")}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("page.qaWork.stale")}</CardTitle>
            <AlertTriangle size={16} className={data && data.staleCount > 0 ? "text-amber-400" : "text-muted-foreground"} />
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${data && data.staleCount > 0 ? "text-amber-400" : ""}`}>
              {data?.staleCount ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("page.qaWork.staleDesc", { days: data?.staleThresholdDays ?? 30 })}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t("page.qaWork.resolved")}</CardTitle>
            <Clock size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">{data?.resolvedInPeriod ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("page.qaWork.resolvedDesc")}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="text-lg">{t("page.qaWork.tableTitle")}</CardTitle>
          <CardDescription>{t("page.qaWork.tableDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState icon={FlaskConical} title={t("page.qaWork.empty")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t("page.qaWork.colKey")}</TableHead>
                    <TableHead>{t("page.qaWork.colSummary")}</TableHead>
                    <TableHead>{t("page.qaWork.colType")}</TableHead>
                    <TableHead>{t("page.qaWork.colStatus")}</TableHead>
                    <TableHead>{t("page.qaWork.colAssignee")}</TableHead>
                    <TableHead className="text-right">{t("page.qaWork.colAge")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.key} className="border-border hover:bg-accent/50">
                      <TableCell className="font-mono text-xs">{i.key}</TableCell>
                      <TableCell className="max-w-xs truncate">{i.summary}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.issueType}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.status}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.assignee ?? "—"}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${i.daysSinceUpdate >= (data?.staleThresholdDays ?? 30) ? "text-amber-400" : ""}`}>
                        {i.daysSinceUpdate}d
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
