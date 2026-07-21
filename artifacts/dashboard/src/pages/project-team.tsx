import { useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { 
  useGetProject, getGetProjectQueryKey,
  useGetProjectMembers, getGetProjectMembersQueryKey,
  useGetProjectIssues, getGetProjectIssuesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Users } from "lucide-react";
import { ProjectTabs } from "@/components/project-tabs";

type Period = "1m" | "3m";

function isWorkingStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();

  const doneLike = ["done", "listo", "terminado", "resuelto", "closed", "resolved"];
  if (doneLike.some((value) => normalized.includes(value))) {
    return false;
  }

  const todoLike = ["to do", "por hacer", "backlog", "pendiente"];
  if (todoLike.some((value) => normalized.includes(value))) {
    return false;
  }

  return true;
}

export default function ProjectTeam() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [memberFilter, setMemberFilter] = useState("all");
  const [showAllWorkItems, setShowAllWorkItems] = useState(false);

  const token = localStorage.getItem("auth_token");

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) }
  });

  const { data: members, isLoading: loadingMembers } = useGetProjectMembers(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectMembersQueryKey(projectId!, period) }
  });

  const { data: issues, isLoading: loadingIssues } = useGetProjectIssues(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectIssuesQueryKey(projectId!, period) }
  });

  const memberWorkByName = useMemo(() => {
    const grouped = new Map<string, { key: string; summary: string; status: string }[]>();

    for (const issue of issues ?? []) {
      const assignee = issue.assignee?.trim();
      if (!assignee) continue;
      if (issue.resolvedAt) continue;
      if (!isWorkingStatus(issue.status)) continue;

      if (!grouped.has(assignee)) {
        grouped.set(assignee, []);
      }

      grouped.get(assignee)!.push({
        key: issue.key,
        summary: issue.summary,
        status: issue.status,
      });
    }

    return grouped;
  }, [issues]);

  const filteredMembers = useMemo(() => {
    const source = members ?? [];
    if (memberFilter === "all") {
      return source;
    }
    return source.filter((member) => member.accountId === memberFilter);
  }, [memberFilter, members]);

  if (loadingProject || loadingMembers || loadingIssues) return <div>{t('page.team.loading')}</div>;
  if (!project) return <div>{t('page.team.notFound')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center text-sm text-muted-foreground mb-4">
        <Link href={`/projects/${project.id}`} className="flex items-center hover:text-foreground transition-colors">
          <ArrowLeft size={16} className="mr-1" />
          {t('page.team.backTo')} {project.name}
        </Link>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Users className="text-primary" />
            {t('page.team.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('page.team.subtitle')} {project.name}</p>
        </div>
        
        <div className="flex bg-background border border-border rounded-md p-1">
          {(['1m', '3m'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${
                period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ProjectTabs projectId={project.id} active="team" />

      <Card className="bg-card/40 border-border">
        <CardHeader>
          <CardTitle>{t('page.team.memberStats')}</CardTitle>
          <CardDescription>{t('page.team.metricsDesc')}</CardDescription>
          <div className="flex flex-col md:flex-row md:items-center gap-2 pt-2">
            <select
              className="h-9 px-3 rounded-md border border-border bg-background text-sm"
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
            >
              <option value="all">{t('page.team.allMembers')}</option>
              {(members ?? []).map((member) => (
                <option key={member.accountId} value={member.accountId}>
                  {member.displayName}
                </option>
              ))}
            </select>
            <button
              className="h-9 px-3 rounded-md border border-border bg-background text-sm hover:bg-accent transition-colors"
              onClick={() => setShowAllWorkItems((value) => !value)}
            >
              {showAllWorkItems ? t('page.team.show3') : t('page.team.showAll')}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead>{t('page.team.teamMember')}</TableHead>
                  <TableHead className="text-right">{t('page.team.issuesResolved')}</TableHead>
                  <TableHead className="text-right">{t('page.team.storyPoints')}</TableHead>
                  <TableHead className="text-right">{t('page.team.avgCycleTime')}</TableHead>
                  <TableHead className="text-right">{t('page.team.wip')}</TableHead>
                  <TableHead>{t('page.team.workingOn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.map((member) => (
                  <TableRow key={member.accountId} className="border-border hover:bg-accent/50">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
                          {member.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{member.displayName}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{member.issuesResolved}</TableCell>
                    <TableCell className="text-right font-mono text-primary">{member.storyPoints}</TableCell>
                    <TableCell className="text-right font-mono">{member.avgCycleTime.toFixed(1)}d</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{member.issuesInProgress}</TableCell>
                    <TableCell>
                      <div className="space-y-1 max-w-[440px]">
                        {(showAllWorkItems
                          ? memberWorkByName.get(member.displayName) ?? []
                          : (memberWorkByName.get(member.displayName) ?? []).slice(0, 3)
                        ).map((item) => (
                          <div key={item.key} className="text-xs">
                            <span className="font-mono text-primary mr-2">{item.key}</span>
                            <span className="text-muted-foreground">{item.summary}</span>
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                              {item.status}
                            </span>
                          </div>
                        ))}
                        {(memberWorkByName.get(member.displayName)?.length ?? 0) === 0 && (
                          <span className="text-xs text-muted-foreground">{t('page.team.noActive')}</span>
                        )}
                        {!showAllWorkItems && (memberWorkByName.get(member.displayName)?.length ?? 0) > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{(memberWorkByName.get(member.displayName)?.length ?? 0) - 3} {t('page.team.more')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredMembers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {t('page.team.noMembers')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
