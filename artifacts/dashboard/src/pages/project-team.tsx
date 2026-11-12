import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { useGetProject, getGetProjectQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Users, ExternalLink } from "lucide-react";
import { ProjectTabs } from "@/components/project-tabs";
import { TimeWindowFilter, type TimeWindow } from "@/components/time-window-filter";
import { useTimeWindow } from "@/hooks/use-time-window";
import { useTeamAttention } from "@/hooks/use-team-attention";

// No Admin -> Health threshold exists for "WIP items carried by one person" (wipRatio there is
// a project-wide %, not a per-person count) - this is a plain Kanban rule of thumb, not wired to
// the centralized threshold system like every other colored metric in the app.
function wipColorClass(wip: number): string {
  if (wip >= 5) return "text-red-400";
  if (wip >= 3) return "text-amber-400";
  return "text-muted-foreground";
}

/** Equipo: what each person has in progress, blocked and overdue — what needs attention, not a
 *  ranking. Times and story points per person were removed on purpose (2026-11-13). */
export default function ProjectTeam() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [memberFilter, setMemberFilter] = useState("all");
  const [showAllWorkItems, setShowAllWorkItems] = useState(false);
  const token = localStorage.getItem("auth_token");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });
  const [selectedPeriod, setPeriod] = useTimeWindow(project?.boardType);
  const periodReady = selectedPeriod !== null;
  const period: TimeWindow = selectedPeriod ?? "1m";
  const { rows, p85, loading, failed } = useTeamAttention(projectId!, period, !!token && periodReady);

  const filtered = useMemo(
    () => (memberFilter === "all" ? rows : rows.filter((r) => (r.assignee ?? "") === memberFilter)),
    [memberFilter, rows]
  );

  if (loadingProject || (!!project && !periodReady) || loading) return <div>{t("page.team.loading")}</div>;
  if (!project) return <div>{t("page.team.notFound")}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center text-sm text-muted-foreground mb-4">
        <Link href={`/projects/${project.id}`} className="flex items-center hover:text-foreground transition-colors">
          <ArrowLeft size={16} className="mr-1" />
          {t("page.team.backTo")} {project.name}
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Users className="text-primary" />
            {t("page.team.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("page.team.subtitle")} {project.name}</p>
        </div>
        <TimeWindowFilter boardType={project?.boardType ?? "kanban"} value={period} onChange={setPeriod} />
      </div>

      <ProjectTabs projectId={project.id} active="team" />

      <Card className="bg-card/40 border-border">
        <CardHeader>
          <CardTitle>{t("page.team.attentionTitle")}</CardTitle>
          <CardDescription>
            {t("page.team.attentionDesc", { p85: p85 === null ? "—" : `${p85.toFixed(1)} d` })}
          </CardDescription>
          <div className="flex flex-col md:flex-row md:items-center gap-2 pt-2">
            <select
              className="h-9 px-3 rounded-md border border-border bg-background text-sm"
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
            >
              <option value="all">{t("page.team.allMembers")}</option>
              {rows.filter((r) => r.assignee !== null).map((r) => (
                <option key={r.assignee!} value={r.assignee!}>{r.assignee}</option>
              ))}
            </select>
            <button
              className="h-9 px-3 rounded-md border border-border bg-background text-sm hover:bg-accent transition-colors"
              onClick={() => setShowAllWorkItems((value) => !value)}
            >
              {showAllWorkItems ? t("page.team.show3") : t("page.team.showAll")}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {failed ? (
            <p className="text-sm text-muted-foreground py-6">{t("page.detail.blocked.unavailable")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t("page.team.teamMember")}</TableHead>
                    <TableHead className="text-right">{t("page.team.wip")}</TableHead>
                    <TableHead className="text-right">{t("page.team.blocked")}</TableHead>
                    <TableHead className="text-right">{t("page.team.overdue")}</TableHead>
                    <TableHead>{t("page.team.workingOn")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => {
                    const items = showAllWorkItems ? row.workingOn : row.workingOn.slice(0, 3);
                    const name = row.assignee ?? t("page.team.unassigned");
                    return (
                      <TableRow key={name} className="border-border hover:bg-accent/50">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <span className={`font-medium ${row.assignee === null ? "italic text-muted-foreground" : ""}`}>{name}</span>
                          </div>
                        </TableCell>
                        <TableCell className={`text-right font-mono ${wipColorClass(row.inProgress)}`}>{row.inProgress}</TableCell>
                        <TableCell className="text-right font-mono">
                          {row.blocked > 0 ? (
                            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400">{row.blocked}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.overdue > 0 ? (
                            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-red-500/15 text-red-400">{row.overdue}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 max-w-[460px]">
                            {items.map((item) => (
                              <div key={item.key} className="text-xs">
                                {project.url ? (
                                  <a
                                    href={`${project.url}/browse/${item.key}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-mono text-primary mr-2 inline-flex items-center gap-0.5 hover:underline"
                                  >
                                    {item.key}
                                    <ExternalLink size={10} />
                                  </a>
                                ) : (
                                  <span className="font-mono text-primary mr-2">{item.key}</span>
                                )}
                                <span className="text-muted-foreground">{item.summary}</span>
                                <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground">{item.status}</span>
                                <span className={`ml-2 font-mono ${item.overdue ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>
                                  {item.ageDays.toFixed(1)} d
                                </span>
                              </div>
                            ))}
                            {!showAllWorkItems && row.workingOn.length > 3 && (
                              <span className="text-xs text-muted-foreground">+{row.workingOn.length - 3} {t("page.team.more")}</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t("page.team.noActive")}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
