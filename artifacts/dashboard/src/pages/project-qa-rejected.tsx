import { useParams, Link } from "wouter";
import { useGetProject, getGetProjectQueryKey, useGetProjectQaRejected, getGetProjectQaRejectedQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, ShieldAlert, Bug, AlertTriangle, TestTube } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getAuthToken } from "@/lib/auth";
import { ProjectTabs } from "@/components/project-tabs";

type Period = "1m" | "3m";

function rateBadge(rate: number, inverse = false) {
  const high = inverse ? rate <= 15 : rate > 30;
  const mid = inverse ? rate <= 30 : rate > 15;
  if (rate === 0) return "bg-green-500/15 text-green-400";
  if (high) return "bg-red-500/15 text-red-400";
  if (mid) return "bg-orange-500/15 text-orange-400";
  return "bg-green-500/15 text-green-400";
}

export default function ProjectQaRejected() {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<Period>("1m");
  const [showAllRejected, setShowAllRejected] = useState(false);
  const [showAllBugs, setShowAllBugs] = useState(false);

  const token = getAuthToken();

  const { data: project, isLoading: loadingProject } = useGetProject(projectId!, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQueryKey(projectId!) },
  });

  const { data, isLoading, isError } = useGetProjectQaRejected(projectId!, period, {
    query: { enabled: !!projectId && !!token, queryKey: getGetProjectQaRejectedQueryKey(projectId!, period) },
  });

  if (!token) return <div>{t('page.qa.notFound')}</div>;
  if (loadingProject || isLoading) return <div>{t('page.qa.loading')}</div>;
  if (isError) return <div>{t('page.qa.noSprintData')}</div>;
  if (!project) return <div>{t('page.qa.notFound')}</div>;

  const displayedRejected = showAllRejected
    ? (data?.rejectedIssues ?? [])
    : (data?.rejectedIssues ?? []).slice(0, 20);
  const displayedBugs = showAllBugs
    ? (data?.linkedBugs ?? [])
    : (data?.linkedBugs ?? []).slice(0, 20);

  const totalImpact = (data?.totalIssuesRejected ?? 0) + (data?.totalLinkedBugs ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {project && (
              <Link href={`/projects/${projectId}`} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                <ArrowLeft size={14} />
                {project.name}
              </Link>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('page.qa.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('page.qa.subtitle')}
          </p>
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

      <ProjectTabs projectId={projectId!} active="qa-rejected" />

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.qa.rejections')}</CardTitle>
            <ShieldAlert size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400">{data?.totalIssuesRejected ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.totalRejectedReversions ?? 0} {t('page.qa.reversions')} — {data?.overallRejectionRate ?? 0}% {t('page.qa.rejectionRate')}
            </p>
            <p className="text-xs text-muted-foreground">{t('page.qa.of')} {data?.totalIssuesThatEnteredQa ?? 0} {t('page.qa.issuesEnteredQA')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.qa.bugsFromQA')}</CardTitle>
            <Bug size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-400">{data?.totalLinkedBugs ?? 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.overallBugRate ?? 0}% {t('page.qa.bugRate')} — {data?.totalStandaloneBugs ?? 0} {t('page.qa.standaloneBugs')}
            </p>
            <p className="text-xs text-muted-foreground">{t('page.qa.linkedVia')}</p>
          </CardContent>
        </Card>

        <Card className="bg-card/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('page.qa.combinedImpact')}</CardTitle>
            <TestTube size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-400">{totalImpact}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {data?.overallQaImpactRate ?? 0}% {t('page.qa.combinedRate')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('page.qa.combinedDesc')}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sprint Breakdown */}
      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle size={18} />
            {t('page.qa.impactBySprint')}
          </CardTitle>
          <CardDescription>{t('page.qa.impactBySprintDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {!data?.bySprint || data.bySprint.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.qa.noSprintData')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.qa.sprint')}</TableHead>
                    <TableHead className="text-right">{t('page.qa.inQa')}</TableHead>
                    <TableHead className="text-right">{t('page.qa.rejected')}</TableHead>
                    <TableHead className="text-right">{t('page.qa.pctReject')}</TableHead>
                    <TableHead className="text-right">{t('page.qa.bugs')}</TableHead>
                    <TableHead className="text-right">{t('page.qa.pctBugs')}</TableHead>
                    <TableHead className="text-right">{t('page.qa.impact')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.bySprint.map((s) => (
                    <TableRow key={s.sprintName} className="border-border hover:bg-accent/50">
                      <TableCell className="font-medium">{s.sprintName}</TableCell>
                      <TableCell className="text-right font-mono">{s.totalEnteredQa}</TableCell>
                      <TableCell className="text-right font-mono text-red-400">{s.rejectedCount}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${rateBadge(s.rate)}`}>{s.rate}%</span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-orange-400">{s.bugsCount}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${rateBadge(s.bugRate)}`}>{s.bugRate}%</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${rateBadge(s.qaImpactRate)}`}>{s.qaImpactRate}%</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rejected Issues Detail */}
      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert size={18} />
            {t('page.qa.rejectedDetail')}
          </CardTitle>
          <CardDescription>
            Stories rejected by QA and returned to development ({data?.rejectedIssues.length ?? 0} total
            {data?.rejectedIssues.length !== undefined && data.rejectedIssues.length > 20 && (
              <button onClick={() => setShowAllRejected(!showAllRejected)} className="ml-2 text-primary hover:underline">
                {showAllRejected ? t('page.qa.showLess') : `${t('page.qa.showAll')} ${data.rejectedIssues.length}`}
              </button>
            )})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data?.rejectedIssues || data.rejectedIssues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.qa.noRejections')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.qa.key')}</TableHead>
                    <TableHead>{t('page.qa.summary')}</TableHead>
                    <TableHead>{t('page.qa.type')}</TableHead>
                    <TableHead>{t('page.qa.sprint')}</TableHead>
                    <TableHead>{t('page.qa.fromQa')}</TableHead>
                    <TableHead>{t('page.qa.toDev')}</TableHead>
                    <TableHead>{t('page.qa.date')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedRejected.map((r) => (
                    <TableRow key={`${r.key}-${r.transitionedAt}`} className="border-border hover:bg-accent/50">
                      <TableCell className="font-mono text-xs text-primary">{r.key}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={r.summary}>{r.summary}</TableCell>
                      <TableCell>{r.issueType}</TableCell>
                      <TableCell className="text-xs">{r.sprintName ?? "—"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400">{r.fromStatus}</span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400">{r.toStatus}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.transitionedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Bugs Detail */}
      <Card className="bg-card/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug size={18} />
            {t('page.qa.linkedBugs')}
          </CardTitle>
          <CardDescription>
            Bug issues linked via issuelinks to stories under QA ({data?.linkedBugs.length ?? 0} total
            {data?.linkedBugs.length !== undefined && data.linkedBugs.length > 20 && (
              <button onClick={() => setShowAllBugs(!showAllBugs)} className="ml-2 text-primary hover:underline">
                {showAllBugs ? t('page.qa.showLess') : `${t('page.qa.showAll')} ${data.linkedBugs.length}`}
              </button>
            )})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data?.linkedBugs || data.linkedBugs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('page.qa.noLinkedBugs')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t('page.qa.bugKey')}</TableHead>
                    <TableHead>{t('page.qa.bugSummary')}</TableHead>
                    <TableHead>{t('page.qa.bugStatus')}</TableHead>
                    <TableHead>{t('page.qa.parentStory')}</TableHead>
                    <TableHead>{t('page.qa.storyRejected')}</TableHead>
                    <TableHead>{t('page.qa.created')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayedBugs.map((b) => (
                    <TableRow key={b.bugKey} className="border-border hover:bg-accent/50">
                      <TableCell className="font-mono text-xs text-primary">{b.bugKey}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={b.bugSummary}>{b.bugSummary}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground">{b.bugStatus}</span>
                      </TableCell>
                      <TableCell className="text-xs">{b.parentStoryKey}</TableCell>
                      <TableCell>
                        {b.parentStoryRejected ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/15 text-red-400">{t('page.qa.yes')}</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/15 text-green-400">{t('page.qa.no')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(b.bugCreated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
